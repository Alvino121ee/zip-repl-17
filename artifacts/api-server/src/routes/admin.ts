/**
 * Admin routes — system info only (XAUUSD settings live in /xauusd/settings)
 */
import { Router } from "express";
import { getEngineStatus } from "../lib/xauusd-brain-engine.js";
import { getSettingsSummary } from "../lib/xauusd-settings.js";
import { getLatestLivePrice } from "../lib/xauusd-live-price.js";

const router = Router();

// GET /admin/system — overall system status snapshot
router.get("/system", async (_req, res) => {
  try {
    const [engine, settings, livePrice] = await Promise.all([
      Promise.resolve(getEngineStatus()),
      getSettingsSummary(),
      Promise.resolve(getLatestLivePrice()),
    ]);

    res.json({
      ok: true,
      engine,
      settings,
      livePrice,
      serverTime: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err) });
  }
});

export default router;
