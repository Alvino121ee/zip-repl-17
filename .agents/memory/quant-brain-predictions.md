---
name: Per-brain standalone predictions
description: Technical/Fundamental/Macro brains each generate their own trade prediction with fixed fair SL/TP, separate from the ensemble vote.
---

The Quant Bot's 3 brains (Technical, Fundamental, Macro) each write their own standalone
prediction row every learning cycle, independent of the ensemble signal in
quant-bot-engine.ts. This was added because the user wanted each brain's own view visible
and continuously tracked, not just blended into one ensemble number.

**Fairness rule:** all three brains use the exact same fixed risk distance — 100 pips on
gold (1 pip = $0.10 → $10 distance for both TP and SL). Same distance for every brain keeps
comparison fair; don't let one brain use a different SL/TP sizing scheme than the others.

**Why:** the user explicitly asked for "sl tp masing masing 100 pips ... adil" (each brain's
own SL/TP, 100 pips, fair) and continuous generation ("akan generate prediksi terus").

**How to apply:** when generating a brain prediction, skip HOLD signals (no direction to
size SL/TP against) — only BUY/SELL produce a row. Verification must use the current bar's
high/low (not just the latest close price) to check whether TP or SL was actually touched,
matching the existing convention in xauusd-brain-engine.ts. If both TP and SL are touched in
the same interval, treat it as SL hit (conservative, no reliable intrabar ordering).

Note: if the AI provider key is invalid/missing, all 3 brains fall back to HOLD, so no new
predictions get created — this is expected and tied to the separate "connect a real AI
provider key" task, not a bug in the prediction-generation logic itself.
