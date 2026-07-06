/**
 * Payments CRUD — tabel payments + update member plan
 */
import { db } from "@workspace/db";
import { paymentsTable, membersTable } from "@workspace/db/schema";
import { eq, desc } from "drizzle-orm";

export type Payment = typeof paymentsTable.$inferSelect;

export async function createPayment(data: {
  memberId:  number;
  orderId:   string;
  amount:    number;
  planSlug:  string;
  planName:  string;
  qrString?: string;
  paymentUrl?:string;
  expiresAt?: Date;
}): Promise<Payment> {
  const rows = await db.insert(paymentsTable).values({
    memberId:   data.memberId,
    orderId:    data.orderId,
    amount:     data.amount,
    planSlug:   data.planSlug,
    planName:   data.planName,
    status:     "pending",
    qrString:   data.qrString,
    paymentUrl: data.paymentUrl,
    expiresAt:  data.expiresAt ?? new Date(Date.now() + 24 * 3600_000),
  }).returning();
  return rows[0];
}

export async function getPaymentByOrderId(orderId: string): Promise<Payment | null> {
  const rows = await db.select().from(paymentsTable).where(eq(paymentsTable.orderId, orderId));
  return rows[0] ?? null;
}

export async function getPaymentsByMember(memberId: number): Promise<Payment[]> {
  return db.select().from(paymentsTable)
    .where(eq(paymentsTable.memberId, memberId))
    .orderBy(desc(paymentsTable.createdAt));
}

export async function getAllPayments(): Promise<Payment[]> {
  return db.select().from(paymentsTable).orderBy(desc(paymentsTable.createdAt)).limit(200);
}

export async function completePayment(
  orderId: string,
  paymentMethod: string,
  completedAt: Date = new Date()
): Promise<Payment | null> {
  const rows = await db.update(paymentsTable)
    .set({ status: "completed", paymentMethod, completedAt })
    .where(eq(paymentsTable.orderId, orderId))
    .returning();
  return rows[0] ?? null;
}

export async function expirePayment(orderId: string): Promise<void> {
  await db.update(paymentsTable)
    .set({ status: "expired" })
    .where(eq(paymentsTable.orderId, orderId));
}

/** Setelah pembayaran berhasil — upgrade plan member di tabel members */
export async function grantMemberPlan(
  memberId: number,
  planSlug: string,
  planName: string,
  durationDays: number
): Promise<void> {
  // Cek apakah sudah punya plan aktif — jika ya, extend dari masa berlaku sekarang
  const rows = await db.select({ planExpiresAt: membersTable.planExpiresAt })
    .from(membersTable).where(eq(membersTable.id, memberId));
  const existing = rows[0];
  const now = new Date();
  const base = (existing?.planExpiresAt && existing.planExpiresAt > now)
    ? existing.planExpiresAt : now;
  const expiresAt = new Date(base.getTime() + durationDays * 24 * 3600_000);

  await db.update(membersTable)
    .set({ plan: planSlug, planName, planExpiresAt: expiresAt, updatedAt: now })
    .where(eq(membersTable.id, memberId));
}

/** Set plan member secara manual (admin) */
export async function setMemberPlanManual(
  memberId: number,
  planSlug: string,
  planName: string,
  expiresAt: Date
): Promise<void> {
  await db.update(membersTable)
    .set({ plan: planSlug, planName, planExpiresAt: expiresAt, updatedAt: new Date() })
    .where(eq(membersTable.id, memberId));
}
