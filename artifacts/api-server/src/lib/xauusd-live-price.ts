/**
 * XAUUSD live price ticker — polls Swissquote public forex feed every 5 seconds.
 * Swissquote provides real broker bid/ask data with no authentication required.
 * Caches the latest quote in memory so all frontend pollers share one upstream call.
 */

import { fetchXauusdLivePrice, type XauusdLivePrice } from "./xauusd-data.js";

// Swissquote updates every few seconds; poll every 5s for fresh data
const POLL_INTERVAL_MS = 5_000;

// Mark as stale if no successful update for 2 minutes
const STALE_THRESHOLD_MS = 2 * 60 * 1000;

let latest: XauusdLivePrice | null = null;
let lastError: string | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let inFlight = false;

async function tick(): Promise<void> {
  if (inFlight) return;
  inFlight = true;
  try {
    latest = await fetchXauusdLivePrice();
    lastError = null;
  } catch (err) {
    lastError = String(err);
    // keep serving the last known good price on failure
  } finally {
    inFlight = false;
  }
}

export function startXauusdLivePriceTicker(): void {
  if (timer) return;
  void tick(); // fetch immediately on start
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopXauusdLivePriceTicker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export function getLatestLivePrice(): {
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
    source: "Swissquote",
  };
}
