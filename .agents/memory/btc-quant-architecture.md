---
name: BTC Quant 3-brain architecture
description: BTC has its own separate Technical/Fundamental/Macro quant brains + orchestrator, distinct from XAUUSD quant brains, with scalping constraints.
---

## BTC Quant Bot Architecture

### Files
- `artifacts/api-server/src/lib/btc-quant-technical-brain.ts` — cycle 2 min, focus: RSI/EMA/BB/Funding Rate
- `artifacts/api-server/src/lib/btc-quant-fundamental-brain.ts` — cycle 6 min, focus: Halving/Fear&Greed/ETF flows
- `artifacts/api-server/src/lib/btc-quant-macro-brain.ts` — cycle 5 min, focus: risk regime/Nasdaq/ETH corr/DXY
- `artifacts/api-server/src/lib/btc-quant-engine.ts` — orchestrator, cycle 3 min
- `artifacts/api-server/src/lib/btc-quant-brain-predictions.ts` — per-brain prediction helper
- `lib/db/src/schema/btc-quant.ts` — 6 new tables

### DB Tables (btc_quant_*)
- `btc_quant_technical_brain`, `btc_quant_fundamental_brain`, `btc_quant_macro_brain`
- `btc_quant_bot_predictions` — ensemble results with scalping TP/SL
- `btc_quant_brain_predictions` — per-brain standalone accuracy tracking
- `btc_quant_learning_log`

### Scalping Constraint (CRITICAL)
- **Hard cap: TP and SL must NOT exceed $1,000 from entry price**
- If ATR × multiplier > $1000, it is cropped to $1000
- Minimum distance: $100 TP, $80 SL
- Logged as `constraintApplied: true` in prediction record

### Ensemble Weights
- Technical: **40%** (higher than XAUUSD 35% — scalping needs fast technical reaction)
- Fundamental: 30%
- Macro: 30%

### Confidence Gate
- Minimum 60% confidence for ensemble prediction to be saved to DB (vs XAUUSD 0% gate)

### Per-brain fixed distance
- $500 fixed distance per side for fair accuracy comparison (vs XAUUSD 100 pips = $10)

### BTC Brain v2 (legacy)
- Old monolithic brain still runs in parallel via `startBtcBrainEngine()`
- Both enabled when `isBtcusdBrainEnabled()` returns true in DB settings
- Decision: keep v2 running while new brains accumulate insights

### API Endpoints (under /api/btcusd)
- `GET /quant/status` — full 3-brain + ensemble status
- `GET /quant/predictions` — recent ensemble predictions (last 20)
- `GET /quant/brain-stats` — insights count + accuracy per brain
- `GET /quant/brain-predictions` — per-brain standalone predictions

### Why
- BTC and gold have fundamentally different characteristics: BTC is a risk asset (not safe haven), driven by halving cycles, Fear & Greed, ETF flows, Nasdaq correlation
- Scalping BTC requires tighter TP/SL than gold — $1000 constraint prevents outsized losses on volatile moves
- Separate brain tables prevent XAUUSD insights from contaminating BTC analysis
