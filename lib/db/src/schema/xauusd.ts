import {
  pgTable,
  serial,
  text,
  real,
  boolean,
  timestamp,
  jsonb,
  integer,
} from "drizzle-orm/pg-core";

// ─── Market snapshots — saved every cycle, especially on spikes ──────────────
export const xauusdSnapshotsTable = pgTable("xauusd_snapshots", {
  id: serial("id").primaryKey(),
  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
  price: real("price").notNull(),
  open: real("open"),
  high: real("high"),
  low: real("low"),
  volume: real("volume"),
  priceChange: real("price_change"), // % change vs previous snapshot
  isSpike: boolean("is_spike").notNull().default(false),
  // Technical indicators
  rsi14: real("rsi14"),
  ema9: real("ema9"),
  ema21: real("ema21"),
  ema50: real("ema50"),
  ema200: real("ema200"),
  macdLine: real("macd_line"),
  macdSignal: real("macd_signal"),
  macdHistogram: real("macd_histogram"),
  bbUpper: real("bb_upper"),
  bbMiddle: real("bb_middle"),
  bbLower: real("bb_lower"),
  atr14: real("atr14"),
  trend: text("trend"), // 'bullish' | 'bearish' | 'sideways'
  supportLevel: real("support_level"),
  resistanceLevel: real("resistance_level"),
  bbWidth: real("bb_width"), // BB width as % of price
  rsiSignal: text("rsi_signal"), // 'overbought'|'oversold'|'neutral'
  macdSignalType: text("macd_signal_type"), // 'bullish_cross'|'bearish_cross'|'neutral'
  emaAlignment: text("ema_alignment"), // 'bullish_stack'|'bearish_stack'|'mixed'
});

// ─── AI Brain — learned rules, patterns, insights (self-updating) ─────────────
export const xauusdBrainTable = pgTable("xauusd_brain", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'trading_rule'|'pattern'|'insight'|'lesson'|'news_impact'
  title: text("title").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence").notNull().default(0.5), // 0.0–1.0
  usageCount: integer("usage_count").notNull().default(0),
  lastValidated: timestamp("last_validated"),
  isActive: boolean("is_active").notNull().default(true),
  sourceQuestion: text("source_question"), // question that generated this
  marketConditionTags: text("market_condition_tags"), // comma-separated tags e.g. "rsi_oversold,spike_up"
  decayWeight: real("decay_weight").notNull().default(1.0), // Feature 8: Forget Curve — exponential decay by age
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Questions log — tracks every Q sent to DeepSeek (no repeats) ────────────
export const xauusdQuestionsLogTable = pgTable("xauusd_questions_log", {
  id: serial("id").primaryKey(),
  question: text("question").notNull(),
  questionHash: text("question_hash").notNull().unique(), // SHA256 for dedup
  answer: text("answer"),
  quality: real("quality"), // 0.0–1.0 scored after answer received
  savedToBrain: boolean("saved_to_brain").notNull().default(false),
  marketContext: jsonb("market_context"), // snapshot indicators when question was asked
  askedAt: timestamp("asked_at").notNull().defaultNow(),
  answeredAt: timestamp("answered_at"),
});

// ─── Predictions — AI makes directional predictions, verifies them later ──────
export const xauusdPredictionsTable = pgTable("xauusd_predictions", {
  id: serial("id").primaryKey(),
  predictedAt: timestamp("predicted_at").notNull().defaultNow(),
  timeframe: text("timeframe").notNull(), // '15m'|'30m'|'1h'|'4h'|'24h'
  direction: text("direction").notNull(), // 'up'|'down'|'sideways'
  targetPrice: real("target_price"), // TP1 — target terdekat (struktur S/R pertama)
  tp2: real("tp2"),                 // TP2 — target lanjutan jika momentum sehat
  tp3: real("tp3"),                 // TP3 — target jauh jika trend kuat + volume mendukung
  entryLow: real("entry_low"), // bottom of suggested entry range
  entryHigh: real("entry_high"), // top of suggested entry range
  stopLoss: real("stop_loss"),  // di bawah swing low (long) / di atas swing high (short) = invalidasi thesis
  confidence: real("confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  priceAtPrediction: real("price_at_prediction").notNull(),
  indicatorsAtPrediction: jsonb("indicators_at_prediction"),
  // Feature 4: Session-Aware — trading session at prediction time
  tradingSession: text("trading_session"), // 'asia'|'london'|'new_york'|'overlap_london_ny'
  // Feature 5: Market Regime Detector
  marketRegime: text("market_regime"), // 'trending_up'|'trending_down'|'ranging'|'volatile'
  // Feature 7: Prediction Clustering
  clusterLabel: text("cluster_label"), // e.g. "RSI_OS+EMA_Bull+T_Up+MACD_B"
  // Feature 9: Probability Distribution
  priceP10: real("price_p10"), // 10th percentile price target (pessimistic)
  priceP50: real("price_p50"), // median price target
  priceP90: real("price_p90"), // 90th percentile price target (optimistic)
  // Tipe prediksi — 'training' (setiap siklus, untuk latih AI) | 'main' (hanya saat arah berubah, ditampilkan ke user)
  predictionType: text("prediction_type").notNull().default("training"),
  // Actual outcome (filled later)
  verifyAt: timestamp("verify_at"), // when to check the outcome
  actualPrice: real("actual_price"),
  actualDirection: text("actual_direction"),
  isCorrect: boolean("is_correct"),
  priceDiff: real("price_diff"),
  revisedAt: timestamp("revised_at"),
  revisionNote: text("revision_note"), // AI's self-critique
  status: text("status").notNull().default("pending"), // 'pending'|'verified'|'revised'|'expired'
});

// ─── XAUUSD News ──────────────────────────────────────────────────────────────
export const xauusdNewsTable = pgTable("xauusd_news", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  summary: text("summary"),
  url: text("url"),
  source: text("source"),
  publishedAt: timestamp("published_at"),
  sentiment: text("sentiment"), // 'bullish'|'bearish'|'neutral'
  aiAnalysis: text("ai_analysis"),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
});

// ─── Macro snapshots — DXY & US10Y saved every cycle for Pearson correlation ──
export const xauusdMacroSnapshotsTable = pgTable("xauusd_macro_snapshots", {
  id: serial("id").primaryKey(),
  snapshotAt: timestamp("snapshot_at").notNull().defaultNow(),
  goldPrice: real("gold_price").notNull(),
  goldChangePct: real("gold_change_pct"),
  dxy: real("dxy"),
  dxyChangePct: real("dxy_change_pct"),
  us10y: real("us10y"),
  us10yChangePct: real("us10y_change_pct"),
});

// ─── App settings — key/value store, editable from the website (e.g. DeepSeek API key) ──
export const xauusdSettingsTable = pgTable("xauusd_settings", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(), // e.g. 'deepseek_api_key', 'prediction_timeframe_minutes'
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Learning log — one row per autonomous learning cycle ─────────────────────
export const xauusdLearningLogTable = pgTable("xauusd_learning_log", {
  id: serial("id").primaryKey(),
  cycleAt: timestamp("cycle_at").notNull().defaultNow(),
  priceAtCycle: real("price_at_cycle"),
  questionsAsked: integer("questions_asked").notNull().default(0),
  insightsSaved: integer("insights_saved").notNull().default(0),
  predictionsChecked: integer("predictions_checked").notNull().default(0),
  wrongPredictions: integer("wrong_predictions").notNull().default(0),
  spikeDetected: boolean("spike_detected").notNull().default(false),
  summary: text("summary"),
  durationMs: integer("duration_ms"),
});
