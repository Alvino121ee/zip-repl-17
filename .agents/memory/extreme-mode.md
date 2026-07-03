---
name: Extreme Learning Mode
description: Design decisions and constraints for the extreme learning mode feature in xauusd-brain-engine.ts
---

## Rule
Extreme mode runs as a fire-and-forget async IIFE; `startExtremeLearningMode()` returns immediately after setting flags.

**Why:** The HTTP route handler must return within ms; the loop runs for potentially hours.

**How to apply:** Always start with `(async () => { ... })().catch(...)` pattern inside the sync export. Never `await` the loop at the call site.

## Key constraints

- `safeQpc = Math.max(3, Math.min(20, Math.round(questionsPerCycle)))` — clamp before use; never let `count = 0` enter the loop.
- Circuit breaker: `MAX_CONSECUTIVE_ERRORS = 5` — if DeepSeek fails 5 times in a row, `extremeAbort = true` and loop exits.
- `isLearning` check: refuse to start extreme mode if a normal cycle is in-flight (race window prevention).
- `isExtremeRunning` check in `runLearningCycle()`: normal interval/learn-now skips cycle when extreme is active.
- Hash cache built from DB once at start; updated in-memory per question; removed from cache on error (allows retry).
- Quality threshold: `0.65` (vs `0.6` for normal cycles).
- Pause: random `15_000–30_000 ms` **after answer received**, before next question. No pause between cycles.

## Frontend (admin.tsx)
- `refetchInterval` callback: `(q) => q.state.data?.engine?.extremeMode?.active ? 5_000 : 20_000`
- SystemStatus.engine.totalCycles (not cycleCount — old field was wrong).
- Routes: `POST /api/xauusd/engine/extreme/start` and `/api/xauusd/engine/extreme/stop`.
