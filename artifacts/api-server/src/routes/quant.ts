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
import {
  getLatestBrainPrediction,
  getBrainPredictionStats,
  type BrainType,
} from "../lib/quant-brain-predictions.js";
import { quantBrainPredictionsTable } from "@workspace/db/schema";
import { getGoldCouncilDebate, getRecentGoldCouncilDebates, runLiveCouncilDebate } from "../lib/quant-committee.js";
import { setEnsembleWeights, getEnsembleWeights } from "../lib/quant-bot-engine.js";

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

// GET /api/quant/brain-predictions — latest standalone prediction + accuracy per brain
// Setiap brain (Technical/Fundamental/Macro) punya prediksi sendiri dengan SL/TP 100 pips (adil, sama untuk ketiganya).
quantRouter.get("/brain-predictions", async (_req, res) => {
  try {
    const brains: BrainType[] = ["technical", "fundamental", "macro"];
    const [latest, stats] = await Promise.all([
      Promise.all(brains.map((b) => getLatestBrainPrediction(b))),
      Promise.all(brains.map((b) => getBrainPredictionStats(b))),
    ]);
    const data: Record<string, unknown> = {};
    brains.forEach((b, i) => {
      data[b] = { latest: latest[i], stats: stats[i] };
    });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/brain-predictions/:brain/history — recent predictions for one brain
quantRouter.get("/brain-predictions/:brain/history", async (req, res) => {
  try {
    const brain = req.params.brain as BrainType;
    if (!["technical", "fundamental", "macro"].includes(brain)) {
      return res.status(400).json({ ok: false, error: "brain harus technical|fundamental|macro" });
    }
    const limit = Math.min(50, Number(req.query["limit"] ?? 20));
    const rows = await db
      .select()
      .from(quantBrainPredictionsTable)
      .where(eq(quantBrainPredictionsTable.brainType, brain))
      .orderBy(desc(quantBrainPredictionsTable.id))
      .limit(limit);
    res.json({ ok: true, data: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/committee — Dewan Emas: 15 analis + 1 Gubernur debat & vote
quantRouter.get("/committee", async (_req, res) => {
  try {
    const debate = getGoldCouncilDebate();
    const history = await getRecentGoldCouncilDebates(10);
    res.json({ ok: true, data: { current: debate, history } });
  } catch (err) {
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});

// GET /api/quant/weights — bobot ensemble saat ini
quantRouter.get("/weights", (_req, res) => {
  res.json({ ok: true, data: getEnsembleWeights() });
});

// POST /api/quant/weights — ubah bobot ensemble (admin only)
quantRouter.post("/weights", requireAdmin, (req, res) => {
  const { technical, fundamental, macro } = req.body as { technical?: number; fundamental?: number; macro?: number };
  if (typeof technical !== "number" || typeof fundamental !== "number" || typeof macro !== "number") {
    return res.status(400).json({ ok: false, error: "Kirim technical, fundamental, macro sebagai angka." });
  }
  setEnsembleWeights({ technical, fundamental, macro });
  res.json({ ok: true, data: getEnsembleWeights() });
});

// POST /api/quant/committee/live-debate — SSE streaming rapat live
quantRouter.post("/committee/live-debate", async (_req, res) => {
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data: object) => {
    try {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      // flush if compression middleware added it
      if (typeof (res as unknown as { flush?: () => void }).flush === "function") {
        (res as unknown as { flush: () => void }).flush();
      }
    } catch { /* client disconnected */ }
  };

  try {
    await runLiveCouncilDebate(send);
  } catch (err) {
    send({ type: "error", message: (err as Error).message });
  }

  res.end();
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
