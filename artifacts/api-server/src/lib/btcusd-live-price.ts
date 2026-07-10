/**
 * BTCUSD live price ticker — polls TradingView Scanner (fallback: CoinGecko) every second.
 * Caches the latest quote in memory so all frontend pollers share one upstream call,
 * mirroring the XAUUSD real-time ticker in xauusd-live-price.ts.
 */

import { fetchBtcusdLivePrice, type BtcusdLivePrice } from "./btcusd-data.js";

// Real-time collection: poll every 1s so the quant bot page reflects fresh ticks
const POLL_INTERVAL_MS = 1_000;

// Mark as stale if no successful update for 2 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

// After repeated failures, back off to avoid hammering the upstream feed
const MAX_BACKOFF_MS = 30_000;

let latest: BtcusdLivePrice | null = null;
let lastError: string | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let consecutiveFailures = 0;

function nextDelay(): number {
  if (consecutiveFailures === 0) return POLL_INTERVAL_MS;
  return Math.min(POLL_INTERVAL_MS * 2 ** consecutiveFailures, MAX_BACKOFF_MS);
}

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    latest = await fetchBtcusdLivePrice();
    lastError = null;
    consecutiveFailures = 0;
  } catch (err) {
    lastError = String(err);
    consecutiveFailures += 1;
    // keep serving the last known good price on failure
  } finally {
    inFlight = false;
    if (timer !== null) timer = setTimeout(() => void tick(), nextDelay());
  }
}

export function startBtcusdLivePriceTicker(): void {
  if (timer) return;
  timer = setTimeout(() => void tick(), 0); // fetch immediately on start
}

export function stopBtcusdLivePriceTicker(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

export function getLatestBtcusdLivePrice(): {
  price: number | null;
  bid: number | null;
  ask: number | null;
  change: number | null;
  changePct: number | null;
  timestamp: number | null;
  stale: boolean;
  error: string | null;
  source: string;
} {
  const stale = latest ? Date.now() - latest.timestamp > STALE_THRESHOLD_MS : true;
  return {
    price:     latest?.price     ?? null,
    bid:       latest?.bid       ?? null,
    ask:       latest?.ask       ?? null,
    change:    latest?.change    ?? null,
    changePct: latest?.changePct ?? null,
    timestamp: latest?.timestamp ?? null,
    stale,
    error:  lastError,
    source: "TradingView/CoinGecko",
  };
}
