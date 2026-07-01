import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const agentConfigsTable = pgTable("agent_configs", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull().unique(), // "fundamental" | "technical" | "screening"
  name: text("name").notNull(),
  description: text("description").notNull(),
  avatar: text("avatar").notNull().default("🤖"),
  color: text("color").notNull().default("#14b8a6"),
  systemPrompt: text("system_prompt").notNull(),
  trainingExamples: text("training_examples").notNull().default("[]"), // JSON array of {input, output}
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const agentMemoriesTable = pgTable("agent_memories", {
  id: serial("id").primaryKey(),
  agentId: text("agent_id").notNull(),
  sessionId: text("session_id").notNull(),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentConfig = typeof agentConfigsTable.$inferSelect;
export type AgentMemory = typeof agentMemoriesTable.$inferSelect;
