import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Crown,
  DoorOpen,
  PlayCircle,
  Plus,
  Wallet,
  History,
  Copy,
  Link2,
  TimerReset,
  CircleAlert,
  Sparkles,
  LogOut,
  QrCode,
  BadgeCheck,
  Skull,
  Users,
} from "lucide-react";
import { Fire } from "@phosphor-icons/react";
import { TonConnectButton, useTonWallet } from "@tonconnect/ui-react";
import { nanoToTon, tonToNano, type ServerEvent } from "@arena/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getInitDataRaw, openExternalLink, safeTelegramReady } from "@/lib/telegram";
import { WsClient } from "@/lib/ws";
import { useArenaStore } from "@/store/useArenaStore";

const presetStakes = ["0.1", "0.2", "0.5", "1"];

function timeLeftMs(ts: number | null): number {
  if (!ts) return 0;
  return Math.max(0, ts - Date.now());
}

export default function App(): JSX.Element {
  const store = useArenaStore();
  const wsRef = useRef<WsClient | null>(null);
  const tonWallet = useTonWallet();

  const [customStake, setCustomStake] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [withdrawAddress, setWithdrawAddress] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0.1");
  const [depositAmount, setDepositAmount] = useState("");
  const [walletBalanceTon, setWalletBalanceTon] = useState<string | null>(null);
  const [walletBalanceLoading, setWalletBalanceLoading] = useState(false);
  const [walletBalanceError, setWalletBalanceError] = useState<string | null>(null);
  const [betaCode, setBetaCode] = useState("");
  const [betaLoading, setBetaLoading] = useState(false);
  const [betaError, setBetaError] = useState<string | null>(null);
  const [betaSuccess, setBetaSuccess] = useState(false);
  const [, setNow] = useState(Date.now());
  const [toastVisible, setToastVisible] = useState(false);
  const [toastClosing, setToastClosing] = useState(false);
  const [lastErrorCode, setLastErrorCode] = useState<string | null>(null);
  const [revealVisible, setRevealVisible] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<{ result: "win" | "lose"; payoutTon?: string } | null>(null);
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [infoVisible, setInfoVisible] = useState(false);
  const [infoClosing, setInfoClosing] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);

  const send = (event: Parameters<WsClient["send"]>[0]): void => wsRef.current?.send(event);

  useEffect(() => {
    safeTelegramReady();

    const wsUrl = (() => {
      const proto = window.location.protocol === "https:" ? "wss" : "ws";
      const host = import.meta.env.VITE_SERVER_WS_HOST ?? `${window.location.hostname}:4000`;
      const path = import.meta.env.VITE_SERVER_WS_PATH ?? "/ws";
      return `${proto}://${host}${path}`;
    })();

    const client = new WsClient(wsUrl, {
      onOpen: () => {
        store.setConnected(true);
        store.setError(null);
        client.send({
          t: "hello",
          initData: getInitDataRaw(),
          sessionToken: store.sessionToken,
          clientVersion: "1.0.0",
        });
      },
      onClose: () => store.setConnected(false),
      onError: (message) => store.setError(message),
      onEvent: (event) => handleServerEvent(event),
    });

    wsRef.current = client;
    client.connect();

    const timer = window.setInterval(() => setNow(Date.now()), 250);

    return () => {
      window.clearInterval(timer);
      client.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (tonWallet?.account?.address) {
      setWithdrawAddress(tonWallet.account.address);
    }
  }, [tonWallet]);

  useEffect(() => {
    const address = tonWallet?.account?.address;
    if (!address) {
      setWalletBalanceTon(null);
      setWalletBalanceError(null);
      return;
    }

    let cancelled = false;
    setWalletBalanceLoading(true);
    setWalletBalanceError(null);

    fetch(`https://tonapi.io/v2/blockchain/accounts/${encodeURIComponent(address)}`)
      .then(async (response) => {
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || `HTTP ${response.status}`);
        }
        return response.json();
      })
      .then((data: { balance?: string }) => {
        if (cancelled) return;
        const balanceNano = data?.balance ? BigInt(data.balance) : 0n;
        setWalletBalanceTon(nanoToTon(balanceNano));
      })
      .catch((error) => {
        if (cancelled) return;
        setWalletBalanceError(error instanceof Error ? error.message : "Не удалось получить баланс кошелька");
        setWalletBalanceTon(null);
      })
      .finally(() => {
        if (!cancelled) setWalletBalanceLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tonWallet?.account?.address]);

  useEffect(() => {
    if (!store.error) return;
    setToastVisible(true);
    setToastClosing(false);
    const closeTimer = window.setTimeout(() => setToastClosing(true), 4_500);
    const clearTimer = window.setTimeout(() => {
      setToastVisible(false);
      setToastClosing(false);
      store.setError(null);
    }, 5_000);
    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [store, store.error]);

  useEffect(() => {
    if (betaSuccess) {
      setInfoMessage("Доступ активирован");
      const timer = window.setTimeout(() => setBetaSuccess(false), 2_000);
      return () => window.clearTimeout(timer);
    }
  }, [betaSuccess]);

  useEffect(() => {
    if (store.error) return;
    setLastErrorCode(null);
  }, [store.error]);

  useEffect(() => {
    if (!lastOutcome) return;
    const timer = window.setTimeout(() => setLastOutcome(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [lastOutcome]);

  useEffect(() => {
    if (!infoMessage) return;
    setInfoVisible(true);
    setInfoClosing(false);
    const closeTimer = window.setTimeout(() => setInfoClosing(true), 2_500);
    const clearTimer = window.setTimeout(() => {
      setInfoVisible(false);
      setInfoClosing(false);
      setInfoMessage(null);
    }, 3_000);
    return () => {
      window.clearTimeout(closeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [infoMessage]);

  useEffect(() => {
    if (store.tab !== "history") return;
    if (store.historyLoading) return;
    if (store.history) return;
    store.setHistoryLoading(true);
    send({ t: "history.request" });
  }, [store, store.tab, store.history, store.historyLoading, send]);

  useEffect(() => {
    const onError = (event: ErrorEvent): void => {
      const message = event.error?.stack || event.message || "Неизвестная ошибка";
      setFatalError(`Ошибка приложения: ${message}`);
    };
    const onRejection = (event: PromiseRejectionEvent): void => {
      const reason = event.reason instanceof Error ? event.reason.stack || event.reason.message : String(event.reason);
      setFatalError(`Ошибка промиса: ${reason}`);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  const totalTon = useMemo(() => {
    return (Number(store.balance.availableTon) + Number(store.balance.lockedTon)).toFixed(3);
  }, [store.balance.availableTon, store.balance.lockedTon]);
  const avatarFallback = useMemo(() => {
    const base = store.user?.name ?? store.user?.username ?? "U";
    return base.trim().slice(0, 1).toUpperCase() || "U";
  }, [store.user?.name, store.user?.username]);

  const roomCountdownSec = Math.ceil(timeLeftMs(store.room?.countdownEndsAt ?? null) / 1000);
  const voteCountdownSec = Math.ceil(timeLeftMs(store.match?.voteEndsAt ?? null) / 1000);
  const withdrawalWalletAddress = (import.meta.env.VITE_WITHDRAWAL_WALLET_ADDRESS as string | undefined) ?? "";

  const handleServerEvent = (event: ServerEvent): void => {
    const state = useArenaStore.getState();
    switch (event.t) {
      case "hello.ok":
        state.setSessionToken(event.sessionToken);
        state.setUser(event.user);
        state.setBalance({ availableTon: event.balance.availableTon, lockedTon: event.balance.lockedTon });
        state.setBeta(event.beta);
        break;
      case "nav.play.state":
        state.setPlayState(event.online, event.minStakeTon);
        break;
      case "room.created":
        state.setTab("play");
        state.setRoom({
          scope: event.scope,
          code: event.code,
          stakeTon: event.stakeTon,
          playersOnline: 1,
          phase: "idle",
          countdownEndsAt: null,
        });
        state.setIsInRoom(true);
        break;
      case "room.state":
        state.setRoom(event);
        state.setIsInRoom(true);
        if (event.phase !== "running" && state.match) {
          state.setMatch(null);
        }
        break;
      case "room.lobby":
        state.setRoom(event);
        if (event.phase !== "running" && state.match) {
          state.setMatch(null);
        }
        break;
      case "room.left":
        state.setRoom(null);
        state.setMatch(null);
        state.setIsInRoom(false);
        break;
      case "match.created":
        state.setIsInRoom(true);
        state.setMatch({
          matchId: event.matchId,
          roundId: 0,
          voteEndsAt: event.startsAt,
          question: null,
          potTon: event.potTon,
          stakeTon: event.stakeTon,
          participants: event.participants,
        });
        break;
      case "round.start":
        setSelectedOptionId(null);
        state.setMatch({
          matchId: event.matchId,
          roundId: event.roundId,
          voteEndsAt: event.voteEndsAt,
          startedAt: Date.now(),
          question: event.question,
          lastReveal: state.match?.lastReveal,
          potTon: state.match?.potTon,
          stakeTon: state.match?.stakeTon,
          participants: state.match?.participants,
        });
        break;
      case "round.reveal":
        state.setMatch(
          state.match
            ? {
                ...state.match,
                lastReveal: {
                  majority: event.majority,
                  counts: event.counts,
                  eliminatedIds: event.eliminatedIds,
                  aliveCount: event.aliveCount,
                },
              }
            : null,
        );
        setRevealVisible(true);
        window.setTimeout(() => setRevealVisible(false), 2_500);
        break;
      case "match.end":
        state.setBalance({ availableTon: event.balance.availableTon, lockedTon: event.balance.lockedTon });
        setLastOutcome({
          result: event.winnerId === state.user?.tgUserId ? "win" : "lose",
          payoutTon: event.payoutTon,
        });
        state.setError(event.winnerId === state.user?.tgUserId ? `Победа! +${event.payoutTon} TON` : "Матч завершён");
        state.setMatch(null);
        state.setRoom(null);
        state.setIsInRoom(false);
        break;
      case "balance.updated":
        state.setBalance({ availableTon: event.availableTon, lockedTon: event.lockedTon });
        break;
      case "deposit.info":
        state.setDepositInfo(event);
        break;
      case "withdrawal.info":
        state.setWithdrawalInfo(event);
        break;
      case "referral.info":
        state.setReferralInfo({
          refCode: event.refCode,
          invitedCount: event.invitedCount,
          totalRewardTon: event.totalRewardTon,
        });
        break;
      case "info":
        setInfoMessage(event.message);
        break;
      case "history.list":
        state.setHistory(event);
        state.setHistoryLoading(false);
        break;
      case "error":
        state.setError(event.message);
        setLastErrorCode(event.code);
        if (["BETA_CODE_INVALID", "BETA_CODE_USED", "RATE_LIMIT", "ALREADY_APPROVED"].includes(event.code)) {
          setBetaLoading(false);
          setBetaError(event.message);
        }
        break;
      case "beta.approved":
        state.setBeta({ isApproved: true });
        setBetaLoading(false);
        setBetaError(null);
        setBetaSuccess(true);
        state.setTab("play");
        break;
    }
  };

  const activeStake = customStake.trim().length > 0 ? customStake.trim() : store.selectedStake;
  const isWithdrawAddressValid = isValidTonAddress(withdrawAddress);
  const showWithdrawAddressError = withdrawAddress.trim().length > 0 && !isWithdrawAddressValid;
  const isWithdrawAmountValid = Number(withdrawAmount) > 0;
  const canWithdraw = isWithdrawAddressValid && isWithdrawAmountValid;
  const canLeaveRoom = !!store.room && store.room.phase !== "running" && store.room.playersOnline <= 1;
  const roomPhaseLabel = roomPhaseToLabel(store.room?.phase);
  const roomPhaseTone = roomPhaseToTone(store.room?.phase);
  const isOffline = !store.connected;
  const isLoading = store.connected && !store.user;
  const voteTotalMs = store.match?.startedAt ? Math.max(1000, store.match.voteEndsAt - store.match.startedAt) : 15_000;
  const voteRemainingMs = timeLeftMs(store.match?.voteEndsAt ?? null);
  const voteProgress = Math.min(1, Math.max(0, 1 - voteRemainingMs / voteTotalMs));
  const cleanedDepositAmount = sanitizeTonInput(depositAmount);
  const connectedWithdrawAddress = tonWallet?.account?.address ?? "";
  const withdrawAddressValue = connectedWithdrawAddress || withdrawAddress;
  const hasInsufficientWalletBalance =
    !!tonWallet?.account?.address &&
    !!cleanedDepositAmount &&
    walletBalanceTon !== null &&
    Number(cleanedDepositAmount) > Number(walletBalanceTon);
  const depositLink = store.depositInfo
    ? buildTonTransferLink(
        store.depositInfo.address,
        store.depositInfo.payload,
        cleanedDepositAmount || store.depositInfo.amountTon,
      )
    : "";
  const roomStakeLabel = formatStakeLabel(store.room?.stakeTon ?? null, store.room?.scope ?? null);
  const botUsername = (import.meta.env.VITE_TG_BOT_USERNAME as string | undefined) ?? "";
  const aboutUrl = "/about.html";
  const referralInfo = store.referralInfo ??
    (store.user
      ? { refCode: `ref_${store.user.tgUserId}`, invitedCount: 0, totalRewardTon: "0" }
      : null);
  const match = store.match;
  const depositInfo = store.depositInfo;

  const isBetaBlocked = store.user && !store.beta.isApproved;

  if (isBetaBlocked) {
    return (
      <div className="app-shell mx-auto flex min-h-[100dvh] max-w-xl flex-col items-center justify-center px-6 py-8 text-white">
        <div className="glass w-full max-w-[420px] p-6 sm:p-7">
          <div className="text-center">
            <div className="text-xs uppercase tracking-[0.32em] text-white/50">Closed Beta</div>
            <div className="mt-3 text-3xl font-semibold text-white/90">Closed Beta</div>
            <div className="mt-2 text-sm text-white/60">Доступ по приглашению (50 мест)</div>
          </div>
          <div className="mt-6 grid gap-4">
            <div>
              <Input
                placeholder="Введите код доступа"
                value={betaCode}
                onChange={(e) => {
                  const normalized = e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "");
                  setBetaCode(normalized.slice(0, 12));
                  setBetaError(null);
                }}
                className={betaError ? "border-danger/50 focus-visible:ring-danger/30" : ""}
              />
              {betaError && <div className="mt-2 text-xs text-danger">{betaError}</div>}
            </div>
            <Button
              className="w-full"
              disabled={betaLoading || betaCode.trim().length < 6}
              onClick={() => {
                setBetaLoading(true);
                setBetaError(null);
                send({ t: "beta.redeem_code", code: betaCode });
              }}
            >
              {betaLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="h-3 w-3 animate-spin rounded-full border border-white/50 border-t-transparent" /> Проверяем…
                </span>
              ) : (
                "Продолжить"
              )}
            </Button>
            <div className="text-center text-[11px] text-white/50">
              Код выдаётся вручную. Если у вас нет кода — попросите у автора.
            </div>
            <Button
              className="w-full"
              variant="ghost"
              disabled={betaLoading}
              onClick={() => send({ t: "beta.request_access" })}
            >
              Запросить доступ
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell mx-auto max-w-xl px-3 pb-[calc(140px+env(safe-area-inset-bottom))] pt-5 text-white sm:px-5 sm:pt-6">
      {fatalError && (
        <div className="fixed left-4 right-4 top-4 z-[9999] rounded-xl border border-red-400 bg-red-950/90 p-3 text-xs text-red-100">
          {fatalError}
        </div>
      )}
      <header className="glass mb-6 flex items-center justify-between px-5 py-4">
        <div>
          <div className="text-lg font-semibold">Арена прогнозов</div>
          <div className="text-xs text-slate-300">Думай как большинство</div>
        </div>
        <button className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm" onClick={() => store.setTab("profile")}>
          <span className="text-white/70">●</span> {store.balance.availableTon} TON
        </button>
      </header>

      {isOffline && (
        <div className="glass mb-4 flex items-center justify-between border-danger/40 px-4 py-3 text-sm text-slate-200">
          <div>Нет соединения. Проверяем сеть…</div>
          <span className="text-danger">не в сети</span>
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          <div className="glass h-28 animate-pulse bg-white/5" />
          <div className="glass h-36 animate-pulse bg-white/5" />
          <div className="glass h-24 animate-pulse bg-white/5" />
        </div>
      )}

      <AnimatePresence mode="wait">
        {store.tab === "play" && (
          <motion.section key="play" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            {match ? (
              <div className="space-y-4">
                <div className="glass flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <button
                      className="rounded-lg border border-white/15 bg-white/10 px-2 py-1"
                      onClick={() => navigator.clipboard.writeText(store.room?.code ?? "ARENA")}
                    >
                      Комната #{store.room?.code ?? "ARENA"} <Copy className="ml-1 inline h-3 w-3" />
                    </button>
                    <button
                      className="rounded-lg border border-white/15 bg-white/10 px-2 py-1"
                      onClick={() => navigator.clipboard.writeText(store.room?.code ?? "ARENA")}
                    >
                      <Link2 className="h-3 w-3" />
                    </button>
                  </div>
                  <div className="text-right text-xs text-slate-300">
                    <div>{store.room?.playersOnline ?? 0} игроков</div>
                    <div>{formatStakeLabel(store.room?.stakeTon ?? store.match?.stakeTon ?? null, store.room?.scope ?? "public")}</div>
                  </div>
                </div>

                {match.question ? (
                  <div className="glass relative overflow-hidden p-5">
                    <div className="mb-2 flex items-center justify-between text-sm">
                      <div>Раунд {match.roundId}</div>
                      <div className="flex items-center gap-3">
                        {match.potTon && (
                          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/80">
                            Общий банк: {match.potTon} TON
                          </div>
                        )}
                        <div className={voteCountdownSec <= 5 ? "text-white/60 animate-pulsefast" : "text-white/70"}>
                          <TimerReset className="mr-1 inline h-4 w-4" /> {voteCountdownSec}s
                        </div>
                        <div className={`relative h-16 w-16 ${voteCountdownSec <= 5 ? "animate-pulsefast" : ""}`}>
                          <div
                            className="absolute inset-0 rounded-full"
                            style={{
                              background: `conic-gradient(rgba(45,212,255,0.95) ${voteProgress * 360}deg, rgba(255,255,255,0.12) 0deg)`,
                            }}
                          />
                          <div className="absolute inset-2 flex items-center justify-center rounded-full border border-white/10 bg-black/70 text-xs text-white">
                            {voteCountdownSec}s
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-4 text-center text-lg font-semibold">{match.question.text}</div>
                    <div className="grid gap-2">
                      {match.question.options.map((option) => (
                        <Button
                          key={option.id}
                          variant="ghost"
                          className={`justify-start text-left ${selectedOptionId === option.id ? "border-white/30 bg-white/10" : ""}`}
                          onClick={() => {
                            setSelectedOptionId(option.id);
                            send({
                              t: "match.vote",
                              matchId: match.matchId ?? "",
                              roundId: match.roundId ?? 1,
                              optionId: option.id,
                            });
                          }}
                        >
                          {option.id}. {option.text}
                        </Button>
                      ))}
                    </div>

                    <AnimatePresence>
                      {revealVisible && match.lastReveal && (
                        <motion.div
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="glass-modal mt-4 border-cyan-400/30 p-4 text-sm"
                        >
                          <div className="flex items-center justify-between text-xs text-slate-400">
                             <span>Результат</span>
                             <span>В игре: {match.lastReveal?.aliveCount ?? 0}</span>
                          </div>
                          <div className="mt-2 grid gap-2">
                            {Object.entries(match.lastReveal.counts).map(([key, value]) => (
                              <div
                                key={key}
                                className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                                  match.lastReveal?.majority === key
                                    ? "border-white/30 bg-white/10 text-white/90"
                                    : "border-white/10 bg-white/5 text-white/50"
                                }`}
                              >
                                 <span>Вариант {key}</span>
                                <span>{value}</span>
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                ) : (
                  <div className="glass p-5 text-center">
                    <div className="text-base font-semibold">Матч скоро начнётся</div>
                    <div className="mt-2 text-sm text-slate-300">
                      Ожидаем первый раунд. Игроки: {store.room?.playersOnline ?? 0}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <>
            <div className="glass relative overflow-hidden p-6 text-center">
              <div className="absolute inset-0">
                <div
                  className="h-full w-full bg-cover bg-center opacity-35"
                  style={{ backgroundImage: "url('/background.png')" }}
                />
                <div className="absolute inset-0 bg-black/40" />
              </div>
              <div className="relative">
              <div className="text-xs uppercase tracking-[0.32em] text-white/50">Арена</div>
              <div className="mt-3 text-2xl font-semibold text-white/90">Арена прогнозов</div>
              <div className="mt-2 text-sm text-white/60">Думай как большинство</div>
              <div className="mt-6 grid grid-cols-2 gap-4 text-sm">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
                  <div className="text-xs text-white/50">Ваш баланс</div>
                  <div className="mt-1 text-lg font-semibold text-white">{totalTon} TON</div>
                  <div className="text-xs text-white/40">
                    Доступно {store.balance.availableTon} • Заморожено {store.balance.lockedTon}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-left">
                  <div className="text-xs text-white/50">Онлайн</div>
                  <div className="mt-1 text-lg font-semibold text-white">{store.playOnline}</div>
                <div className="text-xs text-white/40">Мин. ставка {store.minStakeTon} TON</div>
              </div>
            </div>
              <Button className="mt-6 w-full" onClick={() => send({ t: "public.play", stakeTon: activeStake })}>
                <PlayCircle className="mr-2 h-4 w-4" /> Войти в арену
              </Button>
              <Button className="mt-3 w-full" variant="ghost" onClick={() => (window.location.href = aboutUrl)}>
                Суть игры
              </Button>
              </div>
            </div>

            {lastErrorCode === "INSUFFICIENT_FUNDS" && (
              <div className="glass border-danger/40 p-4 text-sm">
                <div className="mb-2 flex items-center gap-2 text-danger">
                  <CircleAlert className="h-4 w-4" /> Недостаточно баланса
                </div>
                <div className="text-slate-300">Пополните баланс, чтобы начать матч.</div>
                <Button
                  className="mt-3 w-full"
                  variant="ghost"
                  onClick={() => {
                    store.setDepositModalOpen(true);
                    send({ t: "balance.deposit.request" });
                  }}
                >
                  Пополнить
                </Button>
              </div>
            )}

            <div className="glass p-6">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-base font-semibold">Ставка</div>
                <div className="text-xs text-white/40">Выберите размер</div>
              </div>
              <div className="grid grid-cols-4 gap-3">
                {presetStakes.map((stake) => (
                  <button
                    key={stake}
                    className={`rounded-[18px] border px-3 py-2 text-sm ${
                      store.selectedStake === stake ? "border-white/30 bg-white/10" : "border-white/10 bg-white/5"
                    }`}
                    onClick={() => {
                      setCustomStake("");
                      store.setSelectedStake(stake);
                    }}
                  >
                    {stake}
                  </button>
                ))}
              </div>
              <Input
                className="mt-2"
                placeholder="Своя сумма TON"
                value={customStake}
                onChange={(e) => setCustomStake(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </div>

            <div className="glass p-4">
              <div className="mb-2 flex items-center gap-2 text-base font-semibold">
                <Users className="h-4 w-4 text-white/70" /> Приватные комнаты
              </div>
              <div className="text-sm text-slate-300">Откройте вкладку «Комнаты» внизу, чтобы создать приватную комнату или зайти по коду.</div>
              <Button className="mt-3 w-full" variant="ghost" onClick={() => store.setTab("rooms")}
              >
                Перейти к приватным комнатам
              </Button>
            </div>

            {store.room ? (
              <div className="glass p-6">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-base font-semibold">Текущая комната</div>
                  <div className={`rounded-full px-3 py-1 text-xs font-semibold ${roomPhaseTone}`}>{roomPhaseLabel}</div>
                </div>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div>
                    <div className="text-xs text-white/50">Код комнаты</div>
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm"
                        onClick={() => navigator.clipboard.writeText(store.room?.code ?? "")}
                      >
                        #{store.room.code}
                      </button>
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                        onClick={() => navigator.clipboard.writeText(store.room?.code ?? "")}
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                        onClick={() => navigator.clipboard.writeText(store.room?.code ?? "")}
                      >
                        <Link2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  <div className="text-right text-xs text-white/50">
                    <div>{store.room.playersOnline} игроков</div>
                    <div>{roomStakeLabel}</div>
                    {store.room.phase === "prestart" && <div className="text-white/60">старт через {roomCountdownSec}с</div>}
                  </div>
                </div>
                {store.isInRoom && (
                  <div className="mt-3">
                    <Button
                      variant="danger"
                      className="w-full"
                      disabled={!canLeaveRoom}
                      onClick={() => send({ t: "room.leave.request" })}
                    >
                      <LogOut className="mr-2 h-4 w-4" /> Выйти из комнаты
                    </Button>
                    {!canLeaveRoom && (
                      <div className="mt-2 text-xs text-slate-400">Можно выйти только пока матч не стартовал.</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="glass p-4">
                <div className="mb-2 flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4 w-4 text-white/70" /> Нет активной комнаты
                </div>
                <div className="text-sm text-slate-300">
                  Нажмите «Войти в арену» или создайте приватную комнату, чтобы начать матч.
                </div>
              </div>
            )}
              </>
            )}
          </motion.section>
        )}

        {store.tab === "rooms" && (
          <motion.section key="rooms" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-6">
            <div className="glass p-6">
              <div className="text-base font-semibold">Приватная комната</div>
              <div className="mt-1 text-xs text-white/50">Создайте комнату для друзей и делитесь кодом.</div>
              <Button className="mt-3 w-full" onClick={() => send({ t: "private.create", stakeTon: activeStake })}>
                <Plus className="mr-2 h-4 w-4" /> Создать комнату
              </Button>
            </div>

            <div className="glass p-6">
              <div className="text-base font-semibold">Быстрый вход</div>
              <div className="mt-1 text-xs text-white/50">Заходи по коду, если уже есть приглашение.</div>
              <Button className="mt-3 w-full" variant="ghost" onClick={() => store.setJoinModalOpen(true)}>
                <DoorOpen className="mr-2 h-4 w-4" /> Ввести код
              </Button>
            </div>

            <div className="glass p-4">
              <div className="mb-2 flex items-center gap-2 text-base font-semibold">
                <Sparkles className="h-4 w-4 text-white/70" /> Текущая комната
              </div>
              {store.room ? (
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs text-white/50">Код комнаты</div>
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-sm"
                          onClick={() => navigator.clipboard.writeText(store.room?.code ?? "")}
                        >
                          #{store.room.code}
                        </button>
                        <button
                          className="rounded-lg border border-white/10 bg-white/5 px-2 py-1"
                          onClick={() => navigator.clipboard.writeText(store.room?.code ?? "")}
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                    <div className="text-right text-xs text-white/50">
                      <div>{store.room.playersOnline} игроков</div>
                      <div>{roomStakeLabel}</div>
                      {store.room.phase === "prestart" && <div className="text-white/60">старт через {roomCountdownSec}с</div>}
                    </div>
                  </div>
                  {store.isInRoom && (
                    <Button
                      variant="danger"
                      className="w-full"
                      disabled={!canLeaveRoom}
                      onClick={() => send({ t: "room.leave.request" })}
                    >
                      <LogOut className="mr-2 h-4 w-4" /> Выйти из комнаты
                    </Button>
                  )}
                </div>
              ) : (
                <div className="text-sm text-slate-300">
                  Нет активной комнаты. Создайте приватную комнату или введите код приглашения.
                </div>
              )}
            </div>
          </motion.section>
        )}

        {store.tab === "history" && (
          <motion.section key="history" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="glass flex items-center justify-between p-4">
              <div className="text-base font-semibold">История</div>
              <Button
                variant="ghost"
                size="default"
                onClick={() => {
                  store.setHistoryLoading(true);
                  send({ t: "history.request" });
                }}
              >
                Обновить
              </Button>
            </div>

            {store.historyLoading && (
              <div className="space-y-3">
                <div className="glass h-20 animate-pulse bg-white/5" />
                <div className="glass h-20 animate-pulse bg-white/5" />
              </div>
            )}

            {!store.historyLoading && store.history && (
              <>
                <div className="glass p-4">
                  <div className="mb-2 text-base font-semibold">Транзакции</div>
                  <div className="space-y-2">
                    {store.history.deposits.length === 0 && store.history.withdrawals.length === 0 && (
                      <div className="text-sm text-slate-300">Транзакций пока нет.</div>
                    )}
                    {store.history.deposits.map((d) => (
                      <div key={d.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                        <div>
                          <div className="text-slate-300">Пополнение</div>
                          <div className="text-slate-500">{formatTime(d.createdAt)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-white/80">{d.amountTon ? `+${d.amountTon} TON` : "Сумма: любая"}</div>
                          <div className={d.status === "confirmed" ? "text-success" : d.status === "expired" ? "text-danger" : "text-slate-400"}>
                            {formatDepositStatus(d.status)}
                          </div>
                        </div>
                      </div>
                    ))}
                    {store.history.withdrawals.map((w) => (
                      <div key={w.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                        <div>
                          <div className="text-slate-300">Вывод</div>
                          <div className="text-slate-500">{formatTime(w.createdAt)}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-danger">-{w.amountTon} TON</div>
                          <div className={w.status === "processed" ? "text-success" : w.status === "rejected" ? "text-danger" : "text-slate-400"}>
                            {formatWithdrawalStatus(w.status)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass p-4">
                  <div className="mb-2 text-base font-semibold">Завершённые матчи</div>
                  <div className="space-y-2">
                    {store.history.matches.length === 0 && <div className="text-sm text-slate-300">Матчей пока нет.</div>}
                    {store.history.matches.map((m) => (
                      <div key={m.matchId} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                        <div>
                          <div className="text-slate-300">Матч #{m.matchId}</div>
                          <div className="text-slate-500">{formatTime(m.endedAt)}</div>
                        </div>
                        <div className="text-right">
                          <div className={m.result === "win" ? "text-success" : "text-danger"}>
                            {m.result === "win" ? `+${m.payoutTon} TON` : `-${m.stakeTon} TON`}
                          </div>
                          <div className="text-slate-400">Банк {m.potTon} • Комиссия {m.feeTon}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </motion.section>
        )}


        {store.tab === "profile" && (
          <motion.section key="profile" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            <div className="glass p-4">
              <div className="flex items-center gap-3">
                {store.user?.avatarUrl ? (
                  <img
                    src={store.user.avatarUrl}
                    alt="avatar"
                    className="h-14 w-14 rounded-full border border-accent/50 object-cover"
                  />
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-lg font-semibold text-white">
                    {avatarFallback}
                  </div>
                )}
                <div>
                  <div className="font-semibold">{store.user?.name ?? "Игрок"}</div>
                  <div className="text-sm text-slate-300">@{store.user?.username ?? "без_ника"}</div>
                </div>
              </div>
            </div>

            <div className="glass p-4">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-xs text-slate-300">TON кошелёк</div>
                <TonConnectButton className="[&>button]:!h-9 [&>button]:!rounded-lg [&>button]:!text-xs" />
              </div>
            <div className="text-sm text-slate-300">Баланс</div>
            <div className="mt-1 text-3xl font-bold">{totalTon} TON</div>
            <div className="mt-2 text-xs text-slate-300">Доступно: {store.balance.availableTon} | Заморожено: {store.balance.lockedTon}</div>

            <div className="mt-4 rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
              <div className="text-slate-400">Адрес для вывода</div>
              <div className="mt-2 grid gap-2">
                <Input
                  placeholder="Адрес TON"
                  value={withdrawAddressValue}
                  readOnly={!!connectedWithdrawAddress}
                  onChange={(e) => setWithdrawAddress(e.target.value)}
                />
                {showWithdrawAddressError && (
                  <div className="text-[11px] text-danger">Введите валидный адрес TON.</div>
                )}
                {!!connectedWithdrawAddress && (
                  <div className="text-[11px] text-slate-400">
                    Адрес подтянут из подключённого кошелька.
                  </div>
                )}
                <Input
                  placeholder="Сумма TON"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(sanitizeTonInput(e.target.value))}
                />
                <Button
                  variant="ghost"
                  disabled={!canWithdraw}
                  onClick={() => {
                    if (!canWithdraw) {
                      store.setError("Проверьте адрес TON и сумму вывода");
                      return;
                    }
                    send({ t: "balance.withdraw.request", toAddress: withdrawAddress.trim(), amountTon: withdrawAmount.trim() });
                  }}
                >
                  Вывести средства
                </Button>
              </div>
              {withdrawalWalletAddress && (
                <div className="mt-2 text-[11px] text-slate-400">
                  Адрес списания при выводе: <span className="break-all">{withdrawalWalletAddress}</span>
                </div>
              )}
            </div>

            <Button
              className="mt-3 w-full"
              variant="ghost"
              onClick={() => {
                store.setDepositModalOpen(true);
                send({ t: "balance.deposit.request" });
              }}
            >
              Пополнить баланс
            </Button>

            {store.withdrawalInfo && (
              <div className="mt-2 text-xs text-slate-300">
                Вывод {store.withdrawalInfo.id}: {formatWithdrawalStatus(store.withdrawalInfo.status)}
              </div>
            )}
            </div>

            {referralInfo && (
              <div className="glass overflow-hidden p-0">
                <div className="border-b border-white/10 bg-white/5 px-4 py-3">
                  <div className="text-base font-semibold">Реферальная программа</div>
                  <div className="text-xs text-slate-300">5% от каждого подтверждённого пополнения друзей</div>
                </div>
                <div className="grid gap-3 px-4 py-4 text-xs">
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                    <div className="text-slate-400">Ваш код</div>
                    <div className="mt-1 text-sm text-white">{referralInfo.refCode}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-slate-400">Приглашено</div>
                      <div className="mt-1 text-sm text-white">{referralInfo.invitedCount}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <div className="text-slate-400">Заработано</div>
                      <div className="mt-1 text-sm text-white">{referralInfo.totalRewardTon} TON</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] text-slate-400">
                    Награда начисляется автоматически после подтверждения депозита приглашённого игрока.
                  </div>
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={() => {
                      if (!botUsername) {
                        store.setError("Укажите VITE_TG_BOT_USERNAME в .env");
                        return;
                      }
                      const link = `https://t.me/${botUsername}?startapp=${referralInfo.refCode}`;
                      navigator.clipboard.writeText(link);
                      setInfoMessage("Реферальная ссылка скопирована");
                    }}
                  >
                    Скопировать ссылку
                  </Button>
                </div>
              </div>
            )}

            {match && (
              <div className="glass border-success/30 p-4 text-sm">
                <Fire className="mr-1 inline h-4 w-4 text-success" /> Матч активен #{match.matchId}
              </div>
            )}
          </motion.section>
        )}
      </AnimatePresence>

      {store.error && toastVisible && (
        <div
          className={`glass fixed left-1/2 top-4 z-50 w-[92vw] max-w-md -translate-x-1/2 border-danger/40 p-3 text-sm transition-all duration-500 ${
            toastClosing ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"
          }`}
        >
          <CircleAlert className="mr-1 inline h-4 w-4 text-danger" /> {store.error}
        </div>
      )}

      {infoMessage && infoVisible && (
        <div
          className={`glass fixed left-1/2 top-4 z-50 w-[92vw] max-w-md -translate-x-1/2 border-white/15 p-3 text-sm text-white/90 transition-all duration-500 ${
            infoClosing ? "opacity-0 -translate-y-2" : "opacity-100 translate-y-0"
          }`}
        >
          <Sparkles className="mr-1 inline h-4 w-4 text-white/70" /> {infoMessage}
        </div>
      )}

      <AnimatePresence>
        {lastOutcome && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4"
          >
            <motion.div
              initial={{ scale: 0.95, y: 10 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.98, y: 10 }}
              className={`glass w-full max-w-sm border ${
                lastOutcome.result === "win" ? "border-success/40 shadow-glow" : "border-danger/40"
              } p-5 text-center`}
            >
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-white/10">
                {lastOutcome.result === "win" ? (
                  <Crown className="h-6 w-6 text-success" />
                ) : (
                  <Skull className="h-6 w-6 text-danger" />
                )}
              </div>
              <div className="text-lg font-semibold">
                {lastOutcome.result === "win" ? "Победа!" : "Поражение"}
              </div>
              <div className="mt-2 text-sm text-slate-300">
                {lastOutcome.result === "win" ? `+${lastOutcome.payoutTon} TON` : "Повезёт в следующий раз"}
              </div>
              {lastOutcome.result === "win" && (
                <div className="mt-3 flex items-center justify-center gap-2 text-xs text-success">
                  <BadgeCheck className="h-4 w-4" /> Вы выиграли банк
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Dialog open={store.joinModalOpen} onOpenChange={store.setJoinModalOpen}>
        <DialogContent>
          <DialogTitle className="mb-3 text-lg font-semibold">Введите код комнаты</DialogTitle>
          <DialogDescription className="mb-3 text-xs text-slate-400">Введите 6-символьный код приватной комнаты.</DialogDescription>
          {lastErrorCode === "ROOM_NOT_FOUND" && (
            <div className="rounded-xl border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
              Комната не найдена. Проверьте код.
            </div>
          )}
          <Input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} placeholder="A7X91D" />
          <Button className="mt-3 w-full" onClick={() => send({ t: "private.join", code: joinCode, stakeTon: activeStake })}>
            Подключиться
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={store.depositModalOpen} onOpenChange={store.setDepositModalOpen}>
        <DialogContent>
          <DialogTitle className="mb-2 text-lg font-semibold">Пополнение</DialogTitle>
          <DialogDescription className="mb-3 text-xs text-slate-400">
            Отправьте TON на адрес ниже, обязательно с комментарием (payload).
          </DialogDescription>
          {depositInfo ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="text-slate-400">Сумма пополнения</div>
                <div className="mt-2 grid gap-2">
                  <Input
                    placeholder="Например: 1.5"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(sanitizeTonInput(e.target.value))}
                  />
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={() => {
                      setInfoMessage("Готовим ссылку для пополнения…");
                      send({ t: "balance.deposit.request", amountTon: cleanedDepositAmount || undefined });
                    }}
                  >
                    Сформировать ссылку
                  </Button>
                  {tonWallet?.account?.address && (
                    <div className="text-[11px] text-slate-400">
                      {walletBalanceLoading && "Загружаем баланс кошелька…"}
                      {!walletBalanceLoading && walletBalanceTon && `Баланс кошелька: ${walletBalanceTon} TON`}
                      {!walletBalanceLoading && walletBalanceError && `Баланс кошелька недоступен: ${walletBalanceError}`}
                    </div>
                  )}
                  {hasInsufficientWalletBalance && (
                    <div className="text-[11px] text-danger">Недостаточно средств на кошельке для этой суммы.</div>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
                <span className="text-slate-400">Статус</span>
                <span className={depositInfo.status === "confirmed" ? "text-white/80" : "text-white/60"}>
                  {depositInfo.status === "confirmed" ? "Подтверждено" : "Ожидание"}
                </span>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <div className="hidden place-items-center sm:grid">
                  {depositLink ? (
                    <img
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(depositLink)}`}
                      alt="QR TON"
                      className="h-48 w-48"
                    />
                  ) : (
                    <div className="flex h-48 w-48 items-center justify-center text-xs text-slate-400">
                      <QrCode className="mr-2 h-4 w-4" /> QR недоступен
                    </div>
                  )}
                </div>
                <div className="text-center text-xs text-slate-400 sm:hidden">
                  QR‑код доступен на десктопе. На телефоне используйте кнопку «Открыть Tonkeeper».
                </div>
              </div>
              <Button
                className="w-full"
                disabled={!depositLink || hasInsufficientWalletBalance}
                onClick={() => {
                  if (!depositLink) {
                    store.setError("Сначала сформируйте ссылку на пополнение");
                    return;
                  }
                  openExternalLink(depositLink);
                }}
              >
                Открыть Tonkeeper
              </Button>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="text-slate-400">Адрес</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="break-all">{depositInfo.address}</span>
                  <button
                    className="rounded-lg border border-white/15 bg-white/10 px-2 py-1"
                    onClick={() => navigator.clipboard.writeText(depositInfo.address)}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="text-slate-400">Мемо / комментарий</div>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="break-all">{depositInfo.payload}</span>
                  <button
                    className="rounded-lg border border-white/15 bg-white/10 px-2 py-1"
                    onClick={() => navigator.clipboard.writeText(depositInfo.payload)}
                  >
                    <Copy className="h-3 w-3" />
                  </button>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300">
                Сумма: {cleanedDepositAmount ? `${cleanedDepositAmount} TON` : depositInfo.amountTon ? `${depositInfo.amountTon} TON` : "любая"}
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="glass h-40 animate-pulse bg-white/5" />
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3 text-xs">
                <div className="text-slate-400">Сумма пополнения</div>
                <div className="mt-2 grid gap-2">
                  <Input
                    placeholder="Например: 1.5"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(sanitizeTonInput(e.target.value))}
                  />
                  <Button
                    className="w-full"
                    variant="ghost"
                    onClick={() => {
                      setInfoMessage("Готовим ссылку для пополнения…");
                      send({ t: "balance.deposit.request", amountTon: cleanedDepositAmount || undefined });
                    }}
                  >
                    Сформировать ссылку
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <div className="mt-8 text-center text-xs text-white/40">
        <a className="hover:text-white/70" href="/terms.html">
          Условия использования
        </a>
        <span className="mx-2">•</span>
        <a className="hover:text-white/70" href="/privacy.html">
          Политика конфиденциальности
        </a>
      </div>

      <nav className="fixed bottom-3 left-1/2 z-40 flex w-[calc(100vw-20px)] max-w-xl -translate-x-1/2 items-center justify-around rounded-[32px] border border-white/10 bg-[rgba(20,20,24,0.6)] px-3 py-2 pb-[calc(8px+env(safe-area-inset-bottom))] backdrop-blur-[40px] sm:bottom-5 sm:w-[calc(100vw-28px)]">
        <NavButton active={store.tab === "play"} label="Играть" icon={<PlayCircle className="h-5 w-5" />} onClick={() => store.setTab("play")} />
        <NavButton active={store.tab === "rooms"} label="Комнаты" icon={<Users className="h-5 w-5" />} onClick={() => store.setTab("rooms")} />
        <NavButton active={store.tab === "history"} label="История" icon={<History className="h-5 w-5" />} onClick={() => store.setTab("history")} />
        <NavButton active={store.tab === "profile"} label="Профиль" icon={store.match ? <Crown className="h-5 w-5" /> : <Wallet className="h-5 w-5" />} onClick={() => store.setTab("profile")} />
      </nav>
    </div>
  );
}

function NavButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: JSX.Element;
  onClick: () => void;
}): JSX.Element {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      onClick={onClick}
      className={`relative flex w-28 flex-col items-center rounded-xl px-3 py-2 text-xs ${active ? "text-white/90" : "text-white/40"}`}
    >
      {icon}
      <span className="mt-1">{label}</span>
      {active && <span className="absolute -bottom-1 h-0.5 w-12 rounded-full bg-white/70" />}
    </motion.button>
  );
}

function roomPhaseToLabel(phase?: "idle" | "prestart" | "running" | "ended" | null): string {
  switch (phase) {
    case "prestart":
      return "Старт скоро";
    case "running":
      return "Игра идёт";
    case "ended":
      return "Завершена";
    default:
      return "Ожидание";
  }
}

function roomPhaseToTone(phase?: "idle" | "prestart" | "running" | "ended" | null): string {
  switch (phase) {
    case "prestart":
      return "bg-white/10 text-white/80 border border-white/15";
    case "running":
      return "bg-white/10 text-white/80 border border-white/15";
    case "ended":
      return "bg-white/10 text-white/60 border border-white/10";
    default:
      return "bg-white/10 text-white/60 border border-white/10";
  }
}

function buildTonTransferLink(address: string, payload: string, amountTon?: string): string {
  const params = new URLSearchParams();
  if (amountTon) {
    try {
      const nano = tonToNano(amountTon).toString();
      params.set("amount", nano);
    } catch {
      // ignore invalid amount
    }
  }
  if (payload) params.set("text", payload);
  const query = params.toString();
  return query ? `ton://transfer/${address}?${query}` : `ton://transfer/${address}`;
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(ts));
}

function formatStakeLabel(stakeTon: string | null, scope: "public" | "private" | null): string {
  if (scope === "public" && (!stakeTon || stakeTon === "0")) return "Любая ставка";
  if (!stakeTon) return "—";
  return `${stakeTon} TON`;
}

function formatDepositStatus(status: "pending" | "confirmed" | "expired"): string {
  if (status === "confirmed") return "подтверждено";
  if (status === "expired") return "не оплачено";
  return "ожидание";
}

function formatWithdrawalStatus(status: "pending" | "processed" | "rejected"): string {
  switch (status) {
    case "processed":
      return "обработано";
    case "rejected":
      return "отклонено";
    default:
      return "ожидание";
  }
}

function sanitizeTonInput(value: string): string {
  const normalized = value.replace(/,/g, ".");
  const cleaned = normalized.replace(/[^0-9.]/g, "");
  const [intPart, ...rest] = cleaned.split(".");
  const fracPart = rest.join("");
  if (!fracPart) return intPart;
  return `${intPart}.${fracPart.slice(0, 9)}`;
}

function isValidTonAddress(address: string): boolean {
  const trimmed = address.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("0:")) return /^[0-9a-fA-F]{64}$/.test(trimmed.slice(2));
  const base64url = /^[A-Za-z0-9_-]{48,68}$/.test(trimmed);
  if (!base64url) return false;
  try {
    atob(trimmed.replace(/-/g, "+").replace(/_/g, "/"));
    return true;
  } catch {
    return false;
  }
}
