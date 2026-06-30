---
name: Daily picks staleness bug
description: Why "close stale open picks" logic must key off today's date, not the generate() target date.
---

In a feature that generates a batch of dated records (e.g. "daily picks") and lazily closes/settles
previous open batches on each generation call, the staleness check must compare against the real
current date, not the date being generated for.

**Why:** If staleness is computed as "pickDate != targetDate", then calling generate() for a
*past* date (e.g. backfilling history) treats every other open batch — including today's real,
still-active picks — as stale and incorrectly closes them. This silently corrupts "live" data
any time a past-dated record is generated/backfilled.

**How to apply:** When writing a "close anything still open from before" step in this kind of
lazy-settlement pattern, always compare the stale-candidate's date against `today` (wall-clock),
never against the date parameter passed into the current call.
