import { nanoToTon, tonToNano, type ServerEvent } from "@arena/shared";
import { nanoid } from "nanoid";
import { toNano } from "ton-core";
import { prisma } from "./db.js";
import { env } from "./env.js";
import { WsError } from "./errors.js";
import { logger } from "./logger.js";
import { resolveTwoPlayerRound } from "./two-player.js";
import { sendTonWithdrawal } from "./ton.js";

type UserProfile = {
  tgUserId: string;
  username: string | null;
  firstName: string;
  avatarUrl: string | null;
  startParam?: string | null;
};

type Sender = (tgUserId: string, event: ServerEvent) => void;
type PoolBroadcaster = (poolId: string, event: ServerEvent) => Promise<void>;
type MatchBroadcaster = (matchId: string, event: ServerEvent) => Promise<void>;
type LobbyBroadcaster = (event: ServerEvent) => Promise<void>;

type ActiveRound = {
  roundId: number;
  voteEndsAt: number;
  questionId: string;
  optionIds: string[];
};

type ActiveMatch = {
  matchId: string;
  poolId: string;
  alive: Set<string>;
  tieBreakCount: number;
  round?: ActiveRound;
};

export class GameService {
  private activeMatches = new Map<string, ActiveMatch>();
  private matchByPool = new Map<string, string>();
  private tickTimer: NodeJS.Timeout | null = null;
  private withdrawalTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly sendToUser: Sender,
    private readonly broadcastPool: PoolBroadcaster,
    private readonly broadcastMatch: MatchBroadcaster,
    private readonly broadcastPublicLobby: LobbyBroadcaster,
  ) {}

  public start(): void {
    this.tickTimer = setInterval(() => {
      void this.matchmakerTick();
    }, 1_000);
    this.withdrawalTimer = setInterval(() => {
      void this.processWithdrawals();
    }, env.WITHDRAWAL_PROCESS_INTERVAL_SEC * 1000);
  }

  public stop(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.withdrawalTimer) clearInterval(this.withdrawalTimer);
  }

  public async ensureUser(profile: UserProfile): Promise<void> {
    const existing = await prisma.user.findUnique({ where: { tgUserId: profile.tgUserId } });
    const inviterId = parseInviterId(profile.startParam);
    const canAssignInviter = !!inviterId && inviterId !== profile.tgUserId && !existing?.invitedByTgUserId;

    await prisma.user.upsert({
      where: { tgUserId: profile.tgUserId },
      update: {
        username: profile.username,
        firstName: profile.firstName,
        avatarUrl: profile.avatarUrl,
        lastSeenAt: new Date(),
        invitedByTgUserId: canAssignInviter ? inviterId : undefined,
      },
      create: {
        tgUserId: profile.tgUserId,
        username: profile.username,
        firstName: profile.firstName,
        avatarUrl: profile.avatarUrl,
        invitedByTgUserId: canAssignInviter ? inviterId : null,
        refCode: `ref_${profile.tgUserId}`,
      },
    });

    if (existing && !existing.refCode) {
      await prisma.user.update({
        where: { tgUserId: profile.tgUserId },
        data: { refCode: `ref_${profile.tgUserId}` },
      });
    }
    await prisma.balance.upsert({
      where: { tgUserId: profile.tgUserId },
      update: {},
      create: { tgUserId: profile.tgUserId },
    });
  }

  private async sendReferralInfo(tgUserId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { tgUserId } });
    if (!user) return;
    const refCode = user.refCode ?? `ref_${tgUserId}`;
    if (!user.refCode) {
      await prisma.user.update({ where: { tgUserId }, data: { refCode } });
    }
    const invitedCount = await prisma.user.count({ where: { invitedByTgUserId: tgUserId } });
    const rewards = await prisma.referralReward.findMany({
      where: { inviterTgUserId: tgUserId },
      select: { amountNanotons: true },
    });
    const totalRewardNano = rewards.reduce((sum, r) => sum + BigInt(r.amountNanotons), 0n);
    this.sendToUser(tgUserId, {
      t: "referral.info",
      refCode,
      invitedCount,
      totalRewardTon: nanoToTon(totalRewardNano),
    });
  }

  public async getBalance(tgUserId: string): Promise<{ availableTon: string; lockedTon: string }> {
    const balance = await prisma.balance.findUniqueOrThrow({ where: { tgUserId } });
    const available = BigInt(balance.availableNanotons);
    const locked = BigInt(balance.lockedNanotons);
    const safeAvailable = available < 0n ? 0n : available;
    const safeLocked = locked < 0n ? 0n : locked;
    return {
      availableTon: nanoToTon(safeAvailable),
      lockedTon: nanoToTon(safeLocked),
    };
  }

  public async sendPlayState(tgUserId: string): Promise<void> {
    const online = await prisma.session.count({
      where: { expiresAt: { gt: new Date() } },
    });
    this.sendToUser(tgUserId, {
      t: "nav.play.state",
      online,
      minStakeTon: env.MIN_STAKE_TON,
    });
    await this.sendReferralInfo(tgUserId);
  }

  public async createPrivateRoom(tgUserId: string, stakeTon: string): Promise<void> {
    const stake = this.validateStake(stakeTon);
    await this.assertCanJoin(tgUserId);
    await this.lockFunds(tgUserId, stake);

    const roomId = `r_${nanoid(12)}`;
    const poolId = `p_${nanoid(12)}`;
    const code = await this.createUniqueRoomCode();

    await prisma.$transaction(async (tx) => {
      await tx.room.create({
        data: {
          roomId,
          scope: "private",
          code,
          ownerTgUserId: tgUserId,
          isActive: true,
        },
      });
      await tx.pool.create({
        data: {
          poolId,
          scope: "private",
          roomId,
          stakeNanotons: stake.toString(),
          status: "idle",
        },
      });
      await tx.queueEntry.create({
        data: {
          id: `qe_${nanoid(12)}`,
          poolId,
          tgUserId,
          status: "locked",
          stakeNanotons: stake.toString(),
        },
      });
    });

    await this.emitBalanceUpdated(tgUserId);
    this.sendToUser(tgUserId, { t: "room.created", scope: "private", code, stakeTon });
    await this.broadcastRoomState(poolId);
  }

  public async joinPrivateRoom(tgUserId: string, code: string, stakeTon: string): Promise<void> {
    const stake = this.validateStake(stakeTon);
    await this.assertCanJoin(tgUserId);

    const room = await prisma.room.findFirst({
      where: { code, scope: "private", isActive: true },
      include: { pools: true },
    });
    if (!room) throw new WsError("ROOM_NOT_FOUND", "Room not found");
    let pool = room.pools.find((x) => x.stakeNanotons === stake.toString());
    if (!pool && room.pools.length === 1) {
      pool = room.pools[0];
    }
    if (!pool) throw new WsError("ROOM_NOT_FOUND", "Stake pool not found for room");

    await this.lockFunds(tgUserId, stake);
    await prisma.queueEntry.create({
      data: {
        id: `qe_${nanoid(12)}`,
        poolId: pool.poolId,
        tgUserId,
        status: "locked",
        stakeNanotons: stake.toString(),
      },
    });

    await this.emitBalanceUpdated(tgUserId);
    await this.broadcastRoomState(pool.poolId);
  }

  public async joinPublicPool(tgUserId: string, stakeTon: string): Promise<void> {
    const stake = this.validateStake(stakeTon);
    await this.assertCanJoin(tgUserId);
    await this.lockFunds(tgUserId, stake);

    let pool = await prisma.pool.findFirst({
      where: { scope: "public", roomId: null, stakeNanotons: "0" },
    });
    if (!pool) {
      pool = await prisma.pool.create({
        data: {
          poolId: `p_${nanoid(12)}`,
          scope: "public",
          stakeNanotons: "0",
          status: "idle",
        },
      });
    }

    await prisma.queueEntry.create({
      data: {
        id: `qe_${nanoid(12)}`,
        poolId: pool.poolId,
        tgUserId,
        status: "locked",
        stakeNanotons: stake.toString(),
      },
    });

    await this.emitBalanceUpdated(tgUserId);
    await this.broadcastRoomState(pool.poolId);
  }

  public async leaveRoom(tgUserId: string): Promise<void> {
    const entry = await prisma.queueEntry.findFirst({
      where: { tgUserId, status: "locked" },
      include: { pool: true },
    });
    if (!entry) throw new WsError("ROOM_NOT_FOUND", "Not in a room");
    if (entry.pool.status === "running") throw new WsError("ROOM_CLOSED", "Match already started");

    const stakeNano = BigInt(entry.stakeNanotons);

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.queueEntry.findFirst({ where: { id: entry.id, status: "locked" } });
      if (!fresh) return;

      const b = await tx.balance.findUniqueOrThrow({ where: { tgUserId } });
      await tx.balance.update({
        where: { tgUserId },
        data: {
          availableNanotons: (BigInt(b.availableNanotons) + stakeNano).toString(),
          lockedNanotons: (BigInt(b.lockedNanotons) - stakeNano).toString(),
        },
      });

      await tx.queueEntry.delete({ where: { id: entry.id } });

      const lockedCount = await tx.queueEntry.count({
        where: { poolId: entry.poolId, status: "locked" },
      });
      if (entry.pool.status === "countdown" && lockedCount < 2) {
        await tx.pool.update({
          where: { poolId: entry.poolId },
          data: { status: "idle", countdownEndsAt: null },
        });
      }
    });

    await this.emitBalanceUpdated(tgUserId);
    await this.broadcastRoomState(entry.poolId);
  }

  public async vote(tgUserId: string, matchId: string, roundId: number, optionId: string): Promise<void> {
    const activeMatch = this.activeMatches.get(matchId);
    if (!activeMatch || !activeMatch.round || activeMatch.round.roundId !== roundId) {
      throw new WsError("VOTE_CLOSED", "Voting is closed");
    }
    if (Date.now() >= activeMatch.round.voteEndsAt) throw new WsError("VOTE_CLOSED", "Voting is closed");
    if (!activeMatch.alive.has(tgUserId)) throw new WsError("NOT_ALIVE", "Player is eliminated");
    if (!activeMatch.round.optionIds.includes(optionId)) throw new WsError("BAD_REQUEST", "Invalid option");

    try {
      await prisma.vote.create({
        data: {
          id: `v_${nanoid(12)}`,
          matchId,
          roundId,
          tgUserId,
          optionId,
        },
      });
    } catch {
      throw new WsError("BAD_REQUEST", "Vote already submitted");
    }
  }

  public async createDepositIntent(tgUserId: string, amountTon?: string): Promise<void> {
    const amountNano = amountTon ? tonToNano(amountTon) : null;
    if (amountNano !== null && amountNano <= 0n) throw new WsError("BAD_REQUEST", "Invalid deposit amount");
    const payload = `user:${tgUserId}:${Date.now()}`;
    await prisma.deposit.create({
      data: {
        depositId: `d_${nanoid(16)}`,
        tgUserId,
        address: env.HOT_WALLET_ADDRESS,
        payload,
        amountNanotons: amountNano ? amountNano.toString() : null,
        status: "pending",
      },
    });
    this.sendToUser(tgUserId, {
      t: "deposit.info",
      address: env.HOT_WALLET_ADDRESS,
      payload,
      status: "pending",
      amountTon,
    });
  }

  public async requestWithdraw(tgUserId: string, toAddress: string, amountTon: string): Promise<void> {
    const nano = tonToNano(amountTon);
    if (nano <= 0n) throw new WsError("BAD_REQUEST", "Invalid amount");
    if (nano < toNano(env.WITHDRAWAL_MIN_TON)) throw new WsError("BAD_REQUEST", "Withdrawal amount is too low");
    let withdrawalId = "";
    await prisma.$transaction(async (tx) => {
      const balance = await tx.balance.findUniqueOrThrow({ where: { tgUserId } });
      const available = BigInt(balance.availableNanotons);
      if (available < nano) throw new WsError("INSUFFICIENT_FUNDS", "Insufficient funds");
      await tx.balance.update({
        where: { tgUserId },
        data: { availableNanotons: (available - nano).toString() },
      });
      const row = await tx.withdrawal.create({
        data: {
          id: `w_${nanoid(14)}`,
          tgUserId,
          toAddress,
          amountNanotons: nano.toString(),
          status: "pending",
        },
      });
      withdrawalId = row.id;
    });
    await this.emitBalanceUpdated(tgUserId);
    this.sendToUser(tgUserId, {
      t: "withdrawal.info",
      id: withdrawalId,
      amountTon,
      status: "pending",
    });
  }

  private async processWithdrawals(): Promise<void> {
    const pending = await prisma.withdrawal.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
      take: 20,
    });
    if (pending.length === 0) return;

    const feeNano = toNano(env.WITHDRAWAL_FEE_TON);

    for (const w of pending) {
      try {
        const amountNano = BigInt(w.amountNanotons);
        if (amountNano <= feeNano) {
          await prisma.withdrawal.update({
            where: { id: w.id },
            data: { status: "rejected", processedAt: new Date() },
          });
          this.sendToUser(w.tgUserId, {
            t: "withdrawal.info",
            id: w.id,
            amountTon: nanoToTon(amountNano),
            status: "rejected",
          });
          continue;
        }

        const payoutNano = amountNano - feeNano;
        const txHash = await sendTonWithdrawal({
          toAddress: w.toAddress,
          amountTon: nanoToTon(payoutNano),
          memo: `withdraw:${w.id}`,
        });

        await prisma.withdrawal.update({
          where: { id: w.id },
          data: { status: "processed", txHash, processedAt: new Date() },
        });

        this.sendToUser(w.tgUserId, {
          t: "withdrawal.info",
          id: w.id,
          amountTon: nanoToTon(amountNano),
          status: "processed",
        });
      } catch (error) {
        logger.error({ err: error, withdrawalId: w.id }, "Withdrawal processing failed");
        try {
          await prisma.$transaction(async (tx) => {
            const fresh = await tx.withdrawal.findUnique({ where: { id: w.id } });
            if (!fresh || fresh.status !== "pending") return;
            const balance = await tx.balance.findUniqueOrThrow({ where: { tgUserId: w.tgUserId } });
            await tx.balance.update({
              where: { tgUserId: w.tgUserId },
              data: {
                availableNanotons: (BigInt(balance.availableNanotons) + BigInt(fresh.amountNanotons)).toString(),
              },
            });
            await tx.withdrawal.update({
              where: { id: w.id },
              data: { status: "rejected", processedAt: new Date() },
            });
          });
          this.sendToUser(w.tgUserId, {
            t: "withdrawal.info",
            id: w.id,
            amountTon: nanoToTon(BigInt(w.amountNanotons)),
            status: "rejected",
          });
          await this.emitBalanceUpdated(w.tgUserId);
        } catch (refundError) {
          logger.error({ err: refundError, withdrawalId: w.id }, "Withdrawal rollback failed");
        }
      }
    }
  }

  public async sendReconnectState(tgUserId: string): Promise<void> {
    const queue = await prisma.queueEntry.findFirst({
      where: { tgUserId, status: { in: ["locked", "in_match"] } },
      include: { pool: true },
      orderBy: { createdAt: "desc" },
    });
    if (queue) {
      await this.broadcastRoomState(queue.poolId);
      const activeMatchId = this.matchByPool.get(queue.poolId);
      if (activeMatchId) {
        const active = this.activeMatches.get(activeMatchId);
        if (active?.round) {
          const question = await prisma.question.findUnique({ where: { id: active.round.questionId } });
          if (question) {
            const options = JSON.parse(question.optionsJson) as Array<{ id: string; text: string }>;
            this.sendToUser(tgUserId, {
              t: "round.start",
              matchId: active.matchId,
              roundId: active.round.roundId,
              voteEndsAt: active.round.voteEndsAt,
              question: { id: question.id, text: question.text, options },
            });
          }
        }
      }
    }

    const latestDeposit = await prisma.deposit.findFirst({
      where: { tgUserId },
      orderBy: { createdAt: "desc" },
    });
    if (latestDeposit) {
      this.sendToUser(tgUserId, {
        t: "deposit.info",
        address: latestDeposit.address,
        payload: latestDeposit.payload,
        status: latestDeposit.status === "confirmed" ? "confirmed" : latestDeposit.status === "expired" ? "expired" : "pending",
        amountTon: latestDeposit.amountNanotons ? nanoToTon(BigInt(latestDeposit.amountNanotons)) : undefined,
      });
    }

    await this.sendReferralInfo(tgUserId);
  }

  public async getHistory(tgUserId: string): Promise<{
    deposits: Array<{ id: string; amountTon?: string; status: "pending" | "confirmed" | "expired"; createdAt: number }>;
    withdrawals: Array<{ id: string; amountTon: string; status: "pending" | "processed" | "rejected"; createdAt: number }>;
    matches: Array<{
      matchId: string;
      stakeTon: string;
      potTon: string;
      feeTon: string;
      payoutTon: string;
      winnerId: string | null;
      result: "win" | "lose";
      endedAt: number;
    }>;
  }> {
    const [deposits, withdrawals, players] = await prisma.$transaction([
      prisma.deposit.findMany({
        where: { tgUserId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.withdrawal.findMany({
        where: { tgUserId },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.matchPlayer.findMany({
        where: { tgUserId },
        include: { match: true },
        orderBy: { match: { endedAt: "desc" } },
        take: 50,
      }),
    ]);

    const matches = players
      .filter((p) => p.match.status === "ended" && p.match.endedAt)
      .map((p) => {
        const pot = BigInt(p.match.potNanotons);
        const fee = BigInt(p.match.feeNanotons);
        const payout = pot - fee;
        return {
          matchId: p.match.matchId,
          stakeTon: nanoToTon(BigInt(p.stakeNanotons)),
          potTon: nanoToTon(pot),
          feeTon: nanoToTon(fee),
          payoutTon: nanoToTon(payout),
          winnerId: p.match.winnerTgUserId,
          result: (p.match.winnerTgUserId === tgUserId ? "win" : "lose") as "win" | "lose",
          endedAt: p.match.endedAt!.getTime(),
        };
      });

    return {
      deposits: deposits.map((d) => ({
        id: d.depositId,
        amountTon: d.amountNanotons ? nanoToTon(BigInt(d.amountNanotons)) : undefined,
        status: d.status === "confirmed" ? "confirmed" : d.status === "expired" ? "expired" : "pending",
        createdAt: d.createdAt.getTime(),
      })),
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        amountTon: nanoToTon(BigInt(w.amountNanotons)),
        status: w.status as "pending" | "processed" | "rejected",
        createdAt: w.createdAt.getTime(),
      })),
      matches,
    };
  }

  private validateStake(stakeTon: string): bigint {
    const stake = tonToNano(stakeTon);
    if (stake < tonToNano(env.MIN_STAKE_TON)) throw new WsError("STAKE_TOO_LOW", "Minimum stake is 0.1 TON");
    return stake;
  }

  private async assertCanJoin(tgUserId: string): Promise<void> {
    const inQueue = await prisma.queueEntry.findFirst({
      where: { tgUserId, status: { in: ["locked", "in_match"] } },
    });
    if (inQueue) throw new WsError("ALREADY_IN_MATCH", "You are already in a room or match");
  }

  private async lockFunds(tgUserId: string, stakeNano: bigint): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const b = await tx.balance.findUniqueOrThrow({ where: { tgUserId } });
      const available = BigInt(b.availableNanotons);
      const locked = BigInt(b.lockedNanotons);
      if (available < stakeNano) throw new WsError("INSUFFICIENT_FUNDS", "Insufficient funds");
      await tx.balance.update({
        where: { tgUserId },
        data: {
          availableNanotons: (available - stakeNano).toString(),
          lockedNanotons: (locked + stakeNano).toString(),
        },
      });
    });
  }

  private async emitBalanceUpdated(tgUserId: string): Promise<void> {
    const b = await this.getBalance(tgUserId);
    this.sendToUser(tgUserId, {
      t: "balance.updated",
      availableTon: b.availableTon,
      lockedTon: b.lockedTon,
    });
  }

  private async broadcastRoomState(poolId: string): Promise<void> {
    const pool = await prisma.pool.findUnique({
      where: { poolId },
      include: { room: true, queueEntries: { where: { status: { in: ["locked", "in_match"] } } } },
    });
    if (!pool) return;
    const event: ServerEvent = {
      t: "room.state",
      scope: pool.scope as "public" | "private",
      code: pool.scope === "public" ? "ARENA" : pool.room?.code ?? "UNKNOWN",
      stakeTon: nanoToTon(BigInt(pool.stakeNanotons)),
      playersOnline: pool.queueEntries.length,
      phase: pool.status === "countdown" ? "prestart" : pool.status === "running" ? "running" : "idle",
      countdownEndsAt: pool.countdownEndsAt ? pool.countdownEndsAt.getTime() : null,
    };
    await this.broadcastPool(poolId, event);
    if (pool.scope === "public" && event.playersOnline > 0) {
      await this.broadcastPublicLobby({ ...event, t: "room.lobby" });
    }
  }

  private async matchmakerTick(): Promise<void> {
    const now = new Date();
    const pools = await prisma.pool.findMany({
      include: { queueEntries: { where: { status: "locked" } } },
    });
    for (const pool of pools) {
      if (pool.status === "idle" && pool.queueEntries.length >= 2) {
        await prisma.pool.update({
          where: { poolId: pool.poolId },
          data: {
            status: "countdown",
            countdownEndsAt: new Date(Date.now() + env.PRESTART_COUNTDOWN_SEC * 1000),
          },
        });
        await this.broadcastRoomState(pool.poolId);
      }

      if (pool.status === "countdown" && pool.countdownEndsAt && pool.countdownEndsAt <= now) {
        await this.startMatch(pool.poolId);
      }
    }
  }

  private async startMatch(poolId: string): Promise<void> {
    const pool = await prisma.pool.findUnique({
      where: { poolId },
      include: {
        queueEntries: { where: { status: "locked" }, orderBy: { createdAt: "asc" } },
      },
    });
    if (!pool) return;

    const selected = pool.queueEntries.slice(0, env.MAX_PLAYERS_PER_MATCH);
    if (selected.length < 2) {
      await prisma.pool.update({
        where: { poolId },
        data: { status: "idle", countdownEndsAt: null },
      });
      await this.broadcastRoomState(poolId);
      return;
    }

    const matchId = `m_${nanoid(12)}`;
    const potNano = selected.reduce((sum, q) => sum + BigInt(q.stakeNanotons), 0n);
    const feeNano = potNano / 10n;

    await prisma.$transaction(async (tx) => {
      await tx.match.create({
        data: {
          matchId,
          poolId,
          stakeNanotons: pool.stakeNanotons,
          potNanotons: potNano.toString(),
          feeNanotons: feeNano.toString(),
          status: "running",
          startedAt: new Date(),
        },
      });
      await tx.pool.update({
        where: { poolId },
        data: { status: "running", countdownEndsAt: null },
      });
      for (const q of selected) {
        await tx.queueEntry.update({
          where: { id: q.id },
          data: { status: "in_match" },
        });
        await tx.matchPlayer.create({
          data: {
            id: `mp_${nanoid(12)}`,
            matchId,
            tgUserId: q.tgUserId,
            status: "alive",
            stakeNanotons: q.stakeNanotons,
          },
        });
      }
    });

    const users = await prisma.user.findMany({
      where: { tgUserId: { in: selected.map((x) => x.tgUserId) } },
    });
    const participants = selected.map((s) => {
      const u = users.find((x) => x.tgUserId === s.tgUserId);
      return { id: s.tgUserId, name: u?.firstName ?? "Player" };
    });

    this.activeMatches.set(matchId, {
      matchId,
      poolId,
      alive: new Set(selected.map((x) => x.tgUserId)),
      tieBreakCount: 0,
    });
    this.matchByPool.set(poolId, matchId);

    await this.broadcastPool(poolId, {
      t: "match.created",
      matchId,
      stakeTon: pool.scope === "public" ? "0" : nanoToTon(BigInt(pool.stakeNanotons)),
      potTon: nanoToTon(potNano),
      feePct: 10,
      participants,
      startsAt: Date.now(),
    });
    await this.broadcastRoomState(poolId);
    await this.startRound(matchId, false);
  }

  private async startRound(matchId: string, isTieBreak: boolean): Promise<void> {
    const active = this.activeMatches.get(matchId);
    if (!active) return;

    const previousRounds = await prisma.round.findMany({
      where: { matchId },
      orderBy: { roundId: "asc" },
      select: { roundId: true, questionId: true },
    });

    const roundId = previousRounds.length + 1;
    const usedQuestionIds = previousRounds.map((x) => x.questionId);
    const aliveCount = active.alive.size;

    const question =
      (await prisma.question.findFirst({
        where: { isActive: true, lang: "ru", id: { notIn: usedQuestionIds } },
        orderBy: { weight: "desc" },
      })) ??
      (await prisma.question.findFirst({
        where: { isActive: true, lang: "ru" },
      }));

    if (!question) {
      logger.error({ matchId }, "Questions are missing");
      return;
    }

    const voteSec = isTieBreak ? env.TIEBREAK_VOTE_SEC : env.VOTE_WINDOW_SEC;
    const voteEndsAt = Date.now() + voteSec * 1000;
    await prisma.round.create({
      data: {
        id: `r_${nanoid(12)}`,
        matchId,
        roundId,
        questionId: question.id,
        voteEndsAt: new Date(voteEndsAt),
      },
    });

    const options = (JSON.parse(question.optionsJson) as Array<{ id: string; text: string }>).slice(0, aliveCount > 3 ? 4 : 2);

    active.round = {
      roundId,
      voteEndsAt,
      questionId: question.id,
      optionIds: options.map((x) => x.id),
    };

    await this.broadcastMatch(matchId, {
      t: "round.start",
      matchId,
      roundId,
      voteEndsAt,
      question: { id: question.id, text: question.text, options },
    });

    setTimeout(() => {
      void this.finishRound(matchId, roundId);
    }, voteSec * 1000 + 50);
  }

  private async finishRound(matchId: string, roundId: number): Promise<void> {
    const active = this.activeMatches.get(matchId);
    if (!active || !active.round || active.round.roundId !== roundId) return;

    const votes = await prisma.vote.findMany({ where: { matchId, roundId } });
    if (votes.length === 0) {
      logger.info({ matchId, roundId }, "No votes in round, starting a new question");
      await this.broadcastMatch(matchId, {
        t: "info",
        message: "Никто не проголосовал — следующий вопрос",
      });
      setTimeout(() => {
        void this.startRound(matchId, false);
      }, 50);
      return;
    }

    const counts = new Map<string, number>();
    for (const v of votes) counts.set(v.optionId, (counts.get(v.optionId) ?? 0) + 1);

    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = sorted[0]?.[1] ?? 0;
    const majorities = sorted.filter((entry) => entry[1] === max && max > 0).map((entry) => entry[0]);

    const votedIds = new Set(votes.map((x) => x.tgUserId));
    const noVote = [...active.alive].filter((id) => !votedIds.has(id));

    let eliminated = [...noVote];
    let majority: string | null = null;

    if (active.alive.size === 2) {
      const aliveIds = [...active.alive];
      const aliveVotes = votes.filter((v) => active.alive.has(v.tgUserId));
      const uniqueChoices = new Set(aliveVotes.map((v) => v.optionId));

      if (uniqueChoices.size === 2) {
        const result = resolveTwoPlayerRound(
          aliveIds,
          active.round.optionIds,
          aliveVotes.map((v) => ({ tgUserId: v.tgUserId, optionId: v.optionId })),
        );
        majority = result.majority;
        eliminated = [...new Set([...eliminated, ...result.eliminatedIds])];

        if (eliminated.length > 0) await this.markEliminated(matchId, eliminated, active);

        await this.broadcastMatch(matchId, {
          t: "round.reveal",
          matchId,
          roundId,
          counts: Object.fromEntries(counts),
          majority,
          eliminatedIds: eliminated,
          aliveCount: active.alive.size,
        });

        if (active.alive.size <= 1) {
          setTimeout(() => {
            void this.endMatch(matchId);
          }, env.REVEAL_SEC * 1000);
        }
        return;
      }
    }

    if (majorities.length === 1) {
      majority = majorities[0];
      const minority = votes.filter((x) => x.optionId !== majority).map((x) => x.tgUserId);
      eliminated = [...new Set([...eliminated, ...minority])];
    }

    if (majorities.length > 1) {
      active.tieBreakCount += 1;
      if (eliminated.length > 0) await this.markEliminated(matchId, eliminated, active);

      await this.broadcastMatch(matchId, {
        t: "round.reveal",
        matchId,
        roundId,
        counts: Object.fromEntries(counts),
        majority: null,
        eliminatedIds: eliminated,
        aliveCount: active.alive.size,
      });

      if (active.alive.size <= 1) {
        await this.endMatch(matchId);
        return;
      }

      if (active.tieBreakCount <= env.TIEBREAK_MAX) {
        setTimeout(() => void this.startRound(matchId, true), env.GAP_SEC * 1000);
        return;
      }

      active.tieBreakCount = 0;
      setTimeout(() => void this.startRound(matchId, false), env.GAP_SEC * 1000);
      return;
    }

    if (eliminated.length > 0) await this.markEliminated(matchId, eliminated, active);

    await this.broadcastMatch(matchId, {
      t: "round.reveal",
      matchId,
      roundId,
      counts: Object.fromEntries(counts),
      majority,
      eliminatedIds: eliminated,
      aliveCount: active.alive.size,
    });

    if (active.alive.size <= 1) {
      setTimeout(() => {
        void this.endMatch(matchId);
      }, env.REVEAL_SEC * 1000);
      return;
    }

    active.tieBreakCount = 0;
    setTimeout(() => {
      void this.startRound(matchId, false);
    }, (env.REVEAL_SEC + env.GAP_SEC) * 1000);
  }

  private async markEliminated(matchId: string, eliminated: string[], active: ActiveMatch): Promise<void> {
    await prisma.$transaction(
      eliminated.map((tgUserId) =>
        prisma.matchPlayer.updateMany({
          where: { matchId, tgUserId, status: "alive" },
          data: { status: "eliminated", eliminatedAt: new Date() },
        }),
      ),
    );
    for (const id of eliminated) active.alive.delete(id);
  }

  private async endMatch(matchId: string): Promise<void> {
    const active = this.activeMatches.get(matchId);
    if (!active) return;

    const winnerId = [...active.alive][0];
    if (!winnerId) return;

    const match = await prisma.match.findUniqueOrThrow({ where: { matchId } });
    const players = await prisma.matchPlayer.findMany({ where: { matchId } });
    const potNano = BigInt(match.potNanotons);
    const feeNano = BigInt(match.feeNanotons);
    const payoutNano = potNano - feeNano;

    await prisma.$transaction(async (tx) => {
      for (const p of players) {
        const b = await tx.balance.findUniqueOrThrow({ where: { tgUserId: p.tgUserId } });
        const playerStake = BigInt(p.stakeNanotons);
        await tx.balance.update({
          where: { tgUserId: p.tgUserId },
          data: {
            lockedNanotons: (BigInt(b.lockedNanotons) - playerStake).toString(),
          },
        });
      }

      const winnerBal = await tx.balance.findUniqueOrThrow({ where: { tgUserId: winnerId } });
      await tx.balance.update({
        where: { tgUserId: winnerId },
        data: {
          availableNanotons: (BigInt(winnerBal.availableNanotons) + payoutNano).toString(),
        },
      });

      const serviceUserId = "service";
      await tx.user.upsert({
        where: { tgUserId: serviceUserId },
        update: {},
        create: {
          tgUserId: serviceUserId,
          firstName: "Service",
        },
      });

      const serviceBal = await tx.balance.upsert({
        where: { tgUserId: serviceUserId },
        update: {},
        create: { tgUserId: serviceUserId },
      });

      await tx.balance.update({
        where: { tgUserId: serviceUserId },
        data: {
          serviceRevenueNano: (BigInt(serviceBal.serviceRevenueNano) + feeNano).toString(),
        },
      });

      await tx.match.update({
        where: { matchId },
        data: {
          status: "ended",
          winnerTgUserId: winnerId,
          endedAt: new Date(),
        },
      });

      await tx.queueEntry.deleteMany({ where: { poolId: active.poolId, status: "in_match" } });
      await tx.pool.update({
        where: { poolId: active.poolId },
        data: { status: "idle", countdownEndsAt: null },
      });
    });

    for (const p of players) {
      const bal = await this.getBalance(p.tgUserId);
      this.sendToUser(p.tgUserId, {
        t: "match.end",
        matchId,
        winnerId,
        potTon: nanoToTon(potNano),
        feeTon: nanoToTon(feeNano),
        payoutTon: nanoToTon(payoutNano),
        balance: bal,
      });
      await this.emitBalanceUpdated(p.tgUserId);
    }

    this.activeMatches.delete(matchId);
    this.matchByPool.delete(active.poolId);
    await this.broadcastRoomState(active.poolId);
  }

  private async createUniqueRoomCode(): Promise<string> {
    for (let i = 0; i < 20; i += 1) {
      const code = this.generateRoomCode();
      const existing = await prisma.room.findUnique({ where: { code } });
      if (!existing) return code;
    }
    throw new WsError("BAD_REQUEST", "Unable to generate room code");
  }

  private generateRoomCode(): string {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let code = "";
    for (let i = 0; i < 6; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    return code;
  }
}

function parseInviterId(startParam?: string | null): string | null {
  if (!startParam) return null;
  const match = /^ref_(\d+)$/.exec(startParam.trim());
  return match ? match[1] : null;
}
