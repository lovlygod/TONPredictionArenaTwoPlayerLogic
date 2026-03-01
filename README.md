# Арена прогнозов TON

Telegram Mini App + backend server + TON worker для пополнений.

## Стек

- Monorepo: `apps/web`, `apps/server`, `apps/ton-worker`, `packages/shared`
- Frontend: React + TypeScript + Vite + Tailwind + Zustand + Framer Motion + Telegram SDK
- Server: Node.js + TypeScript + Express + WebSocket (`ws`) + Prisma + SQLite
- Payments worker: TON API polling (`TON_ENDPOINT`, `TON_API_KEY`) + SQLite balance credit

## Структура проекта

- `apps/web` - UI Telegram Mini App (Играть / История / Профиль)
- `apps/server` - WS-сервер игры, матчи, балансы, комнаты
- `apps/ton-worker` - проверка пополнений через TON API
- `packages/shared` - WS-схемы, zod-валидация, общие утилиты

## Требования

- Node.js 20+
- pnpm 10+
- Docker (опционально; только для Redis-контейнера в этом MVP)

## Переменные окружения

1. Скопируйте файлы окружения:

- `apps/server/.env.example` -> `apps/server/.env`
- `apps/web/.env.example` -> `apps/web/.env`
- `apps/ton-worker/.env.example` -> `apps/ton-worker/.env`
- `apps/bot/.env.example` -> `apps/bot/.env`

2. Заполните обязательные значения:

- `TELEGRAM_BOT_TOKEN`
- `DATABASE_URL` (SQLite файл, например `file:/opt/arena/data/arena.db`)
- `HOT_WALLET_ADDRESS`
- `WITHDRAWAL_WALLET_ADDRESS`
- `TON_ENDPOINT`
- `TON_API_KEY` (если требуется провайдером)
- `VITE_SERVER_WS_HOST` (публичный WS-хост, например `api.yourdomain.com`)
- `VITE_TONCONNECT_MANIFEST_URL` (публичный URL на manifest TON Connect)
- `BOT_CHANNEL_URL` (ссылка на канал бота)
- `BOT_SUPPORT_URL` (ссылка на поддержку)
- `BOT_APP_URL` (ссылка на мини‑приложение)
- `BETA_CODES_PATH` (путь к файлу с кодами доступа, по умолчанию `./beta_codes.json`)

## Локальный запуск

1. Установите зависимости:

```bash
pnpm i
```

2. Опциональная инфраструктура:

```bash
docker compose up -d
```

3. Сгенерируйте Prisma client и примените миграции:

```bash
pnpm --filter @arena/server db:generate
pnpm db:migrate
pnpm db:seed
```

4. Запустите все сервисы:

```bash
pnpm dev
```

Сервисы:

- Веб-приложение: `http://localhost:5173`
- Сервер: `http://localhost:4000` (`/health`, WS на `/ws`)
- TON worker: цикл опроса в логах терминала

## Инструкция по запуску (кратко)

1. Установите зависимости:

```bash
pnpm i
```

2. Настройте переменные окружения:

- `apps/server/.env`
  - `TELEGRAM_BOT_TOKEN` — токен бота Telegram.
  - `HOT_WALLET_ADDRESS` — адрес для пополнений.
  - `BETA_CODES_PATH` — путь к `beta_codes.json`.
  - `WITHDRAWAL_WALLET_ADDRESS` — адрес, с которого списываются средства при выводе (информативно в UI).
  - `TON_ENDPOINT` — endpoint провайдера TON (например, `https://tonapi.io`).
  - `TON_API_KEY` — ключ API (если нужен).
- `apps/ton-worker/.env`
  - `TON_ENDPOINT` и `TON_API_KEY` — те же значения.
  - `HOT_WALLET_ADDRESS` — адрес пополнений.
- `apps/web/.env`
  - `VITE_SERVER_WS_HOST` — публичный WS-хост, например `api.yourdomain.com`.
  - `VITE_TONCONNECT_MANIFEST_URL` — URL на `tonconnect-manifest.json`.
  - `VITE_WITHDRAWAL_WALLET_ADDRESS` — адрес списания при выводе (показывается пользователю).
- `apps/bot/.env`
  - `TELEGRAM_BOT_TOKEN` — токен Telegram‑бота.
  - `BOT_CHANNEL_URL` — ссылка на канал.
  - `BOT_SUPPORT_URL` — ссылка на поддержку.
  - `BOT_APP_URL` — ссылка на мини‑приложение.

3. Подготовьте базу данных:

```bash
pnpm --filter @arena/server db:generate
pnpm db:migrate
pnpm db:seed
```

4. Запустите сервисы:

```bash
pnpm dev
```

5. Откройте приложение:

- `http://localhost:5173`

## Сценарий проверки

1. Откройте `http://localhost:5173` в двух окнах браузера.
2. В профиле нажмите `Пополнить` и сформируйте ссылку (адрес+payload появятся).
3. Отправьте TON на адрес сервиса с указанным комментариям (payload).
4. Дождитесь цикла опроса: статус пополнения станет `подтверждено`, баланс обновится в UI.
5. Окно A: вкладка «Играть», выберите ставку >= `0.1`, нажмите «Войти в арену».
6. Окно B: вкладка «Играть», войдите в приватную комнату по коду.
7. Матч начнётся автоматически при >= 2 игроках, раунды стартуют, голосуйте в обоих окнах.
8. Проверьте `round.reveal`, выбывания, тай-брейки и выплату `match.end` (10% комиссия).
9. Убедитесь, что балансы в профиле обновляются в реальном времени.

## Заметки

- В продакшене требуется валидный Telegram `initData`.
- Вывод в MVP ставится в очередь (`pending`) и отображается в профиле.

## Deploy Beta (VPS + Domain)

### DNS

- A запись: `api.<domain>` → IP вашего VPS
- CNAME запись: `app.<domain>` → домен Cloudflare Pages/Vercel

### Caddy (TLS + WSS)

Установите Caddy на VPS и создайте `/etc/caddy/Caddyfile`:

```
api.<domain> {
  encode zstd gzip
  reverse_proxy 127.0.0.1:4000 {
    header_up X-Forwarded-Proto {scheme}
    header_up X-Forwarded-For {remote_host}
    header_up Host {host}
  }
}
```

Перезапуск:

```
sudo systemctl reload caddy
```

### systemd units

`/etc/systemd/system/arena-server.service`:

```
[Unit]
Description=TON Prediction Arena API
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/arena
EnvironmentFile=/opt/arena/apps/server/.env
ExecStart=/usr/bin/node /opt/arena/apps/server/dist/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/arena-ton-worker.service`:

```
[Unit]
Description=TON Prediction Arena TON Worker
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/arena
EnvironmentFile=/opt/arena/apps/ton-worker/.env
ExecStart=/usr/bin/node /opt/arena/apps/ton-worker/dist/main.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Активировать:

```
sudo systemctl daemon-reload
sudo systemctl enable --now arena-server arena-ton-worker
```

### Сборка и запуск

```
pnpm i
pnpm --filter @arena/server db:generate
pnpm db:migrate
pnpm db:seed
pnpm --filter @arena/server build
pnpm --filter @arena/ton-worker build
```

### Проверки

```
curl https://api.<domain>/health
wscat -c wss://api.<domain>/ws
```

### Frontend (Cloudflare Pages / Vercel)

- Build command: `pnpm --filter @arena/web build`
- Output directory: `apps/web/dist`
- Env variables: `VITE_SERVER_WS_HOST`, `VITE_SERVER_WS_PATH`, `VITE_TONCONNECT_MANIFEST_URL`, `VITE_WITHDRAWAL_WALLET_ADDRESS`, `VITE_TG_BOT_USERNAME`

## SQLite backups

### Резервное копирование

Папка для бэкапов:

```
sudo mkdir -p /var/backups/arena
```

Пример команды:

```
sqlite3 /opt/arena/data/arena.db ".backup /var/backups/arena/arena_$(date +%F).db"
```

### Cron (ежедневно в 03:15)

```
15 3 * * * /usr/bin/sqlite3 /opt/arena/data/arena.db ".backup /var/backups/arena/arena_$(date +\%F).db"
```

### Восстановление

```
sudo systemctl stop arena-server arena-ton-worker
sudo cp /var/backups/arena/arena_YYYY-MM-DD.db /opt/arena/data/arena.db
sudo systemctl start arena-server arena-ton-worker
```
