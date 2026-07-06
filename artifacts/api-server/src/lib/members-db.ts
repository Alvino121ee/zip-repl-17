/**
 * Members DB — CRUD untuk tabel members (registrasi email+password).
 */
import { db } from "@workspace/db";
import { membersTable } from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

export type Member = typeof membersTable.$inferSelect;

// ─── Lookups ──────────────────────────────────────────────────────────────────

export async function findMemberByEmail(email: string): Promise<Member | null> {
  const rows = await db.select().from(membersTable).where(eq(membersTable.email, email.toLowerCase()));
  return rows[0] ?? null;
}

export async function findMemberBySessionToken(token: string): Promise<Member | null> {
  if (!token) return null;
  const rows = await db.select().from(membersTable).where(eq(membersTable.sessionToken, token));
  const member = rows[0];
  if (!member) return null;
  // Cek expiry
  if (member.sessionExpiry && member.sessionExpiry < new Date()) {
    await clearSessionToken(member.id);
    return null;
  }
  return member;
}

// ─── Create / update ──────────────────────────────────────────────────────────

export async function createMember(email: string, passwordHash: string): Promise<Member> {
  const rows = await db
    .insert(membersTable)
    .values({ email: email.toLowerCase(), passwordHash })
    .returning();
  return rows[0];
}

/** Set kode verifikasi 6 digit (berlaku 15 menit) */
export async function setVerificationCode(memberId: number, code: string): Promise<void> {
  const expiry = new Date(Date.now() + 15 * 60_000);
  await db
    .update(membersTable)
    .set({ verificationCode: code, verificationExpiry: expiry, updatedAt: new Date() })
    .where(eq(membersTable.id, memberId));
}

/** Tandai email terverifikasi dan hapus kode */
export async function markEmailVerified(memberId: number): Promise<void> {
  await db
    .update(membersTable)
    .set({ emailVerified: true, verificationCode: null, verificationExpiry: null, updatedAt: new Date() })
    .where(eq(membersTable.id, memberId));
}

/** Buat session token baru (30 hari) — kembalikan token-nya */
export async function createSessionToken(memberId: number): Promise<string> {
  const token = randomBytes(32).toString("hex");
  const expiry = new Date(Date.now() + 30 * 24 * 60 * 60_000);
  await db
    .update(membersTable)
    .set({ sessionToken: token, sessionExpiry: expiry, updatedAt: new Date() })
    .where(eq(membersTable.id, memberId));
  return token;
}

export async function clearSessionToken(memberId: number): Promise<void> {
  await db
    .update(membersTable)
    .set({ sessionToken: null, sessionExpiry: null, updatedAt: new Date() })
    .where(eq(membersTable.id, memberId));
}

/** Generate kode 6 digit */
export function generateVerificationCode(): string {
  return String(Math.floor(100_000 + Math.random() * 900_000));
}

// ─── Admin ────────────────────────────────────────────────────────────────────

export async function getAllMembers(): Promise<
  { id: number; email: string; emailVerified: boolean; createdAt: Date }[]
> {
  const rows = await db
    .select({
      id: membersTable.id,
      email: membersTable.email,
      emailVerified: membersTable.emailVerified,
      createdAt: membersTable.createdAt,
    })
    .from(membersTable)
    .orderBy(membersTable.createdAt);
  return rows;
}

export async function deleteMember(memberId: number): Promise<void> {
  await db.delete(membersTable).where(eq(membersTable.id, memberId));
}
