import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usageLogs } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await db
      .select({
        totalRequests: sql<number>`count(*)`.mapWith(Number),
        totalCost: sql<number>`COALESCE(sum(${usageLogs.costUsd}), 0)`.mapWith(Number),
        cacheHits: sql<number>`sum(case when ${usageLogs.cacheHit} then 1 else 0 end)`.mapWith(Number),
        failovers: sql<number>`sum(case when ${usageLogs.failoverUsed} then 1 else 0 end)`.mapWith(Number),
      })
      .from(usageLogs)
      .where(sql`${usageLogs.createdAt} > NOW() - INTERVAL '24 hours'`);

    const stats = res[0];
    const cacheHitRate = stats.totalRequests > 0 ? (stats.cacheHits / stats.totalRequests) * 100 : 0;
    const failoverRate = stats.totalRequests > 0 ? (stats.failovers / stats.totalRequests) * 100 : 0;

    return NextResponse.json({
      totalRequests: stats.totalRequests,
      totalCost: stats.totalCost,
      cacheHitRate: Number(cacheHitRate.toFixed(2)),
      failoverRate: Number(failoverRate.toFixed(2)),
    });
  } catch (error) {
    console.error("Failed to fetch stats:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
