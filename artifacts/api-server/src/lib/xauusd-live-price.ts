/**
 * XAUUSD live price ticker — polls Yahoo Finance every second and caches the
 * latest quote in memory so the frontend can show a realtime-feeling price
 * without hammering Yahoo on every browser tab/poll.
 */

import { fetchXauusdLivePrice, type XauusdLivePrice } from "./xauusd-data.js";

const POLL_INTERVAL_MS = 1000;

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
  void tick();
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
  change: number | null;
  changePct: number | null;
  timestamp: number | null;
  stale: boolean;
  error: string | null;
} {
  const stale = latest ? Date.now() - latest.timestamp > 5 * 60 * 1000 : true;
  return {
    price: latest?.price ?? null,
    change: latest?.change ?? null,
    changePct: latest?.changePct ?? null,
    timestamp: latest?.timestamp ?? null,
    stale,
    error: lastError,
  };
}
