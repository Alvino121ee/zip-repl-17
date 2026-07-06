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
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
