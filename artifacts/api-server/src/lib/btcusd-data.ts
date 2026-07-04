/**
 * BTCUSD real-time data fetcher + technical indicator calculator
 * Source: TradingView Scanner API (BINANCE:BTCUSDT)
 * Fallback: CoinGecko public API
 */

export interface BtcusdLivePrice {
  price: number;
  bid: number;
  ask: number;
  change: number | null;
  changePct: number | null;
  timestamp: number;
}

export interface BtcusdIndicators {
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  rsi14: number | null;
  ema9: number | null;
  ema21: number | null;
  ema50: number | null;
  ema200: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  atr14: number | null;
  trend: "bullish" | "bearish" | "sideways";
  rsiSignal: "overbought" | "oversold" | "neutral";
  macdSignalType: "bullish_cross" | "bearish_cross" | "neutral";
  emaAlignment: "bullish_stack" | "bearish_stack" | "mixed";
  supportLevel: number | null;
  resistanceLevel: number | null;
}

const TV_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
  Origin: "https://www.tradingview.com",
  Referer: "https://www.tradingview.com/",
};

const BTC_SYMBOL = "BINANCE:BTCUSDT";
const BTC_SPREAD = 10; // ~$10 typical spread

interface TvScannerResponse {
  data: Array<{ s: string; d: (number | null)[] }>;
}

const TV_INDICATOR_COLUMNS = [
  "close", "open", "high", "low", "volume",
  "change", "change_abs",
  "RSI", "RSI[1]",
  "EMA10", "EMA20", "EMA50", "EMA200",
  "MACD.macd", "MACD.signal", "MACD.macd[1]", "MACD.signal[1]",
  "BB.upper", "BB.lower", "BB.basis",
  "ATR",
  "Pivot.M.Classic.S1", "Pivot.M.Classic.R1",
] as const;

async function queryTvScanner(interval: string): Promise<(number | null)[]> {
  const url = `https://scanner.tradingview.com/global/scan?interval=${interval}`;
  const body = {
    symbols: { tickers: [BTC_SYMBOL], query: { types: [] } },
    columns: [...TV_INDICATOR_COLUMNS],
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { ...TV_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`TradingView Scanner BTC@${interval} HTTP ${res.status}`);
  const json = (await res.json()) as TvScannerResponse;
  if (!json.data?.length) throw new Error("TradingView Scanner: no BTC data");
  return json.data[0].d;
}

export async function fetchBtcusdLivePrice(): Promise<BtcusdLivePrice> {
  try {
    const url = "https://scanner.tradingview.com/global/scan";
    const body = {
      symbols: { tickers: [BTC_SYMBOL], query: { types: [] } },
      columns: ["close", "open", "high", "low", "change_abs", "change"],
    };
    const res = await fetch(url, {
      method: "POST",
      headers: { ...TV_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`TV Scanner HTTP ${res.status}`);
    const json = (await res.json()) as TvScannerResponse;
    if (!json.data?.length) throw new Error("no data");
    const [close, , , , changeAbs, changePct] = json.data[0].d;
    if (close == null) throw new Error("close null");
    return {
      price: parseFloat(close.toFixed(2)),
      bid: parseFloat((close - BTC_SPREAD / 2).toFixed(2)),
      ask: parseFloat((close + BTC_SPREAD / 2).toFixed(2)),
      change: changeAbs != null ? parseFloat(changeAbs.toFixed(2)) : null,
      changePct: changePct != null ? parseFloat(changePct.toFixed(3)) : null,
      timestamp: Date.now(),
    };
  } catch {
    // Fallback: CoinGecko
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
    const json = (await res.json()) as { bitcoin: { usd: number; usd_24h_change: number } };
    const p = json.bitcoin.usd;
    return {
      price: p,
      bid: parseFloat((p - BTC_SPREAD / 2).toFixed(2)),
      ask: parseFloat((p + BTC_SPREAD / 2).toFixed(2)),
      change: null,
      changePct: parseFloat((json.bitcoin.usd_24h_change ?? 0).toFixed(3)),
      timestamp: Date.now(),
    };
  }
}

export async function fetchBtcusdIndicators(timeframe: "1h" | "4h" | "1d" = "1h"): Promise<BtcusdIndicators> {
  const intervalMap: Record<string, string> = { "1h": "60", "4h": "240", "1d": "1D" };
  const d = await queryTvScanner(intervalMap[timeframe] ?? "60");

  const [close, open, high, low, volume, , ,
    rsi, rsiPrev, ema9, ema21, ema50, ema200,
    macdLine, macdSignal, macdLinePrev, macdSignalPrev,
    bbUpper, bbLower, bbMiddle, atr,
    s1, r1] = d;

  const price = close ?? 0;
  const bbWidth = bbMiddle && bbMiddle > 0 ? ((bbUpper ?? 0) - (bbLower ?? 0)) / bbMiddle * 100 : null;

  // Trend
  let trend: BtcusdIndicators["trend"] = "sideways";
  if (ema9 && ema21 && ema50) {
    if (ema9 > ema21 && ema21 > ema50) trend = "bullish";
    else if (ema9 < ema21 && ema21 < ema50) trend = "bearish";
  }

  // RSI signal
  let rsiSignal: BtcusdIndicators["rsiSignal"] = "neutral";
  if (rsi != null) {
    if (rsi > 70) rsiSignal = "overbought";
    else if (rsi < 30) rsiSignal = "oversold";
  }

  // MACD cross
  let macdSignalType: BtcusdIndicators["macdSignalType"] = "neutral";
  if (macdLine != null && macdSignal != null && macdLinePrev != null && macdSignalPrev != null) {
    if (macdLinePrev <= macdSignalPrev && macdLine > macdSignal) macdSignalType = "bullish_cross";
    else if (macdLinePrev >= macdSignalPrev && macdLine < macdSignal) macdSignalType = "bearish_cross";
  }

  // EMA alignment
  let emaAlignment: BtcusdIndicators["emaAlignment"] = "mixed";
  if (ema9 && ema21 && ema50 && ema200) {
    if (ema9 > ema21 && ema21 > ema50 && ema50 > ema200) emaAlignment = "bullish_stack";
    else if (ema9 < ema21 && ema21 < ema50 && ema50 < ema200) emaAlignment = "bearish_stack";
  }

  return {
    price,
    open: open ?? price,
    high: high ?? price,
    low: low ?? price,
    volume: volume ?? 0,
    rsi14: rsi ?? null,
    ema9: ema9 ?? null,
    ema21: ema21 ?? null,
    ema50: ema50 ?? null,
    ema200: ema200 ?? null,
    macdLine: macdLine ?? null,
    macdSignal: macdSignal ?? null,
    macdHistogram: macdLine != null && macdSignal != null ? macdLine - macdSignal : null,
    bbUpper: bbUpper ?? null,
    bbMiddle: bbMiddle ?? null,
    bbLower: bbLower ?? null,
    bbWidth,
    atr14: atr ?? null,
    trend,
    rsiSignal,
    macdSignalType,
    emaAlignment,
    supportLevel: s1 ?? null,
    resistanceLevel: r1 ?? null,
  };
}
