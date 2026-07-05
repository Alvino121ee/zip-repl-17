---
name: TradingView Scanner pivot fields limited to Monthly
description: Which pivot period fields actually return data on TV Scanner API for crypto, and what to use instead for short-timeframe trade levels.
---

TradingView's public Scanner API (`scanner.tradingview.com/global/scan`) only returns non-null values for `Pivot.M.Classic.S1` / `Pivot.M.Classic.R1` (Monthly Classic pivot) for crypto symbols like `BINANCE:BTCUSDT`. Requesting `Pivot.W.Classic.*` (Weekly) or `Pivot.D.Classic.*` (Daily) returns `null` — they are not populated for this symbol/endpoint regardless of the `interval` query param.

**Why:** Using Monthly pivot S1/R1 as support/resistance for a short-horizon (e.g. 4-hour) trade prediction produces TP1/SL levels 10-15% away from current price — wildly mismatched for the timeframe, making trade setups impractical.

**How to apply:** For short-timeframe (intraday/4H) support/resistance or TP/SL levels, don't rely on TV Scanner's pivot fields. Instead derive levels from ATR (e.g. `price ± atr14 * 1.5`), which scales naturally with the timeframe's own volatility and produces levels proportionate to the trade horizon.
