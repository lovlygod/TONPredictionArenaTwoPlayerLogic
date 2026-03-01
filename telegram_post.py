import os
import asyncio
import logging
from aiogram import Bot, types
from aiogram.utils.keyboard import InlineKeyboardBuilder

BOT_TOKEN = os.getenv("BOT_TOKEN", "8082104243:AAEzShLVXBT_J4OsMofq3CVDKa_y_8gi6mY")
CHANNEL_ID = os.getenv("CHANNEL_ID", "@TONPredictionArena")  # например: @TONPredictionArena или -1001234567890
BOT_USERNAME = os.getenv("BOT_USERNAME", "TONPredictionArenaBot/app")
CUSTOM_EMOJI_ID = os.getenv("CUSTOM_EMOJI_ID", "5963097637027582904")
STICKER_FILE_ID = os.getenv("STICKER_FILE_ID", "")

POST_TEXT = (
    "Запуск: Арена прогнозов в Telegram\n\n"
    "Мы запустили мини‑игру, где побеждает не “правильный ответ”, а выбор большинства. "
    "Чем точнее чувствуешь настроение толпы — тем выше шанс забрать банк.\n\n"
    "Как это работает:\n"
    "1) Заходишь в матч и выбираешь ставку (можно свою сумму).\n"
    "2) В каждом раунде отвечаешь на вопрос.\n"
    "3) Проходит тот, кто выбрал вариант, за который проголосовало большинство.\n"
    "4) Матч длится до одного победителя.\n\n"
    "Готов проверить, насколько ты чувствуешь толпу?\n"
    "Жми кнопку ниже и заходи в игру."
)


def build_keyboard() -> types.InlineKeyboardMarkup:
    builder = InlineKeyboardBuilder()
    builder.row(
        types.InlineKeyboardButton(
            text="Запустить бота",
            url=f"https://t.me/{BOT_USERNAME}",
            style="primary",
            icon_custom_emoji_id=CUSTOM_EMOJI_ID or None,
        )
    )
    return builder.as_markup()


async def send_post(bot: Bot) -> None:
    if STICKER_FILE_ID:
        await bot.send_sticker(CHANNEL_ID, STICKER_FILE_ID)
    await bot.send_message(
        CHANNEL_ID,
        POST_TEXT,
        reply_markup=build_keyboard(),
        disable_web_page_preview=True,
        parse_mode="HTML",
    )


async def main():
    logging.basicConfig(level=logging.INFO)
    if not BOT_TOKEN or not CHANNEL_ID:
        raise SystemExit("Set BOT_TOKEN and CHANNEL_ID environment variables")
    bot = Bot(token=BOT_TOKEN)
    await send_post(bot)


if __name__ == "__main__":
    asyncio.run(main())
