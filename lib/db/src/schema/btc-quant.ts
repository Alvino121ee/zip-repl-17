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

// ─── BTC Technical Brain — price action, RSI, EMA, BB, Volume, Funding Rate ───
export const btcQuantTechnicalBrainTable = pgTable("btc_quant_technical_brain", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'pattern'|'rule'|'lesson'|'setup'|'funding_signal'
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

// ─── BTC Fundamental Brain — Halving, Fear & Greed, Exchange flows, ETF ───────
export const btcQuantFundamentalBrainTable = pgTable("btc_quant_fundamental_brain", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'halving_cycle'|'etf_flow'|'exchange_flow'|'sentiment'|'lesson'
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

// ─── BTC Macro Brain — Risk regime, DXY, Nasdaq, ETH corr, Liquidity ──────────
export const btcQuantMacroBrainTable = pgTable("btc_quant_macro_brain", {
  id: serial("id").primaryKey(),
  category: text("category").notNull(), // 'risk_regime'|'nasdaq_corr'|'dxy_impact'|'eth_corr'|'liquidity'|'lesson'
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

// ─── BTC Quant Bot Predictions — ensemble signal (scalping TP/SL max $1000) ───
export const btcQuantBotPredictionsTable = pgTable("btc_quant_bot_predictions", {
  id: serial("id").primaryKey(),
  predictedAt: timestamp("predicted_at").notNull().defaultNow(),
  timeframe: text("timeframe").notNull().default("5m"), // '1m'|'5m'|'15m'|'1h'
  direction: text("direction").notNull(), // 'up'|'down'
  signal: text("signal").notNull(), // 'BUY'|'SELL'
  confidence: real("confidence").notNull(),
  entryPrice: real("entry_price").notNull(),
  tp: real("tp").notNull(),   // max $1000 from entry — scalping constraint
  sl: real("sl").notNull(),   // max $1000 from entry — scalping constraint
  tpDistance: real("tp_distance").notNull(), // distance in USD from entry
  slDistance: real("sl_distance").notNull(), // distance in USD from entry
  riskReward: real("risk_reward"),
  // Per-brain signals
  technicalSignal: text("technical_signal"),
  technicalConfidence: real("technical_confidence"),
  technicalReasoning: text("technical_reasoning"),
  fundamentalSignal: text("fundamental_signal"),
  fundamentalConfidence: real("fundamental_confidence"),
  fundamentalReasoning: text("fundamental_reasoning"),
  macroSignal: text("macro_signal"),
  macroConfidence: real("macro_confidence"),
  macroReasoning: text("macro_reasoning"),
  // Context
  regime: text("regime"),
  session: text("session"),
  fearGreedIndex: integer("fear_greed_index"),
  fundingRate: real("funding_rate"),
  halvingPhase: text("halving_phase"),
  psychologyScore: real("psychology_score"),
  // Outcome tracking
  isVerified: boolean("is_verified").notNull().default(false),
  isCorrect: boolean("is_correct"),
  actualPrice: real("actual_price"),
  verifiedAt: timestamp("verified_at"),
});

// ─── BTC Per-brain standalone predictions — fixed $500 distance for fair comparison
export const btcQuantBrainPredictionsTable = pgTable("btc_quant_brain_predictions", {
  id: serial("id").primaryKey(),
  brainType: text("brain_type").notNull(), // 'technical'|'fundamental'|'macro'
  predictedAt: timestamp("predicted_at").notNull().defaultNow(),
  direction: text("direction").notNull(), // 'up'|'down'
  signal: text("signal").notNull(), // 'BUY'|'SELL'
  confidence: real("confidence").notNull(),
  entryPrice: real("entry_price").notNull(),
  tp: real("tp").notNull(),
  sl: real("sl").notNull(),
  fixedDistance: real("fixed_distance").notNull().default(500), // $500 fixed per brain
  reasoning: text("reasoning"),
  isVerified: boolean("is_verified").notNull().default(false),
  isCorrect: boolean("is_correct"),
  actualPrice: real("actual_price"),
  verifiedAt: timestamp("verified_at"),
});

// ─── BTC Quant Learning Log ───────────────────────────────────────────────────
export const btcQuantLearningLogTable = pgTable("btc_quant_learning_log", {
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
