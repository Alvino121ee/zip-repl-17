---
name: TradingView data integration
description: How TradingView APIs are used for XAUUSD price and indicator data; which endpoints work and which are blocked on Replit servers.
---

# TradingView Data Integration

## The Rule
Use **TradingView Scanner API** (POST) for all indicator and live price data. Never use `data.tradingview.com/history` — it is blocked on Replit's server environment with a socket-closed error.

**Why:** The history/UDF endpoint (`data.tradingview.com/history`) drops TCP connections from Replit's server IPs. The Scanner endpoint (`scanner.tradingview.com/global/scan`) works reliably with POST requests.

## How to Apply

### Live price
- Primary: `POST https://scanner.tradingview.com/global/scan?interval=60` with columns `["close","open","high","low","change","change_abs"]` for symbol `OANDA:XAUUSD`
- Fallback: Swissquote public forex feed (has real bid/ask but no daily change%)

### Technical indicators (RSI, EMA, MACD, BB, ATR, Pivots)
- `POST https://scanner.tradingview.com/global/scan?interval={60|240|1D}`
- See `TV_INDICATOR_COLUMNS` array in `artifacts/api-server/src/lib/xauusd-data.ts` — index order is critical for `buildIndicatorsFromScanner()`
- EMA9 → `EMA10` (closest available), EMA21 → `EMA20`

### Multi-timeframe analysis
- Three parallel Scanner calls at intervals `"60"` (1h), `"240"` (4h), `"1D"` (daily)
- Symbol: `OANDA:XAUUSD`

### Correlation (DXY, US10Y)
- Scanner calls for `TVC:DXY` and `TVC:US10Y` with `["close","change"]` columns
- Pearson time-series correlation is NOT available (Scanner is snapshot-only); use rule-based interpretation instead

### Key export: `fetchXauusdIndicators(interval)`
Replaces the old `fetchXauusdCandles() + calculateIndicators()` pattern everywhere. Callers: `xauusd-brain-engine.ts` and `routes/xauusd.ts`.
