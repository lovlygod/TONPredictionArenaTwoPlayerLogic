export type TabKey = "play" | "rooms" | "profile" | "history";

export type UserInfo = {
  tgUserId: string;
  username: string | null;
  name: string;
  avatarUrl: string | null;
};

export type BalanceInfo = {
  availableTon: string;
  lockedTon: string;
};

export type RoomInfo = {
  scope: "public" | "private";
  code: string;
  stakeTon: string;
  playersOnline: number;
  phase: "idle" | "prestart" | "running" | "ended";
  countdownEndsAt: number | null;
};

export type RoundQuestion = {
  id: string;
  text: string;
  options: Array<{ id: string; text: string }>;
};

export type MatchInfo = {
  matchId: string;
  roundId: number;
  voteEndsAt: number;
  startedAt?: number;
  question: RoundQuestion | null;
  potTon?: string;
  stakeTon?: string;
  participants?: Array<{ id: string; name: string }>;
  lastReveal?: {
    majority: string | null;
    counts: Record<string, number>;
    eliminatedIds: string[];
    aliveCount: number;
  };
};

export type HistoryInfo = {
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
};

export type ReferralInfo = {
  refCode: string;
  invitedCount: number;
  totalRewardTon: string;
};

export type BetaInfo = {
  isApproved: boolean;
};
