import { create } from "zustand";
import type { BalanceInfo, BetaInfo, HistoryInfo, MatchInfo, ReferralInfo, RoomInfo, TabKey, UserInfo } from "./types";

type ArenaState = {
  connected: boolean;
  tab: TabKey;
  sessionToken: string | null;
  user: UserInfo | null;
  balance: BalanceInfo;
  playOnline: number;
  minStakeTon: string;
  selectedStake: string;
  room: RoomInfo | null;
  match: MatchInfo | null;
  history: HistoryInfo | null;
  historyLoading: boolean;
  error: string | null;
  depositInfo: { address: string; payload: string; status: "pending" | "confirmed" | "expired"; amountTon?: string } | null;
  withdrawalInfo: { id: string; amountTon: string; status: "pending" | "processed" | "rejected" } | null;
  referralInfo: ReferralInfo | null;
  beta: BetaInfo;
  isInRoom: boolean;
  joinModalOpen: boolean;
  depositModalOpen: boolean;
  setConnected: (value: boolean) => void;
  setTab: (tab: TabKey) => void;
  setSessionToken: (token: string) => void;
  setUser: (user: UserInfo) => void;
  setBalance: (balance: Partial<BalanceInfo>) => void;
  setPlayState: (online: number, minStakeTon: string) => void;
  setSelectedStake: (stakeTon: string) => void;
  setRoom: (room: RoomInfo | null) => void;
  setMatch: (match: MatchInfo | null) => void;
  setHistory: (history: HistoryInfo | null) => void;
  setHistoryLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setDepositInfo: (info: ArenaState["depositInfo"]) => void;
  setWithdrawalInfo: (info: ArenaState["withdrawalInfo"]) => void;
  setReferralInfo: (info: ReferralInfo | null) => void;
  setBeta: (info: BetaInfo) => void;
  setIsInRoom: (value: boolean) => void;
  setJoinModalOpen: (open: boolean) => void;
  setDepositModalOpen: (open: boolean) => void;
};

const storedToken = typeof localStorage !== "undefined" ? localStorage.getItem("arena.session") : null;

export const useArenaStore = create<ArenaState>((set) => ({
  connected: false,
  tab: "play",
  sessionToken: storedToken,
  user: null,
  balance: { availableTon: "0", lockedTon: "0" },
  playOnline: 0,
  minStakeTon: "0.1",
  selectedStake: "0.1",
  room: null,
  match: null,
  history: null,
  historyLoading: false,
  error: null,
  depositInfo: null,
  withdrawalInfo: null,
  referralInfo: null,
  beta: { isApproved: false },
  isInRoom: false,
  joinModalOpen: false,
  depositModalOpen: false,
  setConnected: (value) => set({ connected: value }),
  setTab: (tab) => set({ tab }),
  setSessionToken: (token) => {
    localStorage.setItem("arena.session", token);
    set({ sessionToken: token });
  },
  setUser: (user) => set({ user }),
  setBalance: (balance) => set((state) => ({ balance: { ...state.balance, ...balance } })),
  setPlayState: (online, minStakeTon) => set({ playOnline: online, minStakeTon }),
  setSelectedStake: (stakeTon) => set({ selectedStake: stakeTon }),
  setRoom: (room) => set({ room }),
  setMatch: (match) => set({ match }),
  setHistory: (history) => set({ history }),
  setHistoryLoading: (historyLoading) => set({ historyLoading }),
  setError: (error) => set({ error }),
  setDepositInfo: (depositInfo) => set({ depositInfo }),
  setWithdrawalInfo: (withdrawalInfo) => set({ withdrawalInfo }),
  setReferralInfo: (referralInfo) => set({ referralInfo }),
  setBeta: (beta) => set({ beta }),
  setIsInRoom: (isInRoom) => set({ isInRoom }),
  setJoinModalOpen: (joinModalOpen) => set({ joinModalOpen }),
  setDepositModalOpen: (depositModalOpen) => set({ depositModalOpen }),
}));
