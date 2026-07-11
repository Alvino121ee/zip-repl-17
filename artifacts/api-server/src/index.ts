import app from "./app";
import { logger } from "./lib/logger";
import { startXauusdBrainEngine } from "./lib/xauusd-brain-engine.js";
import { startBtcBrainEngine } from "./lib/btcusd-brain-engine.js";
import { startXauusdLivePriceTicker } from "./lib/xauusd-live-price.js";
import { startBtcusdLivePriceTicker } from "./lib/btcusd-live-price.js";
import { startMentorIndicatorsTicker } from "./lib/xauusd-mentor-cache.js";
import { ensureAgentsExist } from "./lib/agent-engine.js";
import { startTechnicalBrain } from "./lib/quant-technical-brain.js";
import { startFundamentalBrain } from "./lib/quant-fundamental-brain.js";
import { startMacroBrain } from "./lib/quant-macro-brain.js";
import { startQuantBotEngine } from "./lib/quant-bot-engine.js";
import { startBtcTechnicalBrain } from "./lib/btc-quant-technical-brain.js";
import { startBtcFundamentalBrain } from "./lib/btc-quant-fundamental-brain.js";
import { startBtcMacroBrain } from "./lib/btc-quant-macro-brain.js";
import { startBtcQuantEngine } from "./lib/btc-quant-engine.js";
import { startGoldCouncil } from "./lib/quant-committee.js";
import { startBtcCouncil } from "./lib/btc-quant-committee.js";

const port = Number(process.env["PORT"] ?? "8080");

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${process.env["PORT"]}"`);
}

app.listen(port, async (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Seed default AI agent configs (xauusd, technical, screening)
  try {
    await ensureAgentsExist();
    logger.info("AI agents seeded");
  } catch (e) {
    logger.error({ err: e }, "Failed to seed agents");
  }

  // Load AI API key from DB into process.env (agar ai-generator.ts langsung bisa pakai)
  const { isXauusdBrainEnabled, isBtcusdBrainEnabled, loadAiEnvFromDb } = await import("./lib/xauusd-settings.js");
  try { await loadAiEnvFromDb(); } catch (e) { logger.warn({ err: e }, "Gagal load AI env dari DB"); }

  // Start engines — respect admin on/off settings persisted in DB

  const [xauusdEnabled, btcEnabled] = await Promise.all([
    isXauusdBrainEnabled(),
    isBtcusdBrainEnabled(),
  ]);

  if (xauusdEnabled) {
    startXauusdBrainEngine();
  } else {
    logger.info("XAUUSD Brain Engine dinonaktifkan (setting DB).");
  }

  if (btcEnabled) {
    startBtcBrainEngine();
  } else {
    logger.info("BTC Brain Engine dinonaktifkan (setting DB).");
  }

  // Start realtime (1s) live price tickers — XAUUSD & BTCUSD
  startXauusdLivePriceTicker();
  startBtcusdLivePriceTicker();

  // Start 30s indicator cache for Mentor Mode (live TradingView data, no DB)
  startMentorIndicatorsTicker();

  // ── Quant Bot XAUUSD: 3 independent AI brains ───────────────────────────────
  startTechnicalBrain();
  startFundamentalBrain();
  startMacroBrain();
  // Orchestrator starts after brains (10s delay built-in)
  startQuantBotEngine();
  // Dewan Emas: 15 analis + 1 Gubernur, rapat setiap 10 menit
  startGoldCouncil();

  // ── Quant Bot BTC: 3 independent AI brains (scalping, TP/SL max $1000) ─────
  // BTC Brain v2 lama tetap jalan — brain baru belajar paralel
  if (btcEnabled) {
    startBtcTechnicalBrain();
    startBtcFundamentalBrain();
    startBtcMacroBrain();
    // Orchestrator starts 15s after brains init
    startBtcQuantEngine();
    // Dewan BTC: 15 analis + 1 Presiden, rapat setiap 8 menit
    startBtcCouncil();
  }
});
