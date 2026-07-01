/**
 * Yahoo Finance data fetcher untuk saham IDX/IHSG
 * Menggunakan ticker format: {TICKER}.JK (contoh: BBCA.JK)
 */

export interface YahooOHLCV {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface YahooQuote {
  ticker: string;
  name: string;
  currentPrice: number;
  currency: string;
  marketCap: number | null;
  pe: number | null;
  pb: number | null;
  eps: number | null;
  dividendYield: number | null;
  beta: number | null;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
}

const YAHOO_BASE = "https://query1.finance.yahoo.com";
const YAHOO_BASE2 = "https://query2.finance.yahoo.com";

const HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "application/json",
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch histori harga OHLCV 1 tahun untuk satu ticker IDX
 */
export async function fetchPriceHistory(
  ticker: string,
  range = "1y"
): Promise<YahooOHLCV[]> {
  const symbol = `${ticker}.JK`;
  const url = `${YAHOO_BASE}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`Yahoo Finance chart HTTP ${res.status} for ${symbol}`);
  }

  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp: number[];
        indicators: {
          quote: Array<{
            open: (number | null)[];
            high: (number | null)[];
            low: (number | null)[];
            close: (number | null)[];
            volume: (number | null)[];
          }>;
        };
      }>;
      error?: { code: string; description: string };
    };
  };

  if (json.chart.error) {
    throw new Error(`Yahoo Finance error for ${symbol}: ${json.chart.error.description}`);
  }

  const result = json.chart.result?.[0];
  if (!result) return [];

  const timestamps = result.timestamp;
  const q = result.indicators.quote[0];

  const rows: YahooOHLCV[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const open = q.open[i];
    const high = q.high[i];
    const low = q.low[i];
    const close = q.close[i];
    const volume = q.volume[i];

    if (open == null || high == null || low == null || close == null || volume == null) continue;
    if (close <= 0) continue;

    const date = new Date(timestamps[i] * 1000);
    const dateStr = date.toISOString().slice(0, 10);

    rows.push({
      date: dateStr,
      open: Math.round(open),
      high: Math.round(high),
      low: Math.round(low),
      close: Math.round(close),
      volume,
    });
  }

  return rows;
}

/**
 * Fetch data quote ringkas (harga terkini + fundamental utama) untuk satu ticker
 */
export async function fetchQuote(ticker: string): Promise<YahooQuote | null> {
  const symbol = `${ticker}.JK`;
  const url = `${YAHOO_BASE2}/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`;

  try {
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;

    const json = (await res.json()) as {
      chart: {
        result?: Array<{
          meta: {
            currency: string;
            symbol: string;
            longName?: string;
            shortName?: string;
            regularMarketPrice: number;
            regularMarketVolume: number;
            fiftyTwoWeekHigh: number;
            fiftyTwoWeekLow: number;
          };
        }>;
      };
    };

    const result = json.chart.result?.[0];
    if (!result) return null;

    const meta = result.meta;
    return {
      ticker,
      name: meta.longName ?? meta.shortName ?? ticker,
      currentPrice: meta.regularMarketPrice,
      currency: meta.currency,
      marketCap: null,
      pe: null,
      pb: null,
      eps: null,
      dividendYield: null,
      beta: null,
      fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch semua ticker sekaligus dengan rate limiting (1 request / 300ms)
 */
export async function fetchAllPriceHistories(
  tickers: string[],
  onProgress?: (done: number, total: number, ticker: string) => void
): Promise<Map<string, YahooOHLCV[]>> {
  const result = new Map<string, YahooOHLCV[]>();
  const BATCH = 5;
  const DELAY_BETWEEN_BATCHES = 1500;

  for (let i = 0; i < tickers.length; i += BATCH) {
    const batch = tickers.slice(i, i + BATCH);

    await Promise.all(
      batch.map(async (ticker) => {
        try {
          const rows = await fetchPriceHistory(ticker);
          result.set(ticker, rows);
          onProgress?.(result.size, tickers.length, ticker);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[yahoo] Skip ${ticker}: ${msg}`);
          result.set(ticker, []);
        }
      })
    );

    if (i + BATCH < tickers.length) {
      await sleep(DELAY_BETWEEN_BATCHES);
    }
  }

  return result;
}
