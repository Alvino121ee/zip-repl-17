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

// ─── Technical Brain — learns from price action & indicator patterns ──────────
export const quantTechnicalBrainTable = pgTable("quant_technical_brain", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'pattern'|'rule'|'lesson'|'setup'
  title: text("title").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  usageCount: integer("usage_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sourceQuestion: text("source_question"),
  marketConditionTags: text("market_condition_tags"),
  decayWeight: real("decay_weight").notNull().default(1.0),
  outcomeVerified: boolean("outcome_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Fundamental Brain — learns from macro-economic & sentiment drivers ───────
export const quantFundamentalBrainTable = pgTable("quant_fundamental_brain", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'rate_impact'|'cot_signal'|'demand_supply'|'lesson'
  title: text("title").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  usageCount: integer("usage_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sourceQuestion: text("source_question"),
  marketConditionTags: text("market_condition_tags"),
  decayWeight: real("decay_weight").notNull().default(1.0),
  outcomeVerified: boolean("outcome_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Macro Brain — learns from DXY, US10Y, geopolitics, risk sentiment ────────
export const quantMacroBrainTable = pgTable("quant_macro_brain", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'dxy_correlation'|'yield_impact'|'risk_sentiment'|'geopolitics'|'lesson'
  title: text("title").notNull(),
  content: text("content").notNull(),
  confidence: real("confidence").notNull().default(0.5),
  usageCount: integer("usage_count").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  sourceQuestion: text("source_question"),
  marketConditionTags: text("market_condition_tags"),
  decayWeight: real("decay_weight").notNull().default(1.0),
  outcomeVerified: boolean("outcome_verified").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ─── Quant Bot Predictions — combined 3-brain ensemble signal ─────────────────
export const quantBotPredictionsTable = pgTable("quant_bot_predictions", {
  id: serial("id").primaryKey(),
  predictedAt: timestamp("predicted_at").notNull().defaultNow(),
  timeframe: text("timeframe").notNull(), // '15m'|'1h'|'4h'
  direction: text("direction").notNull(), // 'up'|'down'
  signal: text("signal").notNull(), // 'BUY'|'SELL'
  confidence: real("confidence").notNull(), // 0-1 ensemble confidence
  entryPrice: real("entry_price"),
  tp1: real("tp1"),
  tp2: real("tp2"),
  sl: real("sl"),
  lotSize: real("lot_size"), // calculated from capital + risk%
  riskAmount: real("risk_amount"), // in USD
  // Per-brain signals
  technicalSignal: text("technical_signal"), // 'BUY'|'SELL'|'HOLD'
  technicalConfidence: real("technical_confidence"),
  technicalReasoning: text("technical_reasoning"),
  fundamentalSignal: text("fundamental_signal"),
  fundamentalConfidence: real("fundamental_confidence"),
  fundamentalReasoning: text("fundamental_reasoning"),
  macroSignal: text("macro_signal"),
  macroConfidence: real("macro_confidence"),
  macroReasoning: text("macro_reasoning"),
  // Psychology & context
  marketPsychology: text("market_psychology"), // rich narrative text
  psychologyScore: real("psychology_score"), // -1 (extreme fear) to +1 (extreme greed)
  regime: text("regime"), // 'trending_bull'|'trending_bear'|'ranging'|'volatile'
  session: text("session"), // 'london'|'ny'|'asia'|'overlap'
  // Outcome tracking
  isVerified: boolean("is_verified").notNull().default(false),
  isCorrect: boolean("is_correct"),
  actualPrice: real("actual_price"),
  verifiedAt: timestamp("verified_at"),
  revisionNote: text("revision_note"),
  // Capital state at time of prediction
  capitalSnapshot: jsonb("capital_snapshot"),
});

// ─── Market Psychology Log — rich AI-written psychology snapshots ─────────────
export const quantPsychologyLogTable = pgTable("quant_psychology_log", {
  id: serial("id").primaryKey(),
  loggedAt: timestamp("logged_at").notNull().defaultNow(),
  price: real("price"),
  psychologyScore: real("psychology_score"), // -1 to +1
  regime: text("regime"),
  session: text("session"),
  fearGreedSignal: text("fear_greed_signal"), // 'extreme_fear'|'fear'|'neutral'|'greed'|'extreme_greed'
  // AI-written narrative
  overallNarrative: text("overall_narrative"), // full psychology paragraph
  keyEmotions: text("key_emotions"), // comma-separated: 'FOMO','panic','greed','hope'
  crowdBehavior: text("crowd_behavior"), // what retail traders are likely doing
  institutionalBias: text("institutional_bias"), // what smart money likely doing
  tradingImplication: text("trading_implication"), // actionable insight
  // Raw indicator inputs
  rsi14: real("rsi14"),
  dxyLevel: real("dxy_level"),
  vixProxy: real("vix_proxy"), // ATR as volatility proxy
  bullBearRatio: real("bull_bear_ratio"),
});

// ─── Quant News Cache — fast news with AI sentiment scoring ───────────────────
export const quantNewsCacheTable = pgTable("quant_news_cache", {
  id: serial("id").primaryKey(),
  fetchedAt: timestamp("fetched_at").notNull().defaultNow(),
  publishedAt: timestamp("published_at"),
  source: text("source").notNull(), // 'finnhub'|'benzinga'|'polygon'|'scraped'
  headline: text("headline").notNull(),
  summary: text("summary"),
  url: text("url"),
  symbols: text("symbols"), // 'XAUUSD,DXY,..''
  sentiment: text("sentiment"), // 'very_bullish'|'bullish'|'neutral'|'bearish'|'very_bearish'
  sentimentScore: real("sentiment_score"), // -1 to +1
  impactLevel: text("impact_level"), // 'high'|'medium'|'low'
  aiAnalysis: text("ai_analysis"), // DeepSeek 1-sentence analysis
  isHighImpact: boolean("is_high_impact").notNull().default(false),
});

// ─── Quant Learning Log — per-cycle audit trail ───────────────────────────────
export const quantLearningLogTable = pgTable("quant_learning_log", {
  id: serial("id").primaryKey(),
  cycleAt: timestamp("cycle_at").notNull().defaultNow(),
  brainType: text("brain_type").notNull(), // 'technical'|'fundamental'|'macro'|'orchestrator'
  cycleNumber: integer("cycle_number").notNull().default(0),
  questionsAsked: integer("questions_asked").notNull().default(0),
  insightsSaved: integer("insights_saved").notNull().default(0),
  predictionsChecked: integer("predictions_checked").notNull().default(0),
  wrongPredictions: integer("wrong_predictions").notNull().default(0),
  currentPrice: real("current_price"),
  durationMs: integer("duration_ms"),
  notes: text("notes"),
});
