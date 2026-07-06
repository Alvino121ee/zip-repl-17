import {
  pgTable, serial, text, integer, boolean, timestamp, jsonb
} from "drizzle-orm/pg-core";

// ─── VIP Plans — dikonfigurasi dari admin panel ───────────────────────────────
export const vipPlansTable = pgTable("vip_plans", {
  id:           serial("id").primaryKey(),
  slug:         text("slug").notNull().unique(),          // e.g. "vip_basic"
  name:         text("name").notNull(),                   // e.g. "VIP Basic"
  description:  text("description").notNull().default(""),
  price:        integer("price").notNull(),               // Rupiah, e.g. 99000
  durationDays: integer("duration_days").notNull().default(30),
  features:     jsonb("features").notNull().default([]),  // string[]
  isActive:     boolean("is_active").notNull().default(true),
  sortOrder:    integer("sort_order").notNull().default(0),
  createdAt:    timestamp("created_at").notNull().defaultNow(),
  updatedAt:    timestamp("updated_at").notNull().defaultNow(),
});

// ─── Payments — riwayat transaksi Pakasir ────────────────────────────────────
export const paymentsTable = pgTable("payments", {
  id:            serial("id").primaryKey(),
  memberId:      integer("member_id").notNull(),
  orderId:       text("order_id").notNull().unique(),     // GR_{timestamp}_{memberId}
  amount:        integer("amount").notNull(),             // Rupiah
  planSlug:      text("plan_slug").notNull(),
  planName:      text("plan_name").notNull(),
  status:        text("status").notNull().default("pending"), // pending|completed|expired
  paymentMethod: text("payment_method"),                 // qris|bni_va|...
  qrString:      text("qr_string"),                      // QRIS string dari Pakasir
  paymentUrl:    text("payment_url"),                    // URL pembayaran Pakasir
  createdAt:     timestamp("created_at").notNull().defaultNow(),
  completedAt:   timestamp("completed_at"),
  expiresAt:     timestamp("expires_at"),
});

export type VipPlan  = typeof vipPlansTable.$inferSelect;
export type Payment  = typeof paymentsTable.$inferSelect;
