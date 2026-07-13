# GoldRadar QuantBot EA — MetaTrader 5

EA untuk mengeksekusi sinyal dari **GoldRadar Quant Bot** (Technical / Fundamental / Macro / Ensemble)
langsung sebagai Market Order di MT5. **Bukan Mentor Mode** — sinyal murni dari 3 AI Brain.

---

## Cara Pasang

### 1. Generate EA API Key
1. Login ke panel Admin GoldRadar
2. Pergi ke **Admin → EA Key**
3. Klik **"Generate Key"** → copy key-nya

### 2. Izinkan URL di MT5
1. MT5 → **Tools → Options → Expert Advisors**
2. Centang ✅ **"Allow WebRequest for listed URL"**
3. Tambahkan URL server kamu, contoh: `https://goldradar.replit.app`

### 3. Install EA
1. Copy file `GoldRadar_QuantBot.mq5` ke folder:
   ```
   [MT5 Data Folder]/MQL5/Experts/
   ```
2. Di MT5: klik kanan **Navigator → Expert Advisors → Refresh**
3. Double-click **GoldRadar_QuantBot** → pasang ke chart XAUUSD

### 4. Setting Parameter

| Parameter | Nilai | Keterangan |
|-----------|-------|-----------|
| `ServerURL` | `https://nama-app.replit.app` | URL server GoldRadar (tanpa slash akhir) |
| `EAApiKey` | `sr_ea_xxxx...` | Key yang di-generate di Admin |
| `BrainSource` | `BRAIN_ENSEMBLE` | Sumber sinyal (lihat bawah) |
| `LotSize` | `0.01` | Lot size order |
| `MagicNumber` | `20250713` | Identifikasi order EA ini |
| `MinConfidence` | `0.45` | Confidence minimum untuk eksekusi |
| `PollSeconds` | `30` | Interval cek sinyal (detik) |
| `CloseOnHold` | `true` | Tutup posisi saat sinyal HOLD |
| `CloseOnReverse` | `true` | Tutup posisi lama saat arah berbalik |
| `OneTradeOnly` | `true` | Max 1 posisi aktif |

---

## Pilihan Brain Source

| Pilihan | Brain | Karakteristik |
|---------|-------|---------------|
| `BRAIN_ENSEMBLE` | Gabungan 3 brain | **Paling stabil.** Sinyal difilter Fix #9 (confidence gate per consensus). Jarang signal, tapi kualitas tinggi. |
| `BRAIN_TECHNICAL` | Technical Brain | RSI, MACD, EMA, SMC, Elliott Wave. Update setiap 3 menit. Lebih sering sinyal. |
| `BRAIN_FUNDAMENTAL` | Fundamental Brain | DXY, Real Yield (TIPS dinamis), COT Report, Bank Sentral. Update setiap 8 menit. Sinyal lebih jarang, cocok untuk swing. |
| `BRAIN_MACRO` | Macro Brain | Geopolitik, Fed Policy, Regime makro. Update setiap 6 menit. |

> **Catatan:** Brain individual menghasilkan sinyal **Fixed 100 pips SL/TP** (TP = Entry ± $10, SL = Entry ∓ $10).
> Ensemble menggunakan SL/TP dinamis berbasis ATR dari kondisi pasar saat itu.

---

## Mekanisme Kerja

```
[Timer setiap 30 detik]
        │
        ▼
GET /api/quant/ea-signal?brain=ensemble&format=plain&key=xxx
        │
        ▼
Parse: COMMAND|ENTRY|TP|SL|CONFIDENCE|SIGNAL_ID
        │
        ├── SIGNAL_ID sama dengan sebelumnya? → Abaikan (tidak ada aksi)
        │
        ├── SIGNAL_ID baru + HOLD
        │       └── CloseOnHold=true? → Tutup semua posisi EA
        │
        ├── SIGNAL_ID baru + BUY/SELL + Confidence < MinConfidence → Abaikan
        │
        └── SIGNAL_ID baru + BUY/SELL + Confidence OK
                ├── Ada posisi berlawanan? (CloseOnReverse=true) → Tutup dulu
                ├── Sudah ada posisi sama? (OneTradeOnly=true) → Skip
                └── Market Order (SL dan TP dari sinyal)
```

---

## Endpoint API yang Dipakai

```
GET /api/quant/ea-signal
  ?brain=ensemble|technical|fundamental|macro
  &format=plain
  &key=<ea_api_key>

Response (plain text):
COMMAND|ENTRY_PRICE|TP|SL|CONFIDENCE|SIGNAL_ID

Contoh:
BUY|3351.45|3361.45|3341.45|0.720|847
SELL|3351.45|3341.45|3361.45|0.650|848
HOLD|3351.45|0|0|0|848
```

---

## Perbedaan dengan Mentor Mode EA (`/xauusd/ea-signal`)

| Aspek | Quant Bot EA (ini) | Mentor Mode EA |
|-------|-------------------|----------------|
| Endpoint | `/api/quant/ea-signal` | `/xauusd/ea-signal` |
| Sumber sinyal | 3 AI Brain (Technical/Fundamental/Macro) | 4 Agen Mentor Mode |
| Mode aktif | Selalu aktif (kalau Brain running) | Harus aktifkan via Widget |
| TP/SL | Dari prediksi brain (ATR atau fixed 100 pips) | Dari prediksi Mentor |
| Pilihan brain | ✅ Ya (pilih 1 dari 4) | ❌ Fixed ensemble |

---

## Troubleshooting

**EA tidak bisa connect ke server:**
- Pastikan URL di MT5 Tools → Options → Expert Advisors sudah ditambahkan
- Cek apakah URL benar (tanpa slash di akhir)
- Coba akses URL dari browser: `https://nama-app.replit.app/api/quant/ea-signal?key=xxx`

**Order tidak dieksekusi:**
- Cek Journal MT5 — ada pesan dari `[GoldRadar]`
- Pastikan Confidence sinyal ≥ MinConfidence
- Pastikan SIGNAL_ID berubah (sinyal baru dibuat setiap awal candle 1H)
- Cek apakah Brain sudah punya DeepSeek API key yang aktif

**TP/SL terlalu dekat:**
- Broker kamu punya minimum stop level yang tinggi
- Untuk broker ECN/STP, biasanya tidak masalah
- Coba kurangi `MinConfidence` atau tunggu sinyal berikutnya

**Sinyal jarang muncul:**
- Normal untuk ensemble — hanya muncul di awal candle 1H yang lolos gate confidence
- Coba ganti ke `BRAIN_TECHNICAL` untuk sinyal yang lebih sering
