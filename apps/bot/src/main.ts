import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import pino from "pino";
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
import TelegramBot from "node-telegram-bot-api";
import { tonToNano } from "@arena/shared";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, "../.env") });

declare const process: { env: Record<string, string | undefined> };
const env = process.env;
const token = env.TELEGRAM_BOT_TOKEN;
if (!token) {
  throw new Error("TELEGRAM_BOT_TOKEN is required for bot");
}

const channelUrl = env.BOT_CHANNEL_URL ?? "https://t.me/TONPredictionArena";
const supportUrl = env.BOT_SUPPORT_URL ?? "https://t.me/TONPredictionArena?direct";
const appUrl = env.BOT_APP_URL ?? "https://t.me/TONPredictionArenaBot/app";
const adminIds = new Set(
  (env.ADMIN_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

const logger = pino({ level: "info" });
const bot = new TelegramBot(token, { polling: true });
const prisma = new PrismaClient();

bot.on("polling_error", (error) => {
  logger.error({ err: error }, "Telegram polling error");
});

const isAdmin = (msg: TelegramBot.Message): boolean => {
  const id = msg.from?.id?.toString();
  return !!id && adminIds.has(id);
};

const creditHelp = "Использование: /credit <tg_id> <amount_ton> [причина]";

bot.onText(/\/credit\s+(.+)/, async (msg, match) => {
  if (!isAdmin(msg)) {
    await bot.sendMessage(msg.chat.id, "Доступ запрещён.");
    return;
  }

  const args = match?.[1]?.trim().split(" ") ?? [];
  const tgUserId = args[0];
  const amountTon = args[1];
  const reason = args.slice(2).join(" ") || undefined;

  if (!tgUserId || !amountTon) {
    await bot.sendMessage(msg.chat.id, creditHelp);
    return;
  }

  let amountNano: bigint;
  try {
    amountNano = tonToNano(amountTon);
    if (amountNano <= 0n) throw new Error("amount must be > 0");
  } catch {
    await bot.sendMessage(msg.chat.id, "Некорректная сумма.");
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { tgUserId } });
      if (!user) throw new Error("USER_NOT_FOUND");

      const balance = await tx.balance.findUnique({ where: { tgUserId } });
      if (!balance) {
        await tx.balance.create({
          data: {
            tgUserId,
            availableNanotons: amountNano.toString(),
            lockedNanotons: "0",
            serviceRevenueNano: "0",
          },
        });
      } else {
        await tx.balance.update({
          where: { tgUserId },
          data: {
            availableNanotons: (BigInt(balance.availableNanotons) + amountNano).toString(),
          },
        });
      }

      await tx.adminAdjustment.create({
        data: {
          id: `adj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          tgUserId,
          adminTgUserId: msg.from?.id?.toString() ?? "unknown",
          amountNanotons: amountNano.toString(),
          reason,
        },
      });
    });

    await bot.sendMessage(
      msg.chat.id,
      `Начислено ${amountTon} TON пользователю ${tgUserId}.`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNKNOWN_ERROR";
    if (message === "USER_NOT_FOUND") {
      await bot.sendMessage(msg.chat.id, "Пользователь не найден.");
    } else {
      logger.error({ err: error }, "Failed to credit user");
      await bot.sendMessage(msg.chat.id, "Ошибка начисления.");
    }
  }
});

const buildWelcomeMessage = (name: string): string => {
  return (
    `Привет, ${name}! 👋\n\n` +
    `Это «Арена прогнозов» — мини‑приложение в Telegram, где ты участвуешь в матчах, ` +
    `делаешь прогнозы и следишь за балансом в TON.\n\n` +
    `Используй кнопки ниже, чтобы открыть сервис, канал и поддержку.`
  );
};

bot.onText(/\/(start|help)/, (msg) => {
  const name = msg.from?.first_name || msg.from?.username || "друг";
  bot.sendMessage(msg.chat.id, buildWelcomeMessage(name), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Открыть сервис", url: appUrl }],
        [
          { text: "Канал проекта", url: channelUrl },
          { text: "Поддержка", url: supportUrl },
        ],
      ],
    },
  });
});

bot.on("message", (msg) => {
  if (!msg.text || msg.text.startsWith("/")) return;
  const name = msg.from?.first_name || msg.from?.username || "друг";
  bot.sendMessage(msg.chat.id, buildWelcomeMessage(name), {
    reply_markup: {
      inline_keyboard: [
        [{ text: "Открыть сервис", url: appUrl }],
        [
          { text: "Канал проекта", url: channelUrl },
          { text: "Поддержка", url: supportUrl },
        ],
      ],
    },
  });
});
