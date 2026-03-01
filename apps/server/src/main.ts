import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import express from "express";
import cors from "cors";
import WebSocket, { WebSocketServer } from "ws";
import {
  decodeClientEvent,
  encodeServerEvent,
  nanoToTon,
  type ServerErrorEvent,
  type ServerEvent,
} from "@arena/shared";
import { initSqlitePragmas, prisma } from "./db.js";
import { env } from "./env.js";
import { logger } from "./logger.js";
import { GameService } from "./game.js";
import { validateTelegramInitData } from "./telegram.js";
import { InMemoryRateLimiter } from "./rate-limit.js";
import { WsError } from "./errors.js";

type AuthedUser = {
  tgUserId: string;
  username: string | null;
  firstName: string;
  avatarUrl: string | null;
  startParam?: string | null;
};

type WsMeta = {
  connId: string;
  ws: WebSocket;
  user: AuthedUser | null;
  lastBalanceKey: string | null;
  lastDepositKey: string | null;
  lastReferralKey: string | null;
  isAlive: boolean;
  ip: string | null;
};

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const bySocket = new Map<WebSocket, WsMeta>();
const socketsByUser = new Map<string, Set<WebSocket>>();

const limiter = new InMemoryRateLimiter();

const isEventAllowedForBeta = (eventType: string): boolean => {
  return ["hello", "beta.redeem_code", "beta.request_access"].includes(eventType);
};

const sendToUser = (tgUserId: string, event: ServerEvent): void => {
  const payload = encodeServerEvent(event);
  const sockets = socketsByUser.get(tgUserId);
  if (!sockets) return;
  for (const ws of sockets) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
};

const sendError = (ws: WebSocket, code: ServerErrorEvent["code"], message: string): void => {
  if (ws.readyState !== WebSocket.OPEN) return;
  ws.send(
    encodeServerEvent({
      t: "error",
      code,
      message,
    }),
  );
};

const logBetaAttempt = (params: {
  tgUserId: string;
  ip: string | null;
  code: string;
  result: "approved" | "invalid" | "used" | "already" | "rate_limit" | "error";
}): void => {
  const masked = params.code.length <= 4 ? params.code : `${params.code.slice(0, 2)}***${params.code.slice(-2)}`;
  logger.info({ ...params, code: masked }, "Beta code attempt");
};

const getBetaCodes = (): Set<string> => {
  const filePath = path.resolve(env.BETA_CODES_PATH);
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(raw) as { codes?: Array<string | { code: string }> } | Array<string | { code: string }>;
  const list = Array.isArray(parsed) ? parsed : parsed.codes ?? [];
  return new Set(
    list
      .map((entry) => (typeof entry === "string" ? entry : entry.code))
      .filter((code): code is string => typeof code === "string" && code.trim().length > 0)
      .map((code) => code.trim().toUpperCase()),
  );
};

const getPoolUserIds = async (poolId: string): Promise<string[]> => {
  const users = await prisma.queueEntry.findMany({
    where: { poolId, status: { in: ["locked", "in_match"] } },
    select: { tgUserId: true },
    distinct: ["tgUserId"],
  });
  return users.map((x) => x.tgUserId);
};

const getMatchUserIds = async (matchId: string): Promise<string[]> => {
  const users = await prisma.matchPlayer.findMany({
    where: { matchId },
    select: { tgUserId: true },
    distinct: ["tgUserId"],
  });
  return users.map((x) => x.tgUserId);
};

const broadcastPool = async (poolId: string, event: ServerEvent): Promise<void> => {
  const userIds = await getPoolUserIds(poolId);
  for (const id of userIds) sendToUser(id, event);
};

const broadcastPublicLobby = async (event: ServerEvent): Promise<void> => {
  const inRoom = await prisma.queueEntry.findMany({
    where: { status: { in: ["locked", "in_match"] } },
    select: { tgUserId: true },
    distinct: ["tgUserId"],
  });
  const inRoomIds = new Set(inRoom.map((x) => x.tgUserId));
  const payload = encodeServerEvent(event);
  for (const [tgUserId, sockets] of socketsByUser.entries()) {
    if (inRoomIds.has(tgUserId)) continue;
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    }
  }
};

const broadcastMatch = async (matchId: string, event: ServerEvent): Promise<void> => {
  const userIds = await getMatchUserIds(matchId);
  for (const id of userIds) sendToUser(id, event);
};

const game = new GameService(sendToUser, broadcastPool, broadcastMatch, broadcastPublicLobby);

const getAuthedUserFromHello = async (
  initData?: string,
  sessionToken?: string | null,
): Promise<AuthedUser | null> => {
  if (sessionToken) {
    const session = await prisma.session.findFirst({
      where: {
        token: sessionToken,
        expiresAt: { gt: new Date() },
      },
      include: { user: true },
    });
    if (session?.user) {
      return {
        tgUserId: session.user.tgUserId,
        username: session.user.username,
        firstName: session.user.firstName,
        avatarUrl: session.user.avatarUrl,
        startParam: null,
      };
    }
  }

  if (!initData) return null;

  const real = validateTelegramInitData(initData, env.TELEGRAM_BOT_TOKEN);
  if (real) return real;

  return null;
};

const buildSession = async (tgUserId: string): Promise<string> => {
  const token = `s_${nanoid(24)}`;
  const ttlMs = env.SESSION_TTL_HOURS * 60 * 60 * 1_000;
  await prisma.session.create({
    data: {
      token,
      tgUserId,
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return token;
};

const attachSocketUser = (ws: WebSocket, user: AuthedUser): void => {
  const meta = bySocket.get(ws);
  if (!meta) return;
  meta.user = user;

  const set = socketsByUser.get(user.tgUserId) ?? new Set<WebSocket>();
  set.add(ws);
  socketsByUser.set(user.tgUserId, set);
};

const detachSocket = (ws: WebSocket): void => {
  const meta = bySocket.get(ws);
  if (!meta) return;

  if (meta.user) {
    const set = socketsByUser.get(meta.user.tgUserId);
    if (set) {
      set.delete(ws);
      if (set.size === 0) socketsByUser.delete(meta.user.tgUserId);
    }
  }

  bySocket.delete(ws);
};

app.get("/health", (_req, res) => {
  res.json({ ok: true, now: Date.now() });
});

app.get("/rooms/public", async (_req, res) => {
  const pools = await prisma.pool.findMany({
    where: { scope: "public" },
    include: { queueEntries: { where: { status: { in: ["locked", "in_match"] } } } },
  });
  res.json(
    pools.map((pool) => ({
      stakeNanotons: pool.stakeNanotons,
      playersOnline: pool.queueEntries.length,
      phase: pool.status,
    })),
  );
});

server.on("upgrade", (request, socket, head) => {
  const rawUrl = request.url ?? "";
  const pathname = (() => {
    try {
      return new URL(rawUrl, "http://localhost").pathname.replace(/\/+$/, "") || "/";
    } catch {
      return rawUrl.replace(/\?.*$/, "").replace(/\/+$/, "") || "/";
    }
  })();
  const expectedPath = env.WS_PATH.replace(/\/+$/, "") || "/";
  if (pathname !== expectedPath) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

  wss.on("connection", (ws, request) => {
    bySocket.set(ws, {
      connId: nanoid(10),
      ws,
      user: null,
      lastBalanceKey: null,
      lastDepositKey: null,
      lastReferralKey: null,
      isAlive: true,
    ip: ((request.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() || request.socket.remoteAddress) ?? null,
    });

  ws.on("pong", () => {
    const meta = bySocket.get(ws);
    if (meta) meta.isAlive = true;
  });

  ws.on("message", async (raw) => {
    try {
      const payload = String(raw);
      const meta = bySocket.get(ws);
      if (!meta) return;

      if (!limiter.hit(`msg:${meta.connId}`, 40, 1000)) {
        throw new WsError("RATE_LIMIT", "Too many messages");
      }

      const event = decodeClientEvent(payload);

      if (event.t === "hello") {
        const user = await getAuthedUserFromHello(event.initData, event.sessionToken ?? null);
        if (!user) throw new WsError("UNAUTHORIZED", "Auth failed");

        await game.ensureUser(user);
        const isBetaApproved =
          (await prisma.betaWhitelist.findUnique({ where: { tgUserId: user.tgUserId }, select: { tgUserId: true } })) !== null;
        const sessionToken = await buildSession(user.tgUserId);
        attachSocketUser(ws, user);

        const balance = await game.getBalance(user.tgUserId);
        ws.send(
          encodeServerEvent({
            t: "hello.ok",
            sessionToken,
            user: {
              tgUserId: user.tgUserId,
              username: user.username,
              name: user.firstName,
              avatarUrl: user.avatarUrl,
            },
            balance,
            serverTime: Date.now(),
            beta: { isApproved: isBetaApproved },
          }),
        );

        await game.sendPlayState(user.tgUserId);
        await game.sendReconnectState(user.tgUserId);
        return;
      }

      if (!meta.user) throw new WsError("UNAUTHORIZED", "Send hello first");
      const userId = meta.user.tgUserId;

      const isBetaApproved =
        (await prisma.betaWhitelist.findUnique({ where: { tgUserId: userId }, select: { tgUserId: true } })) !== null;
      if (!isBetaApproved && !isEventAllowedForBeta(event.t)) {
        throw new WsError("BETA_REQUIRED", "Closed beta: access required");
      }

      if (event.t === "beta.request_access") {
        logger.info({ userId, username: meta.user.username, ip: meta.ip }, "Beta access requested");
        sendToUser(userId, { t: "info", message: "Заявка отправлена" });
        return;
      }

      if (event.t === "beta.redeem_code") {
        if (!limiter.hit(`beta:${userId}`, 5, 10 * 60_000)) {
          logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: event.code, result: "rate_limit" });
          throw new WsError("RATE_LIMIT", "Too many attempts");
        }
        if (meta.ip && !limiter.hit(`beta-ip:${meta.ip}`, 30, 60 * 60_000)) {
          logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: event.code, result: "rate_limit" });
          throw new WsError("RATE_LIMIT", "Too many attempts");
        }

        const normalized = event.code.trim().toUpperCase();
        if (!/^[A-Z0-9-]{6,12}$/.test(normalized)) {
          logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: normalized, result: "invalid" });
          throw new WsError("BETA_CODE_INVALID", "Неверный код");
        }

        const alreadyApproved =
          (await prisma.betaWhitelist.findUnique({ where: { tgUserId: userId }, select: { tgUserId: true } })) !== null;
        if (alreadyApproved) {
          logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: normalized, result: "already" });
          throw new WsError("ALREADY_APPROVED", "Доступ уже активирован");
        }

        let codes: Set<string>;
        try {
          codes = getBetaCodes();
        } catch (error) {
          logger.error({ err: error }, "Failed to read beta codes file");
          logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: normalized, result: "error" });
          throw new WsError("BETA_CODE_INVALID", "Неверный код");
        }

        if (!codes.has(normalized)) {
          logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: normalized, result: "invalid" });
          throw new WsError("BETA_CODE_INVALID", "Неверный код");
        }

        const used = await prisma.betaCodesUsed.findUnique({ where: { code: normalized } });
        if (used) {
          logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: normalized, result: "used" });
          throw new WsError("BETA_CODE_USED", "Код уже использован");
        }

        await prisma.$transaction([
          prisma.betaWhitelist.create({ data: { tgUserId: userId, codeUsed: normalized } }),
          prisma.betaCodesUsed.create({ data: { code: normalized, tgUserId: userId } }),
        ]);

        logBetaAttempt({ tgUserId: userId, ip: meta.ip, code: normalized, result: "approved" });
        sendToUser(userId, { t: "beta.approved" });
        return;
      }

      if (event.t === "public.play") {
        if (!limiter.hit(`join:${userId}`, 10, 60_000)) throw new WsError("RATE_LIMIT", "Join limit exceeded");
        await game.joinPublicPool(userId, event.stakeTon);
        return;
      }

      if (event.t === "private.create") {
        if (!limiter.hit(`join:${userId}`, 10, 60_000)) throw new WsError("RATE_LIMIT", "Create/join limit exceeded");
        await game.createPrivateRoom(userId, event.stakeTon);
        return;
      }

      if (event.t === "private.join") {
        if (!limiter.hit(`join:${userId}`, 10, 60_000)) throw new WsError("RATE_LIMIT", "Create/join limit exceeded");
        await game.joinPrivateRoom(userId, event.code.toUpperCase(), event.stakeTon);
        return;
      }


      if (event.t === "room.leave.request") {
        await game.leaveRoom(userId);
        sendToUser(userId, { t: "room.left" });
        return;
      }

      if (event.t === "history.request") {
        const history = await game.getHistory(userId);
        sendToUser(userId, { t: "history.list", ...history });
        return;
      }

      if (event.t === "match.vote") {
        if (!limiter.hit(`vote:${userId}`, 1, 1_000)) throw new WsError("RATE_LIMIT", "Vote rate limit exceeded");
        await game.vote(userId, event.matchId, event.roundId, event.optionId);
        return;
      }

      if (event.t === "balance.deposit.request") {
        await game.createDepositIntent(userId, event.amountTon);
        return;
      }

      if (event.t === "balance.withdraw.request") {
        await game.requestWithdraw(userId, event.toAddress, event.amountTon);
        return;
      }
    } catch (error) {
      if (error instanceof WsError) {
        sendError(ws, error.code, error.message);
        return;
      }
      logger.error({ err: error }, "WS message error");
      // Ignore malformed payloads to avoid spamming user on connect.
    }
  });

  ws.on("close", () => {
    detachSocket(ws);
  });
});

const heartbeatTimer = setInterval(() => {
  for (const meta of bySocket.values()) {
    if (!meta.isAlive) {
      meta.ws.terminate();
      continue;
    }
    meta.isAlive = false;
    meta.ws.ping();
  }
}, 15_000);

  const balanceTimer = setInterval(async () => {
    for (const meta of bySocket.values()) {
      if (!meta.user) continue;
      try {
      const balance = await game.getBalance(meta.user.tgUserId);
      const key = `${balance.availableTon}:${balance.lockedTon}`;
      if (meta.lastBalanceKey !== null && meta.lastBalanceKey !== key) {
        sendToUser(meta.user.tgUserId, {
          t: "balance.updated",
          availableTon: balance.availableTon,
          lockedTon: balance.lockedTon,
        });
      }
      meta.lastBalanceKey = key;

      const latestDeposit = await prisma.deposit.findFirst({
        where: { tgUserId: meta.user.tgUserId },
        orderBy: { createdAt: "desc" },
      });
        if (latestDeposit) {
          const depositKey = `${latestDeposit.depositId}:${latestDeposit.status}:${latestDeposit.amountNanotons ?? ""}`;
          if (meta.lastDepositKey !== null && meta.lastDepositKey !== depositKey) {
            sendToUser(meta.user.tgUserId, {
              t: "deposit.info",
              address: latestDeposit.address,
              payload: latestDeposit.payload,
              status:
                latestDeposit.status === "confirmed"
                  ? "confirmed"
                  : latestDeposit.status === "expired"
                    ? "expired"
                    : "pending",
              amountTon: latestDeposit.amountNanotons ? nanoToTon(BigInt(latestDeposit.amountNanotons)) : undefined,
            });
          }
          meta.lastDepositKey = depositKey;
        }

        const user = await prisma.user.findUnique({ where: { tgUserId: meta.user.tgUserId } });
        const invitedCount = await prisma.user.count({ where: { invitedByTgUserId: meta.user.tgUserId } });
        const rewards = await prisma.referralReward.findMany({
          where: { inviterTgUserId: meta.user.tgUserId },
          select: { amountNanotons: true },
        });
        const refCode = user?.refCode ?? `ref_${meta.user.tgUserId}`;
        const totalRewardNano = rewards.reduce((sum, r) => sum + BigInt(r.amountNanotons), 0n);
        const referralKey = `${refCode}:${invitedCount}:${totalRewardNano.toString()}`;
        if (meta.lastReferralKey !== null && meta.lastReferralKey !== referralKey) {
          sendToUser(meta.user.tgUserId, {
            t: "referral.info",
            refCode,
            invitedCount,
            totalRewardTon: nanoToTon(totalRewardNano),
          });
        }
        meta.lastReferralKey = referralKey;
      } catch (error) {
        logger.error({ err: error, user: meta.user.tgUserId }, "Balance sync failed");
      }
    }
  }, 2_000);

async function bootstrap(): Promise<void> {
  await prisma.$connect();
  await initSqlitePragmas();
  game.start();
  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, wsPath: env.WS_PATH }, "Server started");
  });
}

void bootstrap();

const shutdown = async (): Promise<void> => {
  clearInterval(heartbeatTimer);
  clearInterval(balanceTimer);
  game.stop();
  wss.close();
  server.close();
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
