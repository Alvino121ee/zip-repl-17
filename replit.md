# SahamRadar AI

Platform analisis saham BEI (Bursa Efek Indonesia) berbasis AI dengan fitur screening, daily picks, risk radar, dan AI analyst chat.

## Stack
- **Frontend**: React + Vite, Tailwind CSS, Shadcn UI, TanStack Query, Recharts, Wouter
- **Backend**: Express.js + TypeScript (Node.js), Pino logging
- **Database**: PostgreSQL (Drizzle ORM)
- **Data**: Yahoo Finance API, berita dari RSS feeds
- **AI**: DeepSeek / OpenAI (opsional)

## Cara Menjalankan

### 1. Install dependencies
```bash
pnpm install
```

### 2. Push schema database
```bash
pnpm --filter @workspace/db run push
```

### 3. Seed data (opsional)
```bash
pnpm --filter @workspace/api-server exec tsx src/scripts/seed.ts
```

### 4. Jalankan workflows
- **Frontend**: workflow `artifacts/saham-radar: web`
- **API Server**: workflow `artifacts/api-server: API Server`

## Environment Variables
- `DATABASE_URL` — dikelola otomatis oleh Replit
- `DEEPSEEK_API_KEY` — opsional, untuk AI Analyst chat penuh
- `OPENAI_API_KEY` — alternatif AI provider
- `AI_MODEL` — opsional, default `gpt-4o-mini`
- `AI_API_BASE_URL` — opsional, custom AI endpoint

## Fitur Utama
- **Dashboard**: Ringkasan pasar BEI (advancers, decliners, top gainers/losers, sektor)
- **Screener**: Filter dan ranking 368 saham berdasarkan skor AI
- **Daily Picks**: 5 saham pilihan AI per hari dengan simulasi profit
- **AI Analyst**: Chat AI tentang saham BEI + berita pasar terkini
- **Risk Radar**: Daftar saham dengan risiko tinggi
- **Watchlist**: Pantau saham favorit
- **Compare**: Perbandingan antar saham
- **Admin**: Sinkronisasi data harga realtime dari Yahoo Finance

## User Preferences
- Bahasa komunikasi: Indonesia
