# Saham Radar — GoldRadar.ai

Platform AI trading XAUUSD (dan BTCUSD) yang belajar mandiri 24/7. Menyediakan prediksi arah pasar, analisis multi-timeframe, mentor signal, dan chat dengan AI expert gold.

## Stack

- **Monorepo:** PNPM Workspaces (semua package di bawah `artifacts/` dan `lib/`)
- **Frontend:** React 19 + Vite + Tailwind CSS 4 (`artifacts/saham-radar`)
- **Backend:** Express 5 + TypeScript + Drizzle ORM + PostgreSQL (`artifacts/api-server`)
- **Shared:** `lib/db` (schema + migrasi), `lib/api-spec`, `lib/api-zod`, `lib/api-client-react`
- **WhatsApp:** `@whiskeysockets/baileys`

## Cara Menjalankan

```bash
# Install semua dependensi (dari root)
pnpm install

# Jalankan migrasi database
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push

# Start frontend (port 19024)
pnpm --filter @workspace/saham-radar dev

# Start API server (port 8080)
pnpm --filter @workspace/api-server dev
```

Workflows sudah dikonfigurasi di Replit — klik Run untuk memulai.

## Environment Variables Wajib

| Variabel | Keterangan |
|---|---|
| `DATABASE_URL` | Otomatis oleh Replit (runtime-managed) |
| `SESSION_SECRET` | Token admin — sudah ada di Secrets |
| `OPENAI_API_KEY` / `AI_API_KEY` | Untuk AI chat & prediksi (opsional, bisa diset dari admin panel) |
| `DEEPSEEK_API_KEY` | Untuk DeepSeek analyst (opsional) |

Variabel opsional lain (SMTP, WhatsApp, Pakasir) bisa diset dari Admin Panel setelah login.

## Struktur Route API

- `GET /api/xauusd/live-price` — harga live XAUUSD
- `GET /api/xauusd/mentor-signal` — sinyal BUY/SHORT/HOLD untuk Mentor Mode
- `GET /api/xauusd/ea-signal` — sinyal khusus untuk MetaTrader EA (butuh EA API key)
- `GET /api/static/SahamRadarMentorEA.mq5` — download file Expert Advisor MT5
- `POST /api/xauusd/predict` — prediksi AI (member only)
- `POST /api/xauusd/chat` — chat dengan AI (member only)
- `GET /api/admin/*` — admin routes (butuh SESSION_SECRET token)

## Fitur Mentor Mode EA (MetaTrader)

1. Di Admin Panel, buat EA API Key (menu "Koneksi Expert Advisor")
2. Download file `SahamRadarMentorEA.mq5`
3. Di MT5: Tools > Options > Expert Advisors > Allow WebRequest → tambahkan URL Replit
4. Pasang EA di chart XAUUSD, isi ApiUrl dan EaApiKey
5. Set AutoTrade = true untuk trading otomatis

## Database

Pakai PostgreSQL Replit (sudah provisioned). Jalankan migrasi dengan:
```bash
DATABASE_URL="$DATABASE_URL" pnpm --filter @workspace/db run push
```

Schema ada di `lib/db/src/schema/`.

## User Preferences

- Gunakan Bahasa Indonesia dalam semua komunikasi
