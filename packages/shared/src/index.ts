import { z } from "zod";

export const MIN_STAKE_TON = "0.1";

const tonString = z.string().regex(/^\d+(\.\d{1,9})?$/, "invalid TON string");

export const helloEventSchema = z.object({
  t: z.literal("hello"),
  initData: z.string().optional(),
  sessionToken: z.string().nullable().optional(),
  clientVersion: z.string().min(1),
});

export const betaRedeemCodeEventSchema = z.object({
  t: z.literal("beta.redeem_code"),
  code: z.string().min(1),
});

export const betaRequestAccessEventSchema = z.object({
  t: z.literal("beta.request_access"),
});

export const publicPlayEventSchema = z.object({
  t: z.literal("public.play"),
  stakeTon: tonString,
});

export const privateCreateEventSchema = z.object({
  t: z.literal("private.create"),
  stakeTon: tonString,
  title: z.string().max(64).optional(),
});

export const privateJoinEventSchema = z.object({
  t: z.literal("private.join"),
  code: z.string().length(6),
  stakeTon: tonString,
});


export const roomLeaveRequestEventSchema = z.object({
  t: z.literal("room.leave.request"),
});

export const historyRequestEventSchema = z.object({
  t: z.literal("history.request"),
});

export const matchVoteEventSchema = z.object({
  t: z.literal("match.vote"),
  matchId: z.string().min(1),
  roundId: z.number().int().min(1),
  optionId: z.string().min(1),
});

export const balanceDepositRequestEventSchema = z.object({
  t: z.literal("balance.deposit.request"),
  amountTon: tonString.optional(),
});

export const balanceWithdrawRequestEventSchema = z.object({
  t: z.literal("balance.withdraw.request"),
  toAddress: z.string().min(10),
  amountTon: tonString,
});

export const clientEventSchema = z.discriminatedUnion("t", [
  helloEventSchema,
  betaRedeemCodeEventSchema,
  betaRequestAccessEventSchema,
  publicPlayEventSchema,
  privateCreateEventSchema,
  privateJoinEventSchema,
  roomLeaveRequestEventSchema,
  historyRequestEventSchema,
  matchVoteEventSchema,
  balanceDepositRequestEventSchema,
  balanceWithdrawRequestEventSchema,
]);

const balanceSchema = z.object({
  availableTon: tonString,
  lockedTon: tonString,
});

export const helloOkEventSchema = z.object({
  t: z.literal("hello.ok"),
  sessionToken: z.string(),
  user: z.object({
    tgUserId: z.string(),
    username: z.string().nullable(),
    name: z.string(),
    avatarUrl: z.string().nullable(),
  }),
  balance: balanceSchema,
  serverTime: z.number().int(),
  beta: z.object({
    isApproved: z.boolean(),
  }),
});

export const betaApprovedEventSchema = z.object({
  t: z.literal("beta.approved"),
});

export const navPlayStateEventSchema = z.object({
  t: z.literal("nav.play.state"),
  online: z.number().int().nonnegative(),
  minStakeTon: tonString,
});

export const roomCreatedEventSchema = z.object({
  t: z.literal("room.created"),
  scope: z.enum(["public", "private"]),
  code: z.string(),
  stakeTon: tonString,
});

export const roomStateEventSchema = z.object({
  t: z.literal("room.state"),
  scope: z.enum(["public", "private"]),
  code: z.string(),
  stakeTon: tonString,
  playersOnline: z.number().int().nonnegative(),
  phase: z.enum(["idle", "prestart", "running", "ended"]),
  countdownEndsAt: z.number().int().nullable(),
});

export const roomLobbyEventSchema = z.object({
  t: z.literal("room.lobby"),
  scope: z.enum(["public", "private"]),
  code: z.string(),
  stakeTon: tonString,
  playersOnline: z.number().int().nonnegative(),
  phase: z.enum(["idle", "prestart", "running", "ended"]),
  countdownEndsAt: z.number().int().nullable(),
});


export const roomLeftEventSchema = z.object({
  t: z.literal("room.left"),
});

export const historyListEventSchema = z.object({
  t: z.literal("history.list"),
  deposits: z.array(
    z.object({
      id: z.string(),
      amountTon: tonString.optional(),
      status: z.enum(["pending", "confirmed", "expired"]),
      createdAt: z.number().int(),
    }),
  ),
  withdrawals: z.array(
    z.object({
      id: z.string(),
      amountTon: tonString,
      status: z.enum(["pending", "processed", "rejected"]),
      createdAt: z.number().int(),
    }),
  ),
  matches: z.array(
    z.object({
      matchId: z.string(),
      stakeTon: tonString,
      potTon: tonString,
      feeTon: tonString,
      payoutTon: tonString,
      winnerId: z.string().nullable(),
      result: z.enum(["win", "lose"]),
      endedAt: z.number().int(),
    }),
  ),
});

export const matchCreatedEventSchema = z.object({
  t: z.literal("match.created"),
  matchId: z.string(),
  stakeTon: tonString,
  potTon: tonString,
  feePct: z.number().int(),
  participants: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
  startsAt: z.number().int(),
});

export const roundStartEventSchema = z.object({
  t: z.literal("round.start"),
  matchId: z.string(),
  roundId: z.number().int().min(1),
  voteEndsAt: z.number().int(),
  question: z.object({
    id: z.string(),
    text: z.string(),
    options: z.array(
      z.object({
        id: z.string(),
        text: z.string(),
      }),
    ),
  }),
});

export const roundRevealEventSchema = z.object({
  t: z.literal("round.reveal"),
  matchId: z.string(),
  roundId: z.number().int().min(1),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  majority: z.string().nullable(),
  eliminatedIds: z.array(z.string()),
  aliveCount: z.number().int().nonnegative(),
});

export const matchEndEventSchema = z.object({
  t: z.literal("match.end"),
  matchId: z.string(),
  winnerId: z.string(),
  potTon: tonString,
  feeTon: tonString,
  payoutTon: tonString,
  balance: balanceSchema,
});

export const balanceUpdatedEventSchema = z.object({
  t: z.literal("balance.updated"),
  availableTon: tonString,
  lockedTon: tonString,
});

export const depositInfoEventSchema = z.object({
  t: z.literal("deposit.info"),
  address: z.string(),
  payload: z.string(),
  status: z.enum(["pending", "confirmed", "expired"]),
  amountTon: tonString.optional(),
});

export const withdrawalInfoEventSchema = z.object({
  t: z.literal("withdrawal.info"),
  id: z.string(),
  amountTon: tonString,
  status: z.enum(["pending", "processed", "rejected"]),
});

export const referralInfoEventSchema = z.object({
  t: z.literal("referral.info"),
  refCode: z.string(),
  invitedCount: z.number().int().nonnegative(),
  totalRewardTon: tonString,
});

export const errorEventSchema = z.object({
  t: z.literal("error"),
  code: z.enum([
    "BETA_REQUIRED",
    "BETA_CODE_INVALID",
    "BETA_CODE_USED",
    "ALREADY_APPROVED",
    "INSUFFICIENT_FUNDS",
    "ROOM_NOT_FOUND",
    "ROOM_CLOSED",
    "STAKE_TOO_LOW",
    "ALREADY_IN_MATCH",
    "VOTE_CLOSED",
    "NOT_ALIVE",
    "RATE_LIMIT",
    "BAD_REQUEST",
    "UNAUTHORIZED",
  ]),
  message: z.string(),
});

export const infoEventSchema = z.object({
  t: z.literal("info"),
  message: z.string(),
});

export const serverEventSchema = z.discriminatedUnion("t", [
  helloOkEventSchema,
  betaApprovedEventSchema,
  navPlayStateEventSchema,
  roomCreatedEventSchema,
  roomStateEventSchema,
  roomLobbyEventSchema,
  roomLeftEventSchema,
  historyListEventSchema,
  matchCreatedEventSchema,
  roundStartEventSchema,
  roundRevealEventSchema,
  matchEndEventSchema,
  balanceUpdatedEventSchema,
  depositInfoEventSchema,
  withdrawalInfoEventSchema,
  referralInfoEventSchema,
  infoEventSchema,
  errorEventSchema,
]);

export type ClientEvent = z.infer<typeof clientEventSchema>;
export type ServerEvent = z.infer<typeof serverEventSchema>;
export type ServerErrorEvent = z.infer<typeof errorEventSchema>;

export function decodeClientEvent(raw: string): ClientEvent {
  const parsed = JSON.parse(raw);
  return clientEventSchema.parse(parsed);
}

export function decodeServerEvent(raw: string): ServerEvent {
  const parsed = JSON.parse(raw);
  return serverEventSchema.parse(parsed);
}

export function encodeServerEvent(event: ServerEvent): string {
  return JSON.stringify(serverEventSchema.parse(event));
}

export function encodeClientEvent(event: ClientEvent): string {
  return JSON.stringify(clientEventSchema.parse(event));
}

export function tonToNano(ton: string): bigint {
  const [intPart, fracPart = ""] = ton.split(".");
  const padded = `${fracPart}000000000`.slice(0, 9);
  return BigInt(intPart) * 1_000_000_000n + BigInt(padded);
}

export function nanoToTon(nano: bigint): string {
  const negative = nano < 0n;
  const value = negative ? -nano : nano;
  const intPart = value / 1_000_000_000n;
  const fracPart = (value % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  const formatted = fracPart ? `${intPart.toString()}.${fracPart}` : intPart.toString();
  return negative ? `-${formatted}` : formatted;
}
