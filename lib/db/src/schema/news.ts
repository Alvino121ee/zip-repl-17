import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const newsArticlesTable = pgTable("news_articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  link: text("link").notNull().unique(),
  summary: text("summary"),
  source: text("source").notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
  tickers: text("tickers").array().default([]),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const aiInsightsTable = pgTable("ai_insights", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull().unique(),
  insight: text("insight").notNull(),
  recommendation: text("recommendation").notNull(),
  confidence: integer("confidence").notNull().default(50),
  reasoning: text("reasoning").notNull(),
  bullish: text("bullish"),
  bearish: text("bearish"),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNewsArticleSchema = createInsertSchema(newsArticlesTable).omit({ id: true, fetchedAt: true });
export type InsertNewsArticle = z.infer<typeof insertNewsArticleSchema>;
export type NewsArticle = typeof newsArticlesTable.$inferSelect;

export const insertAiInsightSchema = createInsertSchema(aiInsightsTable).omit({ id: true, generatedAt: true });
export type InsertAiInsight = z.infer<typeof insertAiInsightSchema>;
export type AiInsight = typeof aiInsightsTable.$inferSelect;
