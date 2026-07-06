import app from "./app";
import { logger } from "./lib/logger";
import { startXauusdBrainEngine } from "./lib/xauusd-brain-engine.js";
import { startBtcBrainEngine } from "./lib/btcusd-brain-engine.js";
import { startXauusdLivePriceTicker } from "./lib/xauusd-live-price.js";
import { ensureAgentsExist } from "./lib/agent-engine.js";

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

  // Start realtime (1s) live price ticker
  startXauusdLivePriceTicker();
});
