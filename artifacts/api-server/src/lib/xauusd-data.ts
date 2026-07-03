/**
 * XAUUSD (Gold/USD) real-time data fetcher + technical indicator calculator
 * Uses Yahoo Finance GC=F (Gold Futures) — most reliable free source
 */

export interface XauusdCandle {
  timestamp: number; // Unix ms
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface XauusdIndicators {
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

const YAHOO_BASE = "https://query1.finance.yahoo.com";
const YAHOO_BASE2 = "https://query2.finance.yahoo.com";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9",
};

// ─── Candle fetcher ────────────────────────────────────────────────────────────

/**
 * Fetch candles for any Yahoo Finance ticker/interval/range combo. Used both
 * for XAUUSD itself (GC=F) and for correlated instruments like DXY / US10Y.
 */
export async function fetchTickerCandles(
  ticker: string,
  interval: "15m" | "1h" | "1d" = "1h",
  range = "60d"
): Promise<XauusdCandle[]> {
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;

  let res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    res = await fetch(
      `${YAHOO_BASE2}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`,
      { headers: HEADERS }
    );
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance ${ticker} HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          quote: Array<{
            open: number[];
            high: number[];
            low: number[];
            close: number[];
            volume: number[];
          }>;
        };
      }>;
      error?: { message: string };
    };
  };

  if (json.chart.error) throw new Error(json.chart.error.message);
  const result = json.chart.result?.[0];
  if (!result) throw new Error(`No data from Yahoo Finance for ${ticker}`);

  const { timestamp, indicators } = result;
  const q = indicators.quote[0];

  const candles: XauusdCandle[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    if (
      q.close[i] == null ||
      q.open[i] == null ||
      q.high[i] == null ||
      q.low[i] == null
    )
      continue;
    candles.push({
      timestamp: timestamp[i] * 1000,
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume[i] ?? 0,
    });
  }
  return candles;
}

/**
 * Fetch XAUUSD hourly candles (last 60 days = ~1440 candles, enough for EMA200)
 */
export async function fetchXauusdCandles(
  interval: "1h" | "1d" = "1h",
  range = "60d"
): Promise<XauusdCandle[]> {
  const ticker = "GC=F";
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`;

  let res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    // fallback to query2
    res = await fetch(
      `${YAHOO_BASE2}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=${interval}&range=${range}`,
      { headers: HEADERS }
    );
  }
  if (!res.ok) {
    throw new Error(`Yahoo Finance XAUUSD HTTP ${res.status}`);
  }

  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          quote: Array<{
            open: number[];
            high: number[];
            low: number[];
            close: number[];
            volume: number[];
          }>;
        };
      }>;
      error?: { message: string };
    };
  };

  if (json.chart.error) throw new Error(json.chart.error.message);
  const result = json.chart.result?.[0];
  if (!result) throw new Error("No XAUUSD data from Yahoo Finance");

  const { timestamp, indicators } = result;
  const q = indicators.quote[0];

  const candles: XauusdCandle[] = [];
  for (let i = 0; i < timestamp.length; i++) {
    if (
      q.close[i] == null ||
      q.open[i] == null ||
      q.high[i] == null ||
      q.low[i] == null
    )
      continue;
    candles.push({
      timestamp: timestamp[i] * 1000,
      open: q.open[i],
      high: q.high[i],
      low: q.low[i],
      close: q.close[i],
      volume: q.volume[i] ?? 0,
    });
  }
  return candles;
}

// ─── Technical indicator functions ────────────────────────────────────────────

function calcEma(closes: number[], period: number): number[] {
  if (closes.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = new Array(closes.length).fill(NaN);
  // Seed with SMA
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    result[i] = closes[i] * k + result[i - 1] * (1 - k);
  }
  return result;
}

function calcRsi(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const result: number[] = new Array(closes.length).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  // When avgLoss === 0, RSI is exactly 100 (no losses at all)
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcBollingerBands(
  closes: number[],
  period = 20,
  stdDevMult = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = new Array(closes.length).fill(NaN);
  const middle: number[] = new Array(closes.length).fill(NaN);
  const lower: number[] = new Array(closes.length).fill(NaN);

  for (let i = period - 1; i < closes.length; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance =
      slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    middle[i] = mean;
    upper[i] = mean + stdDevMult * stdDev;
    lower[i] = mean - stdDevMult * stdDev;
  }
  return { upper, middle, lower };
}

function calcAtr(candles: XauusdCandle[], period = 14): number[] {
  const result: number[] = new Array(candles.length).fill(NaN);
  if (candles.length < 2) return result;

  const trueRanges: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hcp = Math.abs(candles[i].high - candles[i - 1].close);
    const lcp = Math.abs(candles[i].low - candles[i - 1].close);
    trueRanges.push(Math.max(hl, hcp, lcp));
  }

  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = atr;
  }
  return result;
}

function calcSupportResistance(
  candles: XauusdCandle[],
  lookback = 50
): { support: number; resistance: number } {
  const recent = candles.slice(-lookback);
  const lows = recent.map((c) => c.low);
  const highs = recent.map((c) => c.high);
  return {
    support: Math.min(...lows),
    resistance: Math.max(...highs),
  };
}

// ─── Main calculator ───────────────────────────────────────────────────────────

export function calculateIndicators(
  candles: XauusdCandle[]
): XauusdIndicators | null {
  if (candles.length < 26) return null; // minimum for MACD

  const closes = candles.map((c) => c.close);
  const last = candles[candles.length - 1];

  // EMAs
  const ema9arr = calcEma(closes, 9);
  const ema21arr = calcEma(closes, 21);
  const ema50arr = calcEma(closes, 50);
  const ema200arr = calcEma(closes, 200);
  const n = closes.length - 1;

  const ema9 = isNaN(ema9arr[n]) ? null : ema9arr[n];
  const ema21 = isNaN(ema21arr[n]) ? null : ema21arr[n];
  const ema50 = isNaN(ema50arr[n]) ? null : ema50arr[n];
  const ema200 = isNaN(ema200arr[n]) ? null : ema200arr[n];

  // RSI
  const rsiArr = calcRsi(closes, 14);
  const rsi14 = isNaN(rsiArr[n]) ? null : parseFloat(rsiArr[n].toFixed(2));

  // MACD (12, 26, 9)
  const ema12arr = calcEma(closes, 12);
  const ema26arr = calcEma(closes, 26);
  const macdLineArr = ema12arr.map((v, i) =>
    isNaN(v) || isNaN(ema26arr[i]) ? NaN : v - ema26arr[i]
  );
  const macdSignalArr = calcEma(
    macdLineArr.filter((v) => !isNaN(v)),
    9
  );
  // Re-align macdSignal to candles length
  const firstValidMacd = macdLineArr.findIndex((v) => !isNaN(v));
  const macdSignalAligned: number[] = new Array(candles.length).fill(NaN);
  for (let i = 0; i < macdSignalArr.length; i++) {
    macdSignalAligned[firstValidMacd + i] = macdSignalArr[i];
  }
  const macdLine = isNaN(macdLineArr[n]) ? null : macdLineArr[n];
  const macdSignalVal = isNaN(macdSignalAligned[n])
    ? null
    : macdSignalAligned[n];
  const macdHistogram =
    macdLine != null && macdSignalVal != null
      ? macdLine - macdSignalVal
      : null;

  // Bollinger Bands (20, 2)
  const bb = calcBollingerBands(closes, 20, 2);
  const bbUpper = isNaN(bb.upper[n]) ? null : bb.upper[n];
  const bbMiddle = isNaN(bb.middle[n]) ? null : bb.middle[n];
  const bbLower = isNaN(bb.lower[n]) ? null : bb.lower[n];
  const bbWidth =
    bbUpper != null && bbLower != null && bbMiddle != null && bbMiddle !== 0
      ? ((bbUpper - bbLower) / bbMiddle) * 100
      : null;

  // ATR
  const atrArr = calcAtr(candles, 14);
  const atr14 = isNaN(atrArr[n]) ? null : atrArr[n];

  // Support / Resistance
  const { support, resistance } = calcSupportResistance(candles, 100);

  // ─── Derived signals ──────────────────────────────────────────────────────
  const rsiSignal: XauusdIndicators["rsiSignal"] =
    rsi14 == null ? "neutral" : rsi14 >= 70 ? "overbought" : rsi14 <= 30 ? "oversold" : "neutral";

  // MACD cross (compare current histogram vs previous)
  let macdSignalType: XauusdIndicators["macdSignalType"] = "neutral";
  if (macdHistogram != null && n > 0) {
    const prevHistogram =
      !isNaN(macdLineArr[n - 1]) && !isNaN(macdSignalAligned[n - 1])
        ? macdLineArr[n - 1] - macdSignalAligned[n - 1]
        : null;
    if (prevHistogram != null) {
      if (prevHistogram < 0 && macdHistogram > 0) macdSignalType = "bullish_cross";
      else if (prevHistogram > 0 && macdHistogram < 0) macdSignalType = "bearish_cross";
    }
  }

  // EMA alignment
  let emaAlignment: XauusdIndicators["emaAlignment"] = "mixed";
  const price = last.close;
  if (ema9 != null && ema21 != null && ema50 != null) {
    if (price > ema9 && ema9 > ema21 && ema21 > ema50) {
      emaAlignment = "bullish_stack";
    } else if (price < ema9 && ema9 < ema21 && ema21 < ema50) {
      emaAlignment = "bearish_stack";
    }
  }

  // Trend (combining EMA alignment + RSI + MACD)
  let trendScore = 0;
  if (emaAlignment === "bullish_stack") trendScore += 2;
  else if (emaAlignment === "bearish_stack") trendScore -= 2;
  if (rsiSignal === "overbought") trendScore += 1;
  else if (rsiSignal === "oversold") trendScore -= 1;
  if (macdHistogram != null && macdHistogram > 0) trendScore += 1;
  else if (macdHistogram != null && macdHistogram < 0) trendScore -= 1;
  const trend: XauusdIndicators["trend"] =
    trendScore > 1 ? "bullish" : trendScore < -1 ? "bearish" : "sideways";

  return {
    price: parseFloat(price.toFixed(2)),
    open: parseFloat(last.open.toFixed(2)),
    high: parseFloat(last.high.toFixed(2)),
    low: parseFloat(last.low.toFixed(2)),
    volume: last.volume,
    rsi14,
    ema9: ema9 != null ? parseFloat(ema9.toFixed(2)) : null,
    ema21: ema21 != null ? parseFloat(ema21.toFixed(2)) : null,
    ema50: ema50 != null ? parseFloat(ema50.toFixed(2)) : null,
    ema200: ema200 != null ? parseFloat(ema200.toFixed(2)) : null,
    macdLine: macdLine != null ? parseFloat(macdLine.toFixed(4)) : null,
    macdSignal: macdSignalVal != null ? parseFloat(macdSignalVal.toFixed(4)) : null,
    macdHistogram: macdHistogram != null ? parseFloat(macdHistogram.toFixed(4)) : null,
    bbUpper: bbUpper != null ? parseFloat(bbUpper.toFixed(2)) : null,
    bbMiddle: bbMiddle != null ? parseFloat(bbMiddle.toFixed(2)) : null,
    bbLower: bbLower != null ? parseFloat(bbLower.toFixed(2)) : null,
    bbWidth: bbWidth != null ? parseFloat(bbWidth.toFixed(3)) : null,
    atr14: atr14 != null ? parseFloat(atr14.toFixed(4)) : null,
    trend,
    rsiSignal,
    macdSignalType,
    emaAlignment,
    supportLevel: parseFloat(support.toFixed(2)),
    resistanceLevel: parseFloat(resistance.toFixed(2)),
  };
}

// ─── Live price ticker (lightweight, safe to call every second) ──────────────

export interface XauusdLivePrice {
  price: number;
  change: number | null; // absolute change vs previous close
  changePct: number | null;
  timestamp: number; // unix ms of the quote
}

/**
 * Fetch just the latest traded price for GC=F using Yahoo Finance's
 * lightweight 1-minute chart endpoint (much cheaper than the full 60d/1h
 * candle history used for indicators). Safe to poll frequently.
 */
export async function fetchXauusdLivePrice(): Promise<XauusdLivePrice> {
  const ticker = "GC=F";
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`;

  let res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    res = await fetch(
      `${YAHOO_BASE2}/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1m&range=1d`,
      { headers: HEADERS }
    );
  }
  if (!res.ok) throw new Error(`Yahoo Finance live price HTTP ${res.status}`);

  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        meta: {
          regularMarketPrice?: number;
          previousClose?: number;
          chartPreviousClose?: number;
          regularMarketTime?: number;
        };
      }>;
      error?: { message: string };
    };
  };

  if (json.chart.error) throw new Error(json.chart.error.message);
  const meta = json.chart.result?.[0]?.meta;
  if (!meta || meta.regularMarketPrice == null) {
    throw new Error("No live price data from Yahoo Finance");
  }

  const price = meta.regularMarketPrice;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const change = prevClose != null ? price - prevClose : null;
  const changePct = prevClose != null && prevClose !== 0 ? (change! / prevClose) * 100 : null;

  return {
    price: parseFloat(price.toFixed(2)),
    change: change != null ? parseFloat(change.toFixed(2)) : null,
    changePct: changePct != null ? parseFloat(changePct.toFixed(3)) : null,
    timestamp: meta.regularMarketTime ? meta.regularMarketTime * 1000 : Date.now(),
  };
}

// ─── Multi-timeframe analysis ──────────────────────────────────────────────────
// Yahoo Finance has no native 4h interval, so 4h candles are built by resampling
// the 1h series (every 4 consecutive 1h candles → 1 candle).

function resampleCandles(candles: XauusdCandle[], groupSize: number): XauusdCandle[] {
  const out: XauusdCandle[] = [];
  for (let i = 0; i < candles.length; i += groupSize) {
    const group = candles.slice(i, i + groupSize);
    if (group.length === 0) continue;
    out.push({
      timestamp: group[0].timestamp,
      open: group[0].open,
      high: Math.max(...group.map((c) => c.high)),
      low: Math.min(...group.map((c) => c.low)),
      close: group[group.length - 1].close,
      volume: group.reduce((sum, c) => sum + c.volume, 0),
    });
  }
  return out;
}

export interface TimeframeAnalysis {
  timeframe: "1h" | "4h" | "1d";
  label: string;
  indicators: XauusdIndicators | null;
}

/**
 * Computes indicators for 1H, 4H (resampled from 1H) and Daily timeframes so
 * traders can see whether shorter and longer-term trends agree or conflict.
 */
export async function getMultiTimeframeAnalysis(): Promise<TimeframeAnalysis[]> {
  const [hourly, daily] = await Promise.all([
    fetchXauusdCandles("1h", "60d"),
    fetchXauusdCandles("1d", "2y"),
  ]);

  const fourHour = resampleCandles(hourly, 4);

  return [
    { timeframe: "1h", label: "1 Jam", indicators: calculateIndicators(hourly) },
    { timeframe: "4h", label: "4 Jam", indicators: calculateIndicators(fourHour) },
    { timeframe: "1d", label: "Harian", indicators: calculateIndicators(daily) },
  ];
}

/**
 * Combines the per-timeframe trends into a single confluence read: how many
 * of the 3 timeframes agree on direction, used to boost/reduce AI confidence.
 */
export function summarizeTimeframeConfluence(
  analyses: TimeframeAnalysis[]
): { agreement: "strong_bullish" | "strong_bearish" | "mixed"; bullishCount: number; bearishCount: number } {
  let bullishCount = 0;
  let bearishCount = 0;
  for (const a of analyses) {
    if (!a.indicators) continue;
    if (a.indicators.trend === "bullish") bullishCount++;
    else if (a.indicators.trend === "bearish") bearishCount++;
  }
  let agreement: "strong_bullish" | "strong_bearish" | "mixed" = "mixed";
  if (bullishCount >= 2 && bullishCount > bearishCount) agreement = "strong_bullish";
  else if (bearishCount >= 2 && bearishCount > bullishCount) agreement = "strong_bearish";
  return { agreement, bullishCount, bearishCount };
}

// ─── DXY & US Treasury yield correlation ──────────────────────────────────────

const DXY_TICKER = "DX-Y.NYB";
const US10Y_TICKER = "^TNX";

function pearsonCorrelation(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 10) return null;
  const x = a.slice(a.length - n);
  const y = b.slice(b.length - n);
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

export interface CorrelationFactor {
  name: string;
  ticker: string;
  price: number | null;
  changePct: number | null;
  correlation: number | null; // Pearson correlation vs gold closes, last ~60 hourly candles
  interpretation: string;
}

export interface CorrelationAnalysis {
  gold: { price: number; changePct: number | null };
  dxy: CorrelationFactor;
  us10y: CorrelationFactor;
  computedAt: string;
}

/**
 * Fetches DXY (US Dollar Index) and US 10-Year Treasury yield alongside gold,
 * and computes their statistical correlation with gold's recent price moves.
 * Gold is historically negatively correlated with both DXY and real yields.
 */
export async function getCorrelationAnalysis(): Promise<CorrelationAnalysis> {
  const [goldCandles, dxyCandles, yieldCandles] = await Promise.all([
    fetchXauusdCandles("1h", "60d"),
    fetchTickerCandles(DXY_TICKER, "1h", "60d").catch(() => [] as XauusdCandle[]),
    fetchTickerCandles(US10Y_TICKER, "1h", "60d").catch(() => [] as XauusdCandle[]),
  ]);

  const goldCloses = goldCandles.map((c) => c.close);
  const goldLast = goldCandles[goldCandles.length - 1];
  const goldPrev = goldCandles[goldCandles.length - 2];
  const goldChangePct = goldPrev ? ((goldLast.close - goldPrev.close) / goldPrev.close) * 100 : null;

  function buildFactor(name: string, ticker: string, candles: XauusdCandle[]): CorrelationFactor {
    if (candles.length < 10) {
      return { name, ticker, price: null, changePct: null, correlation: null, interpretation: "Data tidak tersedia" };
    }
    const closes = candles.map((c) => c.close);
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const changePct = prev ? ((last.close - prev.close) / prev.close) * 100 : null;
    const correlation = pearsonCorrelation(goldCloses, closes);

    let interpretation = "Korelasi lemah/tidak signifikan dengan gold saat ini.";
    if (correlation != null) {
      if (correlation <= -0.5) {
        interpretation = `Korelasi negatif kuat (${correlation.toFixed(2)}) — saat ${name} naik, gold cenderung turun, sesuai pola historis.`;
      } else if (correlation >= 0.5) {
        interpretation = `Korelasi positif kuat (${correlation.toFixed(2)}) — tidak biasa, ${name} dan gold bergerak searah saat ini.`;
      } else {
        interpretation = `Korelasi lemah (${correlation.toFixed(2)}) — pergerakan ${name} kurang berpengaruh langsung pada gold saat ini.`;
      }
    }

    return {
      name,
      ticker,
      price: parseFloat(last.close.toFixed(3)),
      changePct: changePct != null ? parseFloat(changePct.toFixed(3)) : null,
      correlation: correlation != null ? parseFloat(correlation.toFixed(3)) : null,
      interpretation,
    };
  }

  return {
    gold: { price: parseFloat(goldLast.close.toFixed(2)), changePct: goldChangePct != null ? parseFloat(goldChangePct.toFixed(3)) : null },
    dxy: buildFactor("DXY (Dollar Index)", DXY_TICKER, dxyCandles),
    us10y: buildFactor("US 10-Year Treasury Yield", US10Y_TICKER, yieldCandles),
    computedAt: new Date().toISOString(),
  };
}

// ─── News fetcher ──────────────────────────────────────────────────────────────

export interface XauusdNewsItem {
  title: string;
  summary: string;
  url: string;
  source: string;
  publishedAt: Date;
}

export async function fetchXauusdNews(): Promise<XauusdNewsItem[]> {
  const queries = ["gold+XAUUSD", "gold+price+today"];
  const results: XauusdNewsItem[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const url = `${YAHOO_BASE2}/v1/finance/search?q=${q}&newsCount=8&enableNews=true&enableEnhancedTrivialQuery=true`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) continue;

      const json = (await res.json()) as {
        news?: Array<{
          title?: string;
          summary?: string;
          link?: string;
          publisher?: string;
          providerPublishTime?: number;
        }>;
      };

      for (const item of json.news ?? []) {
        if (!item.title || seen.has(item.title)) continue;
        seen.add(item.title);
        results.push({
          title: item.title,
          summary: item.summary ?? "",
          url: item.link ?? "",
          source: item.publisher ?? "Yahoo Finance",
          publishedAt: item.providerPublishTime
            ? new Date(item.providerPublishTime * 1000)
            : new Date(),
        });
      }
    } catch {
      // skip failed query
    }
  }

  return results.slice(0, 12);
}
