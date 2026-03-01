import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import pino from "pino";
import { z } from "zod";

config();

const env = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().default("file:./prisma/dev.db"),
    TON_ENDPOINT: z.string().default("https://tonapi.io"),
    TON_API_KEY: z.string().default(""),
    TON_POLL_INTERVAL_SEC: z.coerce.number().default(10),
    HOT_WALLET_ADDRESS: z.string().optional(),
    // Backward-compat: if set, will be treated as hot wallet address.
    DEPOSIT_ADDRESS: z.string().optional(),
  })
  .parse(process.env);

const hotWallet = env.HOT_WALLET_ADDRESS || env.DEPOSIT_ADDRESS;
if (!hotWallet) {
  throw new Error("HOT_WALLET_ADDRESS is required (or DEPOSIT_ADDRESS for legacy setups)");
}

const logger = pino({
  level: env.NODE_ENV === "development" ? "debug" : "info",
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : undefined,
});

const prisma = new PrismaClient();

async function initSqlitePragmas(): Promise<void> {
  await prisma.$executeRawUnsafe("PRAGMA journal_mode = WAL;");
  await prisma.$executeRawUnsafe("PRAGMA synchronous = NORMAL;");
  await prisma.$executeRawUnsafe("PRAGMA temp_store = MEMORY;");
  await prisma.$executeRawUnsafe("PRAGMA busy_timeout = 5000;");
}

type TonTx = {
  hash: string;
  in_msg?: unknown;
  inMessage?: unknown;
  value?: string;
};

function findStringDeep(obj: unknown, needle: string): boolean {
  if (obj === null || obj === undefined) return false;
  if (typeof obj === "string") return obj.includes(needle);
  if (typeof obj !== "object") return false;
  if (Array.isArray(obj)) return obj.some((item) => findStringDeep(item, needle));
  return Object.values(obj).some((item) => findStringDeep(item, needle));
}

function extractNanoAmount(tx: TonTx): bigint {
  const candidates: string[] = [];
  if (typeof tx.value === "string") candidates.push(tx.value);
  const scan = (obj: unknown): void => {
    if (!obj || typeof obj !== "object") return;
    for (const val of Object.values(obj)) {
      if (typeof val === "string" && /^\d+$/.test(val) && val.length >= 6) candidates.push(val);
      else if (typeof val === "object") scan(val);
    }
  };
  scan(tx.in_msg);
  scan(tx.inMessage);
  for (const c of candidates) {
    try {
      const n = BigInt(c);
      if (n > 0n) return n;
    } catch {
      // ignore
    }
  }
  return 0n;
}

async function fetchTransactions(address: string): Promise<TonTx[]> {
  const endpoint = env.TON_ENDPOINT.replace(/\/$/, "");
  const url = `${endpoint}/v2/blockchain/accounts/${encodeURIComponent(address)}/transactions?limit=100`;
  const response = await fetch(url, {
    headers: env.TON_API_KEY ? { Authorization: `Bearer ${env.TON_API_KEY}` } : {},
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`TON endpoint error ${response.status}: ${body}`);
  }

  const data = (await response.json()) as { transactions?: TonTx[] };
  return data.transactions ?? [];
}

async function processPendingDeposits(): Promise<void> {
  const pending = await prisma.deposit.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 50,
  });
  if (pending.length === 0) return;

  const expiryMs = 30 * 60 * 1000;
  const expiredIds = pending
    .filter((d) => Date.now() - d.createdAt.getTime() > expiryMs)
    .map((d) => d.depositId);
  if (expiredIds.length > 0) {
    await prisma.deposit.updateMany({
      where: { depositId: { in: expiredIds }, status: "pending" },
      data: { status: "expired" },
    });
  }

  const activePending = pending.filter((d) => !expiredIds.includes(d.depositId));
  if (activePending.length === 0) return;

  const byAddress = new Map<string, typeof activePending>();
  for (const d of activePending) {
    const list = byAddress.get(d.address) ?? [];
    list.push(d);
    byAddress.set(d.address, list);
  }

  for (const [address, deposits] of byAddress.entries()) {
    let txs: TonTx[] = [];
    try {
      txs = await fetchTransactions(address);
    } catch (error) {
      logger.error({ err: error, address }, "Failed to fetch TON transactions");
      continue;
    }

    for (const deposit of deposits) {
      const hit = txs.find((tx) => findStringDeep(tx, deposit.payload));
      if (!hit) continue;

      const amount = extractNanoAmount(hit);
      if (amount <= 0n) {
        logger.warn({ depositId: deposit.depositId, txHash: hit.hash }, "Transaction found without positive amount");
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const fresh = await tx.deposit.findUnique({ where: { depositId: deposit.depositId } });
        if (!fresh || fresh.status === "confirmed") return;

        await tx.deposit.update({
          where: { depositId: deposit.depositId },
          data: {
            status: "confirmed",
            txHash: hit.hash,
            amountNanotons: amount.toString(),
            confirmedAt: new Date(),
          },
        });

        const balance = await tx.balance.findUniqueOrThrow({ where: { tgUserId: deposit.tgUserId } });
        await tx.balance.update({
          where: { tgUserId: deposit.tgUserId },
          data: {
            availableNanotons: (BigInt(balance.availableNanotons) + amount).toString(),
          },
        });

        const invitee = await tx.user.findUnique({ where: { tgUserId: deposit.tgUserId } });
        const inviterId = invitee?.invitedByTgUserId;
        if (inviterId) {
          const rewardNano = (amount * 5n) / 100n;
          if (rewardNano > 0n) {
            await tx.referralReward.create({
              data: {
                id: `rr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                inviterTgUserId: inviterId,
                inviteeTgUserId: deposit.tgUserId,
                depositId: deposit.depositId,
                amountNanotons: rewardNano.toString(),
              },
            });

            const inviterBalance = await tx.balance.findUniqueOrThrow({ where: { tgUserId: inviterId } });
            await tx.balance.update({
              where: { tgUserId: inviterId },
              data: {
                availableNanotons: (BigInt(inviterBalance.availableNanotons) + rewardNano).toString(),
              },
            });
          }
        }
      });

      logger.info({ depositId: deposit.depositId, tgUserId: deposit.tgUserId, amountNano: amount.toString() }, "Deposit confirmed");
    }
  }
}

async function bootstrap(): Promise<void> {
  await prisma.$connect();
  await initSqlitePragmas();
  logger.info(
    { endpoint: env.TON_ENDPOINT, intervalSec: env.TON_POLL_INTERVAL_SEC, hotWallet },
    "TON worker started",
  );

  setInterval(() => {
    void processPendingDeposits();
  }, env.TON_POLL_INTERVAL_SEC * 1000);

  await processPendingDeposits();
}

void bootstrap();

const shutdown = async (): Promise<void> => {
  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown();
});
process.on("SIGTERM", () => {
  void shutdown();
});
