import { Router, type Request, type Response, type NextFunction } from "express";
import {
  getQuantBotStatus,
  getRecentPredictions,
  getBrainStats,
  updateCapital,
} from "../lib/quant-bot-engine.js";
import { getTechnicalSignal } from "../lib/quant-technical-brain.js";
import { getFundamentalSignal } from "../lib/quant-fundamental-brain.js";
import { getMacroSignal } from "../lib/quant-macro-brain.js";
import { fetchQuantNews, getNewsApiSettings } from "../lib/quant-news-fetcher.js";
import { db } from "@workspace/db";
import { quantPsychologyLogTable } from "@workspace/db/schema";
import { desc } from "drizzle-orm";
import { xauusdSettingsTable } from "@workspace/db/schema";
import { eq, sql } from "drizzle-orm";
import { getLatestLivePrice } from "../lib/xauusd-live-price.js";
import { getLatestBtcusdLivePrice } from "../lib/btcusd-live-price.js";

// ─── Auth middleware (same pattern as xauusd.ts) ──────────────────────────────
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Admin operations disabled: SESSION_SECRET not set" });
    }
    return next();
  }
  const token = ((req.headers.authorization as string) ?? "").replace(/^Bearer\s+/i, "");
  if (token !== secret) return res.status(403).json({ error: "Forbidden — admin login diperlukan" });
  return next();
}

export const quantRouter = Router();

// GET /api/quant/status — full quant bot status (all 3 brains + ensemble + psychology)
quantRouter.get("/status", async (_req, res) => {
  try {
    const status = getQuantBotStatus();
    res.json({ ok: true, data: status });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/live-prices — realtime XAUUSD & BTCUSD ticker (data dikumpulkan tiap 1 detik)
quantRouter.get("/live-prices", (_req, res) => {
  res.json({
    ok: true,
    data: {
      xauusd: getLatestLivePrice(),
      btcusd: getLatestBtcusdLivePrice(),
      updatedAt: new Date().toISOString(),
    },
  });
});

// GET /api/quant/signal — quick ensemble signal only
quantRouter.get("/signal", async (_req, res) => {
  try {
    const [tech, fund, macro] = await Promise.all([
      getTechnicalSignal(),
      getFundamentalSignal(),
      getMacroSignal(),
    ]);
    const status = getQuantBotStatus();
    res.json({
      ok: true,
      data: {
        ensemble: status.ensemble,
        technical: { signal: tech.signal, confidence: tech.confidence },
        fundamental: { signal: fund.signal, confidence: fund.confidence },
        macro: { signal: macro.signal, confidence: macro.confidence, macroRegime: macro.macroRegime },
        psychology: status.psychology,
        updatedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/psychology — latest psychology analysis
quantRouter.get("/psychology", async (_req, res) => {
  try {
    const status = getQuantBotStatus();
    const history = await db.select().from(quantPsychologyLogTable)
      .orderBy(desc(quantPsychologyLogTable.loggedAt)).limit(10);
    res.json({ ok: true, data: { current: status.psychology, history } });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/news — latest news with sentiment
quantRouter.get("/news", async (_req, res) => {
  try {
    const [news, settings] = await Promise.all([fetchQuantNews(), getNewsApiSettings()]);
    res.json({ ok: true, data: { news, newsApiProvider: settings.provider, hasApiKey: settings.hasKey } });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/predictions — recent quant bot predictions
quantRouter.get("/predictions", async (req, res) => {
  try {
    const limit = Math.min(50, Number(req.query["limit"] ?? 20));
    const predictions = await getRecentPredictions(limit);
    res.json({ ok: true, data: predictions });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/brain-stats — per-brain insight counts and accuracy
quantRouter.get("/brain-stats", async (_req, res) => {
  try {
    const stats = await getBrainStats();
    const status = getQuantBotStatus();
    res.json({
      ok: true,
      data: {
        technical: { ...stats.technical, cycleCount: status.technical ? status.cycleCount : 0 },
        fundamental: { ...stats.fundamental },
        macro: { ...stats.macro },
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/quant/capital — update capital settings (admin only)
quantRouter.post("/capital", requireAdmin, async (req, res) => {
  try {
    const { accountBalance, riskPercent, leverage } = req.body as {
      accountBalance?: number; riskPercent?: number; leverage?: number;
    };
    if (accountBalance !== undefined && (isNaN(accountBalance) || accountBalance <= 0)) {
      return res.status(400).json({ ok: false, error: "accountBalance harus > 0" });
    }
    if (riskPercent !== undefined && (isNaN(riskPercent) || riskPercent < 0.1 || riskPercent > 10)) {
      return res.status(400).json({ ok: false, error: "riskPercent harus antara 0.1–10%" });
    }
    updateCapital({ accountBalance, riskPercent, leverage });
    res.json({ ok: true, data: { accountBalance, riskPercent, leverage } });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// POST /api/quant/news-api-key — save news API key + provider (admin only)
quantRouter.post("/news-api-key", requireAdmin, async (req, res) => {
  try {
    const { apiKey, provider } = req.body as { apiKey?: string; provider?: string };
    if (!apiKey || !provider) {
      return res.status(400).json({ ok: false, error: "apiKey dan provider wajib diisi" });
    }
    const validProviders = ["finnhub", "polygon"];
    if (!validProviders.includes(provider)) {
      return res.status(400).json({ ok: false, error: `provider harus salah satu: ${validProviders.join(", ")}` });
    }

    await Promise.all([
      db.insert(xauusdSettingsTable).values({ key: "news_api_key", value: apiKey })
        .onConflictDoUpdate({ target: xauusdSettingsTable.key, set: { value: apiKey, updatedAt: new Date() } }),
      db.insert(xauusdSettingsTable).values({ key: "news_api_provider", value: provider })
        .onConflictDoUpdate({ target: xauusdSettingsTable.key, set: { value: provider, updatedAt: new Date() } }),
    ]);

    res.json({ ok: true, data: { provider, message: `News API (${provider}) berhasil disimpan` } });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});
