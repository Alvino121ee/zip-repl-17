/**
 * VIP Plans CRUD — tabel vip_plans
 */
import { db } from "@workspace/db";
import { vipPlansTable } from "@workspace/db/schema";
import { eq, asc } from "drizzle-orm";

export type VipPlan = typeof vipPlansTable.$inferSelect;

export async function getAllPlans(): Promise<VipPlan[]> {
  return db.select().from(vipPlansTable).orderBy(asc(vipPlansTable.sortOrder), asc(vipPlansTable.id));
}

export async function getActivePlans(): Promise<VipPlan[]> {
  return db.select().from(vipPlansTable)
    .where(eq(vipPlansTable.isActive, true))
    .orderBy(asc(vipPlansTable.sortOrder), asc(vipPlansTable.id));
}

export async function getPlanBySlug(slug: string): Promise<VipPlan | null> {
  const rows = await db.select().from(vipPlansTable).where(eq(vipPlansTable.slug, slug));
  return rows[0] ?? null;
}

export async function createPlan(data: {
  slug: string;
  name: string;
  description?: string;
  price: number;
  durationDays?: number;
  features?: string[];
  sortOrder?: number;
}): Promise<VipPlan> {
  const rows = await db.insert(vipPlansTable).values({
    slug:         data.slug,
    name:         data.name,
    description:  data.description ?? "",
    price:        data.price,
    durationDays: data.durationDays ?? 30,
    features:     data.features ?? [],
    sortOrder:    data.sortOrder ?? 0,
  }).returning();
  return rows[0];
}

export async function updatePlan(id: number, data: Partial<{
  name: string;
  description: string;
  price: number;
  durationDays: number;
  features: string[];
  isActive: boolean;
  sortOrder: number;
}>): Promise<VipPlan | null> {
  const rows = await db.update(vipPlansTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(vipPlansTable.id, id))
    .returning();
  return rows[0] ?? null;
}

export async function deletePlan(id: number): Promise<void> {
  await db.delete(vipPlansTable).where(eq(vipPlansTable.id, id));
}
