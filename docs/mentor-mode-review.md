# GoldRadar.ai — Review: AI Mentor Mode (10 Juli 2026)

Review komprehensif sistem AI Mentor Mode berdasarkan analisis kode dan backup database.

---

## Status Saat Ini

| Komponen | Status |
|---|---|
| Frontend (port 5000) | ✅ Running |
| API Server (port 8080) | ✅ Running |
| xauusd_brain backup | ✅ Restored (2371 baris) |
| DeepSeek / OpenAI API | ⚠️ Perlu set API key di admin panel |

---

## Arsitektur Mentor Mode

### Dua Mode Utama

1. **Mentor Mode** — Rule-based, 1H timeframe, refresh 30s
   - 8-point scoring: EMA alignment, RSI zone, MACD, BB position, S/R midpoint
   - 4 sensitivity level: super_aggressive / aggressive / normal / conservative
   - Output: BUY / SHORT / HOLD + ATR-based TP/SL
   - UI: `MentorModeWidget.tsx` (floating, draggable)

2. **AI Utama** — Ensemble 4 agent (Technical, AI Rule, Macro, Sentiment)
   - Prediksi multi-timeframe dari brain engine
   - Belajar otomatis tiap siklus via DeepSeek API
   - Validasi prediksi lama: `verifyOldPredictions()`

---

## Yang Sudah Berjalan Dengan Baik ✅

- Brain engine learning loop (setiap 5 menit)
- Forget curve / decay untuk menghapus pola lama yang tidak relevan
- Prediksi utama + TP/SL multi-level
- Integrasi EA MetaTrader 5 (radargold-layerv2.mq5)
- Member chat dengan context market real-time
- BTC brain engine (paralel, learning tiap 2 menit)
- Brain backup sync ke DB
- Registrasi member via email + OTP

---

## Yang Kurang / Perlu Diperbaiki ⚠️

### 🔴 Kritis (Keamanan)

1. **`GET /ea-account` tidak ada autentikasi**
   - Data balance, equity, dan posisi MT5 terbuka ke publik tanpa login
   - Fix: tambah `requireMember` atau `requireAdmin` middleware

2. **Admin token = `SESSION_SECRET` dikirim ke browser**
   - Raw secret dipakai sebagai bearer token → high blast radius jika leak
   - Fix: signed JWT short-lived + refresh token

3. **`requireAdmin` bypass di non-production**
   - Jika `SESSION_SECRET` tidak diset, semua admin route terbuka
   - Fix: fail-closed di semua environment

### 🟡 Penting (Kualitas Sinyal)

4. **Mentor hanya 1 timeframe (1H)**
   - Sinyal beli di 1H berlawanan dengan bearish 4H = bahaya
   - Butuh: konfirmasi sinyal 1H vs trend 4H + Daily

5. **Tidak ada filter high-impact news**
   - Gold sangat sensitif terhadap NFP, FOMC, CPI, Fed Minutes
   - Butuh: blokir sinyal 30 menit sebelum/sesudah news besar

6. **TP/SL hardcoded multiplier ATR**
   - Tidak adaptif terhadap regime pasar (sideways vs trending)
   - Fix: dynamic multiplier berdasarkan volatility regime

7. **2371 baris brain dengan konten placeholder**
   - `[AI tidak aktif — DeepSeek API key belum diset]`
   - Entry placeholder ini ikut mempengaruhi training → distorsi prediksi
   - Fix: validasi konten minimum, filter saat startup

8. **Verifikasi prediksi dibatasi 30 baris per siklus**
   - Backlog bisa menumpuk dan merusak akurasi win rate yang dilaporkan
   - Fix: proses sampai habis atau paginate dengan metric alert

### 🟢 Nice-to-Have (Fitur Tambahan)

9. **Tidak ada kalkulasi lot size / risk management**
   - Mentor suggest TP/SL tapi tidak hitung position size berdasarkan account balance
   - Ini fitur paling dibutuhkan trader pemula

10. **Tidak ada performance feedback per user**
    - Sistem tidak analisis apakah user mengikuti sinyal atau tidak, dan hasilnya apa
    - Butuh: personal trade journal + coach feedback

11. **Signal engine terduplikasi di 3 tempat**
    - `/mentor-signal`, `/fixed-prediction`, dan brain fallback pakai logika berbeda
    - Risiko: kalibrasi drift, inkonsistensi antara UI dan EA

12. **State EA mode in-memory**
    - Restart server = state EA hilang
    - Fix: persist di DB

---

## Rekomendasi Prioritas

| Prioritas | Item | Impact |
|---|---|---|
| 🔴 P1 | Proteksi `/ea-account` + auth admin | Keamanan |
| 🔴 P1 | Bersihkan 598 lesson placeholder dari brain | Kualitas AI |
| 🟡 P2 | Multi-timeframe confirmation (1H + 4H) | Akurasi sinyal |
| 🟡 P2 | Blokir sinyal saat high-impact news | Keamanan trading |
| 🟡 P2 | Satukan signal engine ke satu modul | Maintainability |
| 🟢 P3 | Kalkulasi lot size / risk per trade | UX trader |
| 🟢 P3 | Personal trade journal + coach feedback | Engagement |

---

## Cara Restore Backup Brain

```bash
node scripts/restore-brain-backup.mjs attached_assets/xauusd_brain_TIMESTAMP.json
```

Script ini tersedia di `scripts/restore-brain-backup.mjs`.
