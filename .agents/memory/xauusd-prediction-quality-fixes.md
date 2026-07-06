---
name: XAUUSD prediction quality fixes
description: Design decisions behind accuracy stats split, TP/SL verification, RR filter, and dynamic spread in the XAUUSD brain engine.
---

- Accuracy stats must be reported separately for `predictionType: "main"` vs `"training"`. Training predictions run every cycle (~5min) purely to feed the learning loop and are much noisier; blending them into one aggregate accuracy number misrepresents real user-facing performance.
- TP/SL verification should check against the current bar's high/low (from the TradingView Scanner OHLC columns for the fetched interval), not just the latest close/snapshot price. Checking only close price misses intrabar touches that later reverse before the next learning cycle runs.
  - **Why:** the scanner's `high`/`low` columns are scoped to the requested interval (e.g. "60" = 1h bar), not the full day, so using them for verification does not introduce look-ahead bias from stale historical extremes.
  - When both SL and TP levels fall inside the same bar's range, resolve SL first (conservative/worst-case assumption) since the actual intrabar touch order is unknown.
- "Main" predictions (the ones surfaced to users) should be rejected/skipped if computed risk:reward is below 1:1 (TP closer than SL). Training predictions are still saved even with poor RR since they only feed the learning loop. Threshold is a `MIN_RR_MAIN` constant near `makePrediction()`.
- Spread used for bid/ask should scale with the current daily high-low range (~2% of range, clamped to a min/max band) instead of a hardcoded constant — real broker spreads widen during high volatility.
- Main prediction TP1 distance is clamped to $5–$20 from entry (≈50–200 pip gold), per explicit user decision to replace (not add alongside) the old S/R-based TP sizing for "main" predictions only. Applied in two places: inside `computeRuleBasedPrediction` (always, since it's a pure fallback) and again after the AI/ensemble merge (only when `predType === "main"`, since AI-suggested TP can also come from far S/R levels). Training predictions keep the old unclamped S/R-based TP — they're only for learning, not surfaced to users. New "main" predictions are only created when direction changes or the pending one goes stale (>4h), so clamp effect won't show on old pending rows until refreshed.
