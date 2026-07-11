import {
  pgTable,
  serial,
  text,
  real,
  integer,
  jsonb,
  timestamp,
} from "drizzle-orm/pg-core";

// ─── XAUUSD "Dewan Emas" — 15 analis spesialis + 1 Gubernur (leader) ───────────
// Setiap siklus, 15 anggota memberi pendapat & vote (BUY/SELL/HOLD) berdasarkan
// sinyal riil dari 3 brain (Technical/Fundamental/Macro). Gubernur mensintesis
// semua pendapat dan mengambil keputusan akhir — seperti kabinet sebuah negara.
export const quantCommitteeDebatesTable = pgTable("quant_committee_debates", {
  id: serial("id").primaryKey(),
  debatedAt: timestamp("debated_at").notNull().defaultNow(),
  cycleNumber: integer("cycle_number").notNull().default(0),
  price: real("price"),
  ensembleSignal: text("ensemble_signal"), // sinyal 3-brain ensemble sebagai konteks debat
  ensembleConfidence: real("ensemble_confidence"),
  members: jsonb("members").notNull(), // [{name,role,vote,confidence,opinion}] x15
  buyVotes: integer("buy_votes").notNull().default(0),
  sellVotes: integer("sell_votes").notNull().default(0),
  holdVotes: integer("hold_votes").notNull().default(0),
  leaderName: text("leader_name").notNull(),
  leaderTitle: text("leader_title").notNull(),
  leaderDecision: text("leader_decision").notNull(), // 'BUY'|'SELL'|'HOLD'
  leaderConfidence: real("leader_confidence").notNull(),
  leaderReasoning: text("leader_reasoning"),
  durationMs: integer("duration_ms"),
});

// ─── BTC "Dewan BTC" — 15 analis spesialis + 1 Presiden (leader) ───────────────
export const btcQuantCommitteeDebatesTable = pgTable("btc_quant_committee_debates", {
  id: serial("id").primaryKey(),
  debatedAt: timestamp("debated_at").notNull().defaultNow(),
  cycleNumber: integer("cycle_number").notNull().default(0),
  price: real("price"),
  ensembleSignal: text("ensemble_signal"),
  ensembleConfidence: real("ensemble_confidence"),
  members: jsonb("members").notNull(),
  buyVotes: integer("buy_votes").notNull().default(0),
  sellVotes: integer("sell_votes").notNull().default(0),
  holdVotes: integer("hold_votes").notNull().default(0),
  leaderName: text("leader_name").notNull(),
  leaderTitle: text("leader_title").notNull(),
  leaderDecision: text("leader_decision").notNull(),
  leaderConfidence: real("leader_confidence").notNull(),
  leaderReasoning: text("leader_reasoning"),
  durationMs: integer("duration_ms"),
});
