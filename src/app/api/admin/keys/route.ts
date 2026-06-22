import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { apiKeys, tenants } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import crypto from "crypto";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await db
      .select({
        id: apiKeys.id,
        tenantId: apiKeys.tenantId,
        tenantName: tenants.name,
        description: apiKeys.description,
        keyHash: apiKeys.keyHash,
        isActive: apiKeys.isActive,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .leftJoin(tenants, eq(apiKeys.tenantId, tenants.id))
      .orderBy(apiKeys.createdAt);

    return NextResponse.json(res);
  } catch (error) {
    console.error("Failed to fetch keys:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { tenantId, description } = body;

    if (!tenantId || !description) {
      return NextResponse.json({ error: "Missing tenantId or description" }, { status: 400 });
    }

    // Generate a raw key
    const rawKey = `ag_${crypto.randomBytes(32).toString("hex")}`;
    const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");

    const res = await db.insert(apiKeys).values({
      tenantId,
      description,
      keyHash,
    }).returning();

    // Return the raw key ONCE
    return NextResponse.json({ ...res[0], rawKey });
  } catch (error) {
    console.error("Failed to create key:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const { id } = body;

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const res = await db.update(apiKeys)
      .set({ isActive: false })
      .where(eq(apiKeys.id, id))
      .returning();

    return NextResponse.json(res[0]);
  } catch (error) {
    console.error("Failed to revoke key:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
