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

  // Start XAUUSD autonomous learning engine
  startXauusdBrainEngine();

  // Start BTCUSD autonomous learning engine (BTC is 24/7)
  startBtcBrainEngine();

  // Start realtime (1s) live price ticker
  startXauusdLivePriceTicker();
});
