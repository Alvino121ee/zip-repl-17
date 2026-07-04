---
name: Extreme Learning Mode design
description: Architecture, dedup rules, question generation, data source switching for the extreme learning mode in xauusd-brain-engine.ts
---

## Core Design
- Non-blocking background loop in `runExtremeLearningLoop()`, started via `startExtremeLearningMode()`
- In-memory `extremeHashCache` (Set<string>) tracks questions asked **within the current session only** (not loaded from DB — many templates are static and would be permanently blocked)
- Circuit breaker: 5 consecutive errors → 5-min backoff → max 3 retries → hard stop
- `safeQpc` clamped 3–20 questions per cycle
- Blocks normal learning cycle via `isExtremeRunning` flag

## Question Generation (DeepSeek-first)
- Step 1: call `generateQuestionsWithDeepSeek()` — sends current market indicators to DeepSeek, parses numbered list response
- Dedup: `batchSeen` Set prevents duplicates within one DeepSeek response; `sessionCache` prevents same question twice in the session
- Step 2: template fallback (`getMarketAwareQuestions()`) if DeepSeek returns too few questions
- 37 static templates exist — they always produce same hash, so loading DB history would permanently block all of them

## Cross-session Dedup (DB layer)
- Insert uses `.onConflictDoNothing()` — if same hash exists from a previous session, silently skip (not counted as error)
- `inserted.length === 0` → `continue` (skip question, no error, no circuit breaker increment)

## Data Source: Live-first, Historical fallback
- ALWAYS tries `fetchXauusdIndicators("1h")` first — TradingView Scanner is accessible on weekends too
- Falls back to `getHistoricalIndicators()` only if live fetch throws/returns null
- Historical: only snapshots from **last 7 days** (not 90 days) — old snapshots have ~$2000 prices, which mislead DeepSeek
- `extremeDataMode: "live" | "historical"` exposed in `getEngineStatus()` and shown as badge in admin panel

## Why these constraints
- 7-day historical window: gold went from ~$2000 to ~$4175; older snapshots make DeepSeek answer with stale price context
- No DB loading into session hash cache: 49 of 37 template slots are static (no market data), permanently blocked once asked
- `onConflictDoNothing` on insert: hash collision across sessions should be a silent skip, not a circuit-breaker trigger
