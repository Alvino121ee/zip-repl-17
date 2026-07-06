import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";

export const membersTable = pgTable("members", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerified: boolean("email_verified").notNull().default(false),
  verificationCode: text("verification_code"),
  verificationExpiry: timestamp("verification_expiry"),
  sessionToken: text("session_token"),
  sessionExpiry: timestamp("session_expiry"),
  // ── VIP Plan ──
  plan:          text("plan").notNull().default("free"),  // "free" | plan slug
  planName:      text("plan_name"),                       // display name e.g. "VIP Basic"
  planExpiresAt: timestamp("plan_expires_at"),            // null = tidak pernah expire (free)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
