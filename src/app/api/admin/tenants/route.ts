import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { tenants, apiKeys } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        budgetUsd: tenants.budgetUsd,
        isActive: tenants.isActive,
        createdAt: tenants.createdAt,
        keyCount: sql<number>`count(${apiKeys.id})`.mapWith(Number),
      })
      .from(tenants)
      .leftJoin(apiKeys, eq(tenants.id, apiKeys.tenantId))
      .groupBy(tenants.id)
      .orderBy(tenants.createdAt);

    return NextResponse.json(res);
  } catch (error) {
    console.error("Failed to fetch tenants:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, budgetUsd } = body;

    if (!name || !budgetUsd) {
      return NextResponse.json({ error: "Missing name or budgetUsd" }, { status: 400 });
    }

    const res = await db.insert(tenants).values({
      name,
      budgetUsd: budgetUsd.toString(),
    }).returning();

    return NextResponse.json(res[0]);
  } catch (error) {
    console.error("Failed to create tenant:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id, budgetUsd, isActive } = body;

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const updates: any = {};
    if (budgetUsd !== undefined) updates.budgetUsd = budgetUsd.toString();
    if (isActive !== undefined) updates.isActive = isActive;

    const res = await db.update(tenants)
      .set(updates)
      .where(eq(tenants.id, id))
      .returning();

    return NextResponse.json(res[0]);
  } catch (error) {
    console.error("Failed to update tenant:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    await db.delete(tenants).where(eq(tenants.id, id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to delete tenant:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
