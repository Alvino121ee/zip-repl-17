# GoldRadar.ai — XAUUSD AI Trading Intelligence

Platform trading emas (XAUUSD) berbasis AI yang belajar mandiri 24/7.

## Cara Menjalankan

Dua workflow harus berjalan bersamaan:

| Workflow | Perintah | Port |
|---|---|---|
| `artifacts/saham-radar: web` | `cd artifacts/saham-radar && pnpm run dev` | 5000 |
| `artifacts/api-server: API Server` | `cd artifacts/api-server && pnpm run dev` | 8080 |

Buka preview di port **5000**.

## Stack

- **Frontend**: React 19 + Vite, Tailwind CSS 4, Shadcn UI, TanStack Query, Wouter
- **Backend**: Express.js + TypeScript, Pino logging
- **Database**: PostgreSQL (Replit managed) + Drizzle ORM
- **AI**: OpenAI / DeepSeek / AI_API_KEY (opsional — ada fallback template jika tidak ada key)
- **Data**: TradingView Scanner API untuk harga live XAUUSD
- **Package Manager**: pnpm (monorepo)

## Struktur Monorepo

```
artifacts/
  api-server/   — Express API server (port 8080)
  saham-radar/  — React frontend (port 5000)
lib/
  db/           — Schema Drizzle ORM + shared DB client
  api-spec/     — OpenAPI spec
  api-client-react/ — Generated API client (React Query)
scripts/        — Utility scripts (seed, dll)
```

## Setup Awal

Script `scripts/post-merge.sh` dijalankan otomatis setelah merge atau clone baru. Perintah ekuivalennya:

```bash
pnpm install --frozen-lockfile         # install semua dependensi
pnpm --filter @workspace/db run push   # push schema ke database (PostgreSQL managed Replit)
```

> **Catatan**: Proyek ini menggunakan **PostgreSQL managed Replit** via `DATABASE_URL`. Tidak perlu modul `postgresql-16` di `.replit` — database sudah tersedia otomatis di environment Replit.

## Environment Variables

| Key | Keterangan |
|---|---|
| `DATABASE_URL` | Dikelola otomatis oleh Replit |
| `SESSION_SECRET` | Secret session (sudah diset) |
| `OPENAI_API_KEY` | Opsional — untuk fitur AI report |
| `DEEPSEEK_API_KEY` | Opsional — untuk analisis DeepSeek |
| `AI_API_KEY` + `AI_API_BASE_URL` + `AI_MODEL` | Opsional — custom AI provider |
| `SMTP_HOST` | Host SMTP (contoh: `smtp.gmail.com`) |
| `SMTP_PORT` | Port SMTP (default: `587`) |
| `SMTP_USER` | Username/email SMTP |
| `SMTP_PASS` | Password atau App Password SMTP |
| `SMTP_FROM` | Alamat pengirim (default: `noreply@radargold`) |

Tanpa API key AI, aplikasi tetap berjalan dengan template berbasis data.

> **SMTP**: Kredensial SMTP bisa diset via env di atas **atau** langsung dari Admin panel → SMTP Settings (disimpan di database). Nilai di database lebih diprioritaskan daripada env.

## Setelah Ubah Schema Database

```bash
pnpm --filter @workspace/db run push   # sinkronkan schema ke DB
tsc --build                            # rebuild type definitions
```

## User Preferences

- Gunakan Bahasa Indonesia dalam komunikasi
