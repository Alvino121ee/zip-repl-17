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
import { quantBrainPredictionsTable, quantBotPredictionsTable } from "@workspace/db/schema";
import { getGoldCouncilDebate, getRecentGoldCouncilDebates, runLiveCouncilDebate, councilEvents, getIsCouncilRunning } from "../lib/quant-committee.js";
import { setEnsembleWeights, getEnsembleWeights } from "../lib/quant-bot-engine.js";
import { validateEaApiKey } from "../lib/xauusd-settings.js";

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

// GET /api/quant/committee/stream — tonton rapat live via SSE (broadcast dari runCouncilCycle)
quantRouter.get("/committee/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const write = (data: object) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // Kirim status awal agar client tahu apakah rapat sedang berlangsung
  write({ type: "connected", isRunning: getIsCouncilRunning() });

  const handler = (ev: object) => write(ev);
  councilEvents.on("data", handler);

  // Heartbeat 25 detik agar SSE tidak di-timeout proxy
  const heartbeat = setInterval(() => write({ type: "ping" }), 25_000);

  req.on("close", () => {
    councilEvents.off("data", handler);
    clearInterval(heartbeat);
  });
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

// ─── GET /api/quant/ea-signal — Endpoint untuk MetaTrader 5 EA (Quant Bot mode) ─
// Auth: ?key=<ea_api_key> atau header Authorization: Bearer <key>
// Query params:
//   ?brain=technical|fundamental|macro|ensemble  (default: ensemble)
//   ?format=plain  → "COMMAND|ENTRY|TP|SL|CONFIDENCE|SIGNAL_ID"
//   ?format=json   → JSON lengkap (default)
//
// SIGNAL_ID = integer ID dari DB — EA menyimpan ini; jika berubah = sinyal baru.
// Berbeda dari /xauusd/ea-signal (Mentor Mode) — ini murni dari Quant Bot 3-brain.
quantRouter.get("/ea-signal", async (req, res) => {
  try {
    // ── Validasi EA key ─────────────────────────────────────────────────────
    const authHeader = (req.headers.authorization as string | undefined) ?? "";
    const providedKey =
      (req.query["key"] as string | undefined) ??
      authHeader.replace(/^Bearer\s+/i, "");

    if (!providedKey) {
      return res.status(401).json({ error: "EA API key diperlukan (?key=... atau Authorization: Bearer ...)" });
    }
    const keyValid = await validateEaApiKey(providedKey);
    if (!keyValid) {
      return res.status(403).json({ error: "EA API key tidak valid — generate key baru di Admin → EA Key" });
    }

    const brainParam = (req.query["brain"] as string | undefined) ?? "ensemble";
    const validBrains = ["technical", "fundamental", "macro", "ensemble"];
    if (!validBrains.includes(brainParam)) {
      return res.status(400).json({ error: "brain harus: technical|fundamental|macro|ensemble" });
    }

    const livePrice = getLatestLivePrice();
    const currentPrice = livePrice?.price ?? null;

    // ── Ambil sinyal sesuai pilihan brain ───────────────────────────────────
    if (brainParam === "ensemble") {
      // Gunakan prediksi ensemble terbaru dari DB (sudah difilter Fix #9)
      const rows = await db
        .select()
        .from(quantBotPredictionsTable)
        .orderBy(desc(quantBotPredictionsTable.predictedAt))
        .limit(1);

      const row = rows[0];
      const status = getQuantBotStatus();

      if (!row || !status.ensemble) {
        const holdResp = {
          command: "HOLD", brain: "ensemble", signalId: 0,
          price: currentPrice, tp: null, sl: null, tp2: null,
          confidence: 0, consensus: null,
          reason: "Menunggu siklus pertama Quant Bot Orchestrator (±5 menit)",
          updatedAt: new Date().toISOString(),
        };
        if (req.query["format"] === "plain") return res.type("text/plain").send(`HOLD|${currentPrice ?? 0}|0|0|0|0`);
        return res.json({ ok: true, data: holdResp });
      }

      const command = row.signal as "BUY" | "SELL" | "HOLD";
      const tp   = command !== "HOLD" ? row.tp1  : null;
      const sl   = command !== "HOLD" ? row.sl   : null;
      const tp2  = command !== "HOLD" ? row.tp2  : null;
      const conf = row.confidence ?? 0;
      const sid  = row.id;

      if (req.query["format"] === "plain") {
        return res.type("text/plain").send(`${command}|${row.entryPrice}|${tp ?? 0}|${sl ?? 0}|${conf.toFixed(3)}|${sid}`);
      }
      return res.json({
        ok: true,
        data: {
          command, brain: "ensemble",
          signalId: sid,
          price: currentPrice ?? row.entryPrice,
          entryPrice: row.entryPrice,
          tp, sl, tp2,
          confidence: conf,
          consensus: status.ensemble?.consensus ?? null,
          session: row.session,
          technicalVote: row.technicalSignal,
          fundamentalVote: row.fundamentalSignal,
          macroVote: row.macroSignal,
          regime: row.regime,
          updatedAt: row.predictedAt,
        },
      });
    }

    // ── Brain individual (technical / fundamental / macro) ──────────────────
    const brain = brainParam as BrainType;
    const pred = await getLatestBrainPrediction(brain);

    if (!pred || pred.signal === "HOLD") {
      const holdResp = {
        command: "HOLD", brain, signalId: pred?.id ?? 0,
        price: currentPrice, tp: null, sl: null,
        confidence: pred?.confidence ?? 0,
        reason: !pred ? `Menunggu siklus pertama ${brain} brain` : "Sinyal HOLD — brain tidak yakin arah",
        updatedAt: new Date().toISOString(),
      };
      if (req.query["format"] === "plain") return res.type("text/plain").send(`HOLD|${currentPrice ?? 0}|0|0|${pred?.confidence?.toFixed(3) ?? 0}|${pred?.id ?? 0}`);
      return res.json({ ok: true, data: holdResp });
    }

    const command = pred.signal as "BUY" | "SELL";
    const sid = pred.id;

    if (req.query["format"] === "plain") {
      return res.type("text/plain").send(`${command}|${pred.entryPrice}|${pred.tp}|${pred.sl}|${pred.confidence.toFixed(3)}|${sid}`);
    }
    return res.json({
      ok: true,
      data: {
        command, brain,
        signalId: sid,
        price: currentPrice ?? pred.entryPrice,
        entryPrice: pred.entryPrice,
        tp: pred.tp,
        sl: pred.sl,
        tp2: null,
        confidence: pred.confidence,
        pips: pred.pips,
        reasoning: pred.reasoning,
        updatedAt: pred.predictedAt,
      },
    });
  } catch (err) {
    console.error("[Quant] /ea-signal error:", err);
    return res.status(500).json({ ok: false, error: (err as Error).message });
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
