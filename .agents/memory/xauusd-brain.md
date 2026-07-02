---
name: XAUUSD AI brain system
description: Autonomous gold trading AI engine architecture and schema-change workflow
---

The XAUUSD gold trading feature runs an autonomous learning engine (in `api-server`) that runs a learning cycle every 15 minutes, independent of user traffic, backed by ~6 dedicated DB tables (brain insights, questions log, predictions, news, learning log, settings).

**Why:** The engine mutates its own state on a timer (not per-request), so schema or type changes to these tables won't surface as errors until the next cycle fires — easy to miss if you only check request-driven routes.

**How to apply:** After changing any `xauusd*` schema in `lib/db/src/schema`, run `tsc --build` in `lib/db` (not just push the schema) before restarting the API server, or the compiled `dist/` types will be stale and mask type errors. Predictions must always carry a real technical-analysis-derived entry range + stop loss (ATR/support/resistance based) — a rule-based fallback exists specifically so numbers are never arbitrary even when the AI provider is unavailable.
