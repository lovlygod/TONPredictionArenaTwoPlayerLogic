import { config } from "dotenv";
import { z } from "zod";

config();

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WS_PATH: z.string().default("/ws"),
  DATABASE_URL: z.string().default("file:./prisma/dev.db"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  SESSION_TTL_HOURS: z.coerce.number().default(24),
  ROUND_TOTAL_SEC: z.coerce.number().default(60),
  VOTE_WINDOW_SEC: z.coerce.number().default(15),
  REVEAL_SEC: z.coerce.number().default(2),
  GAP_SEC: z.coerce.number().default(1),
  PRESTART_COUNTDOWN_SEC: z.coerce.number().default(10),
  TIEBREAK_MAX: z.coerce.number().default(3),
  TIEBREAK_VOTE_SEC: z.coerce.number().default(10),
  MIN_STAKE_TON: z.string().default("0.1"),
  MAX_PLAYERS_PER_MATCH: z.coerce.number().default(200),
  HOT_WALLET_ADDRESS: z.string().default(""),
  // Backward-compat: if set, will be treated as hot wallet address.
  DEPOSIT_ADDRESS: z.string().default(""),
  TON_ENDPOINT: z.string().default("https://tonapi.io"),
  TON_RPC_ENDPOINT: z.string().default(""),
  TON_API_KEY: z.string().default(""),
  TON_POLL_INTERVAL_SEC: z.coerce.number().default(10),
  BETA_CODES_PATH: z.string().default("./beta_codes.json"),
  WITHDRAWAL_WALLET_ADDRESS: z.string().min(1, "WITHDRAWAL_WALLET_ADDRESS is required"),
  WITHDRAWAL_MNEMONIC: z.string().min(1, "WITHDRAWAL_MNEMONIC is required"),
  WITHDRAWAL_MIN_TON: z.string().default("0.05"),
  WITHDRAWAL_FEE_TON: z.string().default("0.02"),
  WITHDRAWAL_PROCESS_INTERVAL_SEC: z.coerce.number().default(10),
});

const raw = envSchema.parse(process.env);

export const env = {
  ...raw,
  HOT_WALLET_ADDRESS: raw.HOT_WALLET_ADDRESS || raw.DEPOSIT_ADDRESS,
};

if (!env.HOT_WALLET_ADDRESS) {
  throw new Error("HOT_WALLET_ADDRESS is required (or DEPOSIT_ADDRESS for legacy setups)");
}
