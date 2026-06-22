import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usageLogs, tenants } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await db
      .select({
        id: usageLogs.requestId,
        time: usageLogs.createdAt,
        tenantName: tenants.name,
        provider: usageLogs.provider,
        model: usageLogs.model,
        queryType: usageLogs.queryType,
        promptTokens: usageLogs.promptTokens,
        completionTokens: usageLogs.completionTokens,
        costUsd: usageLogs.costUsd,
        status: usageLogs.status,
        latencyMs: usageLogs.latencyMs,
      })
      .from(usageLogs)
      .leftJoin(tenants, eq(usageLogs.tenantId, tenants.id))
      .orderBy(desc(usageLogs.createdAt))
      .limit(20);

    return NextResponse.json(res);
  } catch (error) {
    console.error("Failed to fetch recent requests:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
