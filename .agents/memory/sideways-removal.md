---
name: Sideways removed from XAUUSD brain
description: All sideways direction logic was removed from xauusd-brain-engine.ts; direction is now strictly "up" | "down"
---

## Rule
Direction in all prediction interfaces (`RuleBasedPrediction`, `OnDemandPredictionResult`) is now `"up" | "down"` only. No function may return `"sideways"` as a direction.

## Affected functions
- `computeRuleBasedPrediction` — removed ±0.5 threshold sideways branch; ties go to trend direction
- `computeMacroVote` — abstain now returns `"up"` with low confidence (0.45) as neutral proxy
- `computeSentimentVote` — no-news returns `"up"` confidence 0.3; neutral score maps to sign of score
- `computePriceDistribution` — signature changed to `"up" | "down"`, sideways branch removed
- `generateXauusdOnDemandPrediction` — `VALID_DIRS` is now `{"up","down"}` only; cast changed
- Win-rate context — `byDir.sideways` removed from prompt; streak warning no longer says "preferensikan SIDEWAYS"

## Tiebreaker (ensemble)
`finalDirection = majorityDir ?? aiDirection` — AI is tiebreaker when no 2/3 majority among technical/macro/sentiment votes.

## Timeframe rotation (added at same time)
- Training predictions: rotate `M1 → M2 → M3 → M5 → M15 → H1 → H4` via `totalCycles % 7`
- Main predictions: rotate `M5 → M15 → M1` via `totalCycles % 3`
- Stale threshold reduced from 4h to 2h

## Legacy data
Old H1/sideways rows remain in the `xauusd_predictions` table — they are historical, do not affect new predictions. `verifyOldPredictions` marks them expired rather than trying to verify them as sideways.

**Why:** User requested binary up/down only; sideways signals were causing confusion and were not actionable for trading.

**How to apply:** Any future direction field must be `"up" | "down"`. If a model returns "sideways", map it to the technical rule-based direction as fallback.
