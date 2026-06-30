import {
  pgTable,
  serial,
  text,
  numeric,
  bigint,
  timestamp,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const stocksTable = pgTable("stocks", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  name: text("name").notNull(),
  sector: text("sector").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const stockPricesTable = pgTable("stock_prices", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  date: text("date").notNull(),
  open: numeric("open", { precision: 18, scale: 2 }).notNull(),
  high: numeric("high", { precision: 18, scale: 2 }).notNull(),
  low: numeric("low", { precision: 18, scale: 2 }).notNull(),
  close: numeric("close", { precision: 18, scale: 2 }).notNull(),
  volume: bigint("volume", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const stockFundamentalsTable = pgTable("stock_fundamentals", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  pe: numeric("pe", { precision: 10, scale: 2 }),
  pb: numeric("pb", { precision: 10, scale: 2 }),
  roe: numeric("roe", { precision: 10, scale: 4 }),
  roa: numeric("roa", { precision: 10, scale: 4 }),
  eps: numeric("eps", { precision: 18, scale: 2 }),
  revenue: numeric("revenue", { precision: 24, scale: 2 }),
  netIncome: numeric("net_income", { precision: 24, scale: 2 }),
  debtEquity: numeric("debt_equity", { precision: 10, scale: 4 }),
  currentRatio: numeric("current_ratio", { precision: 10, scale: 4 }),
  dividendYield: numeric("dividend_yield", { precision: 10, scale: 4 }),
  beta: numeric("beta", { precision: 10, scale: 4 }),
  freeCashFlow: numeric("free_cash_flow", { precision: 24, scale: 2 }),
  marketCap: numeric("market_cap", { precision: 24, scale: 2 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const stockScoresTable = pgTable("stock_scores", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  currentPrice: numeric("current_price", { precision: 18, scale: 2 }).notNull(),
  priceChange: numeric("price_change", { precision: 18, scale: 2 }).notNull().default("0"),
  priceChangePct: numeric("price_change_pct", { precision: 10, scale: 4 }).notNull().default("0"),
  volume: bigint("volume", { mode: "number" }).notNull().default(0),
  avgVolume: bigint("avg_volume", { mode: "number" }),
  trendScore: numeric("trend_score", { precision: 6, scale: 2 }).notNull().default("50"),
  momentumScore: numeric("momentum_score", { precision: 6, scale: 2 }).notNull().default("50"),
  volumeScore: numeric("volume_score", { precision: 6, scale: 2 }).notNull().default("50"),
  liquidityScore: numeric("liquidity_score", { precision: 6, scale: 2 }).notNull().default("50"),
  fundamentalScore: numeric("fundamental_score", { precision: 6, scale: 2 }).notNull().default("50"),
  valuationScore: numeric("valuation_score", { precision: 6, scale: 2 }).notNull().default("50"),
  riskScore: numeric("risk_score", { precision: 6, scale: 2 }).notNull().default("50"),
  totalScore: numeric("total_score", { precision: 6, scale: 2 }).notNull().default("50"),
  label: text("label").notNull().default("Neutral"),
  ma20: numeric("ma20", { precision: 18, scale: 2 }),
  ma50: numeric("ma50", { precision: 18, scale: 2 }),
  ma200: numeric("ma200", { precision: 18, scale: 2 }),
  rsi14: numeric("rsi14", { precision: 6, scale: 2 }),
  supportLevel: numeric("support_level", { precision: 18, scale: 2 }),
  resistanceLevel: numeric("resistance_level", { precision: 18, scale: 2 }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const aiReportsTable = pgTable("ai_reports", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  summary: text("summary").notNull(),
  riskAnalysis: text("risk_analysis").notNull(),
  bullishScenario: text("bullish_scenario").notNull(),
  bearishScenario: text("bearish_scenario").notNull(),
  conclusion: text("conclusion").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  name: text("name"),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const watchlistsTable = pgTable("watchlists", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  ticker: text("ticker").notNull(),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStockSchema = createInsertSchema(stocksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertStock = z.infer<typeof insertStockSchema>;
export type Stock = typeof stocksTable.$inferSelect;

export const insertStockPriceSchema = createInsertSchema(stockPricesTable).omit({ id: true, createdAt: true });
export type InsertStockPrice = z.infer<typeof insertStockPriceSchema>;
export type StockPrice = typeof stockPricesTable.$inferSelect;

export const insertStockFundamentalsSchema = createInsertSchema(stockFundamentalsTable).omit({ id: true, updatedAt: true });
export type InsertStockFundamentals = z.infer<typeof insertStockFundamentalsSchema>;
export type StockFundamentals = typeof stockFundamentalsTable.$inferSelect;

export const insertStockScoreSchema = createInsertSchema(stockScoresTable).omit({ id: true, updatedAt: true });
export type InsertStockScore = z.infer<typeof insertStockScoreSchema>;
export type StockScore = typeof stockScoresTable.$inferSelect;

export const insertAiReportSchema = createInsertSchema(aiReportsTable).omit({ id: true, generatedAt: true });
export type InsertAiReport = z.infer<typeof insertAiReportSchema>;
export type AiReport = typeof aiReportsTable.$inferSelect;

export const insertWatchlistSchema = createInsertSchema(watchlistsTable).omit({ id: true, addedAt: true });
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type Watchlist = typeof watchlistsTable.$inferSelect;
