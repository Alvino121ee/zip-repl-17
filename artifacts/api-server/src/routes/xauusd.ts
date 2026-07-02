/**
 * XAUUSD AI routes — realtime data, brain, learning log, predictions, news, chat
 */

import { Router } from "express";
import { db } from "@workspace/db";
import {
  xauusdSnapshotsTable,
  xauusdBrainTable,
  xauusdQuestionsLogTable,
  xauusdPredictionsTable,
  xauusdNewsTable,
  xauusdLearningLogTable,
} from "@workspace/db/schema";
import { eq, desc, and } from "drizzle-orm";
import {
  fetchXauusdCandles,
  calculateIndicators,
} from "../lib/xauusd-data.js";
import {
  runLearningCycle,
  getEngineStatus,
  startXauusdBrainEngine,
  stopXauusdBrainEngine,
} from "../lib/xauusd-brain-engine.js";
import { chatWithAgent } from "../lib/agent-engine.js";

export const xauusdRouter = Router();

// ─── GET /xauusd/snapshot — current price + all indicators ───────────────────
xauusdRouter.get("/snapshot", async (_req, res) => {
  try {
    const candles = await fetchXauusdCandles("1h", "60d");
    const indicators = calculateIndicators(candles);
    if (!indicators) {
      return res.status(503).json({ error: "Not enough data to calculate indicators" });
    }

    // Also get last saved snapshot for price change comparison
    const lastSnap = await db
      .select()
      .from(xauusdSnapshotsTable)
      .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
      .limit(1);

    return res.json({
      ...indicators,
      lastSnapshotAt: lastSnap[0]?.snapshotAt ?? null,
      lastSavedPrice: lastSnap[0]?.price ?? null,
    });
  } catch (err) {
    console.error("[XAUUSD] /snapshot error:", err);
    return res.status(500).json({ error: String(err) });
  }
});

// ─── GET /xauusd/snapshots — history of saved snapshots ──────────────────────
xauusdRouter.get("/snapshots", async (req, res) => {
  const limit = Math.min(200, parseInt(String(req.query.limit ?? "50"), 10));
  const spikesOnly = req.query.spikesOnly === "true";

  const rows = await db
    .select()
    .from(xauusdSnapshotsTable)
    .where(spikesOnly ? eq(xauusdSnapshotsTable.isSpike, true) : undefined)
    .orderBy(desc(xauusdSnapshotsTable.snapshotAt))
    .limit(limit);

  return res.json(rows);
});

// ─── GET /xauusd/brain — all stored knowledge ────────────────────────────────
xauusdRouter.get("/brain", async (req, res) => {
  const category = req.query.category as string | undefined;
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "50"), 10));

  const rows = await db
    .select()
    .from(xauusdBrainTable)
    .where(
      category
        ? and(eq(xauusdBrainTable.category, category), eq(xauusdBrainTable.isActive, true))
        : eq(xauusdBrainTable.isActive, true)
    )
    .orderBy(desc(xauusdBrainTable.confidence), desc(xauusdBrainTable.createdAt))
    .limit(limit);

  return res.json(rows);
});

// ─── GET /xauusd/brain/stats — summary stats ─────────────────────────────────
xauusdRouter.get("/brain/stats", async (_req, res) => {
  const all = await db
    .select({
      category: xauusdBrainTable.category,
    })
    .from(xauusdBrainTable)
    .where(eq(xauusdBrainTable.isActive, true));

  const byCategory: Record<string, number> = {};
  for (const row of all) {
    byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
  }

  const totalQuestions = await db
    .select({ id: xauusdQuestionsLogTable.id })
    .from(xauusdQuestionsLogTable);

  const totalPredictions = await db
    .select({
      isCorrect: xauusdPredictionsTable.isCorrect,
      status: xauusdPredictionsTable.status,
    })
    .from(xauusdPredictionsTable);

  const verifiedPreds = totalPredictions.filter(
    (p) => p.status === "verified" || p.status === "revised"
  );
  const correctPreds = verifiedPreds.filter((p) => p.isCorrect === true);
  const accuracy =
    verifiedPreds.length > 0
      ? Math.round((correctPreds.length / verifiedPreds.length) * 100)
      : null;

  return res.json({
    totalInsights: all.length,
    byCategory,
    totalQuestionsAsked: totalQuestions.length,
    totalPredictions: totalPredictions.length,
    verifiedPredictions: verifiedPreds.length,
    correctPredictions: correctPreds.length,
    predictionAccuracy: accuracy,
  });
});

// ─── DELETE /xauusd/brain/:id — deactivate a brain entry ─────────────────────
xauusdRouter.delete("/brain/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });
  await db
    .update(xauusdBrainTable)
    .set({ isActive: false })
    .where(eq(xauusdBrainTable.id, id));
  return res.json({ ok: true });
});

// ─── GET /xauusd/questions — learning questions log ──────────────────────────
xauusdRouter.get("/questions", async (req, res) => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "30"), 10));
  const rows = await db
    .select()
    .from(xauusdQuestionsLogTable)
    .orderBy(desc(xauusdQuestionsLogTable.askedAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/predictions — prediction history ────────────────────────────
xauusdRouter.get("/predictions", async (req, res) => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "20"), 10));
  const rows = await db
    .select()
    .from(xauusdPredictionsTable)
    .orderBy(desc(xauusdPredictionsTable.predictedAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/news — latest XAUUSD news ───────────────────────────────────
xauusdRouter.get("/news", async (req, res) => {
  const limit = Math.min(50, parseInt(String(req.query.limit ?? "20"), 10));
  const rows = await db
    .select()
    .from(xauusdNewsTable)
    .orderBy(desc(xauusdNewsTable.fetchedAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/learning-log — cycle history ────────────────────────────────
xauusdRouter.get("/learning-log", async (req, res) => {
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "30"), 10));
  const rows = await db
    .select()
    .from(xauusdLearningLogTable)
    .orderBy(desc(xauusdLearningLogTable.cycleAt))
    .limit(limit);
  return res.json(rows);
});

// ─── GET /xauusd/engine-status — is the brain running? ───────────────────────
xauusdRouter.get("/engine-status", (_req, res) => {
  return res.json(getEngineStatus());
});

// ─── Simple admin guard for write operations ──────────────────────────────────
// Accepts SESSION_SECRET as Bearer token, or a permissive flag in dev
function requireAdmin(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    // No secret configured — allow in dev, block in production
    if (process.env.NODE_ENV === "production") {
      return res.status(403).json({ error: "Admin operations disabled: SESSION_SECRET not set" });
    }
    return next();
  }
  const auth = req.headers.authorization ?? req.query.token as string ?? "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (token !== secret) {
    return res.status(403).json({ error: "Forbidden — invalid admin token" });
  }
  return next();
}

// ─── POST /xauusd/engine/start — manually start engine ───────────────────────
xauusdRouter.post("/engine/start", requireAdmin, (_req, res) => {
  startXauusdBrainEngine();
  return res.json({ ok: true, status: getEngineStatus() });
});

// ─── POST /xauusd/engine/stop — manually stop engine ─────────────────────────
xauusdRouter.post("/engine/stop", requireAdmin, (_req, res) => {
  stopXauusdBrainEngine();
  return res.json({ ok: true, status: getEngineStatus() });
});

// ─── POST /xauusd/learn-now — trigger immediate learning cycle ────────────────
xauusdRouter.post("/learn-now", requireAdmin, async (_req, res) => {
  try {
    const result = await runLearningCycle();
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
});

// ─── POST /xauusd/chat — chat with the XAUUSD AI agent ───────────────────────
xauusdRouter.post("/chat", async (req, res) => {
  const { message, sessionId } = req.body as {
    message?: string;
    sessionId?: string;
  };

  if (!message || typeof message !== "string") {
    return res.status(400).json({ error: "message is required" });
  }
  if (!sessionId || typeof sessionId !== "string") {
    return res.status(400).json({ error: "sessionId is required" });
  }

  try {
    // Build live context from latest snapshot or live fetch
    let contextData = "";
    try {
      const candles = await fetchXauusdCandles("1h", "60d");
      const ind = calculateIndicators(candles);
      if (ind) {
        // Get top brain insights for context
        const topInsights = await db
          .select({ title: xauusdBrainTable.title, content: xauusdBrainTable.content })
          .from(xauusdBrainTable)
          .where(eq(xauusdBrainTable.isActive, true))
          .orderBy(desc(xauusdBrainTable.confidence))
          .limit(5);

        const lastPred = await db
          .select()
          .from(xauusdPredictionsTable)
          .orderBy(desc(xauusdPredictionsTable.predictedAt))
          .limit(1);

        contextData = `
=== DATA LIVE XAUUSD ===
Harga Saat Ini: $${ind.price}
RSI14: ${ind.rsi14} (${ind.rsiSignal})
EMA9/21/50/200: $${ind.ema9} / $${ind.ema21} / $${ind.ema50} / $${ind.ema200}
MACD: ${ind.macdLine} | Signal: ${ind.macdSignal} | Hist: ${ind.macdHistogram} (${ind.macdSignalType})
Bollinger: Upper=$${ind.bbUpper} | Mid=$${ind.bbMiddle} | Lower=$${ind.bbLower} | Width=${ind.bbWidth}%
ATR14: ${ind.atr14}
Trend: ${ind.trend} | EMA Alignment: ${ind.emaAlignment}
Support: $${ind.supportLevel} | Resistance: $${ind.resistanceLevel}
${lastPred[0] ? `\n=== PREDIKSI TERAKHIR AI ===\nArah: ${lastPred[0].direction} | Confidence: ${((lastPred[0].confidence ?? 0) * 100).toFixed(0)}% | Status: ${lastPred[0].status}` : ""}
${topInsights.length > 0 ? `\n=== PENGETAHUAN AI (Top Insights) ===\n${topInsights.map((i) => `• ${i.title}`).join("\n")}` : ""}`;
      }
    } catch {
      // context injection optional
    }

    const reply = await chatWithAgent("xauusd", sessionId, message, contextData);
    return res.json(reply);
  } catch (err) {
    console.error("[XAUUSD] /chat error:", err);
    return res.status(500).json({ error: String(err) });
  }
});
