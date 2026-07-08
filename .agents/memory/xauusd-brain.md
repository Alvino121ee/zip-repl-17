---
name: XAUUSD AI brain system
description: Autonomous gold trading AI engine architecture and schema-change workflow
---

The XAUUSD gold trading feature runs an autonomous learning engine (in `api-server`) that runs a learning cycle every **5 minutes** (was 15), backed by 6 dedicated DB tables (brain insights, questions log, predictions, news, learning log, settings).

**Why:** The engine mutates its own state on a timer (not per-request), so schema or type changes to these tables won't surface as errors until the next cycle fires — easy to miss if you only check request-driven routes.

**How to apply:** After changing any `xauusd*` schema in `lib/db/src/schema`, run `tsc --build` in `lib/db` (not just push the schema) before restarting the API server, or the compiled `dist/` types will be stale and mask type errors. Predictions must always carry a real technical-analysis-derived entry range + stop loss (ATR/support/resistance based) — a rule-based fallback exists specifically so numbers are never arbitrary even when the AI provider is unavailable.

**Key architecture decisions:**
- Learning cycle: 5 min interval, 5 questions/cycle normal, 8 on spike (0.3% price move)
- 35+ question templates covering RSI, EMA, MACD, BB, SMC, session, macro, COT, psychology
- Prediction prompt includes: 1H indicators + MTF confluence + DXY/US10Y with interpretation + win rate stats (last 50) + news sentiment (last 4)
- Confidence calibration rule: >0.75 only if 4+ factors align; entry zone = ±0.4×ATR; SL = 1.5×ATR
- Chat context (from `/xauusd/chat`): indicators + last 3 predictions (with reasoning) + news sentiment + top 6 brain insights with content excerpts — all via `Promise.allSettled`
- Agent config: only one `xauusd` entry in `agentConfigsTable` (duplicate with wrong BEI training examples removed)
- Memory trim: batch delete with `inArray` not N individual deletes

**Restoring xauusd_brain from a JSON export:** if given an `xauusd_brain_*.json` attached asset (array of row objects with snake_case keys matching DB columns), restore with a one-off pg script: TRUNCATE `xauusd_brain`, insert rows with explicit `id`, then `setval` the serial sequence to MAX(id). Run such scripts from inside `lib/db/` (or install `pg` at the script location) since `pg` isn't hoisted to the workspace root. Check row count first — only restore into an empty table.
