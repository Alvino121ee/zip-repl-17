# GoldRadar.ai — Saham Radar

Platform AI trading XAUUSD & BTCUSD dengan prediksi arah pasar, analisis multi-timeframe, chat dengan AI expert, dan integrasi MetaTrader 5 via Expert Advisor (EA).

## Cara Menjalankan

Dua workflow sudah dikonfigurasi dan berjalan otomatis:

| Workflow | Perintah | Port |
|---|---|---|
| `artifacts/saham-radar: web` | `pnpm --filter @workspace/saham-radar run dev` | 5000 |
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | 8080 |

Untuk install ulang dependensi: `pnpm install` dari root.

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS 4 (`artifacts/saham-radar/`)
- **Backend**: Express 5 + TypeScript (`artifacts/api-server/`)
- **Database**: PostgreSQL via Drizzle ORM (`lib/db/`)
- **Shared**: API spec, Zod schemas, React hooks di `lib/`
- **AI**: OpenAI / DeepSeek API untuk analisis pasar dan chat

## Secrets yang Diperlukan

| Secret | Keterangan |
|---|---|
| `DATABASE_URL` | Replit PostgreSQL — dikelola otomatis |
| `SESSION_SECRET` | Token admin (sudah di-set) |
| `OPENAI_API_KEY` / `AI_API_KEY` | Untuk fitur AI brain & chat |
| `DEEPSEEK_API_KEY` | Alternatif AI provider |

## Database

Push schema ke database: `pnpm --filter @workspace/db run push`

## Expert Advisor (EA) MetaTrader 5

File EA tersedia di `artifacts/api-server/public/`:
- `radargold-layerv2.mq5` — **EA utama** (Grid 10 Layer, re-entry hanya P1)
- `radargoldv5.mq5` — EA versi lama

**Aturan re-entry EA (radargold-layerv2)**:
- P1 (entry utama/market order): re-entry aktif jika `InpReentryEnable=true`
- P2-P10 (limit grid): **tidak** re-entry sama sekali
- Saat P1 close (TP/trailing/manual): semua posisi & limit P2-P10 ditutup/dibatalkan, sinyal di-refresh otomatis

## Struktur Halaman

- `/` — Dashboard publik (prediksi & sinyal live)
- `/member` — Chat AI (perlu login member)
- `/admin` — Panel admin (perlu token admin = `SESSION_SECRET`)

## Setup Awal (sudah dilakukan)

Langkah-langkah berikut sudah dijalankan saat import ke Replit:

1. `pnpm install` — install semua dependensi workspace
2. `pnpm --filter @workspace/db run push` — push schema ke PostgreSQL Replit
3. Workflow frontend & API server dikonfigurasi dan dijalankan

## User Preferences

- Bahasa antarmuka: **Bahasa Indonesia**
- Jangan ubah struktur monorepo yang sudah ada
- Gunakan `pnpm` (bukan npm/yarn)
