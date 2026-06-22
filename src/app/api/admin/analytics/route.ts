import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usageLogs } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const timeFilter = sql`${usageLogs.createdAt} > NOW() - INTERVAL '24 hours'`;

    const byProviderRes = await db
      .select({
        provider: usageLogs.provider,
        requests: sql<number>`count(*)`.mapWith(Number),
        totalCost: sql<number>`COALESCE(sum(${usageLogs.costUsd}), 0)`.mapWith(Number),
        avgLatency: sql<number>`avg(${usageLogs.latencyMs})`.mapWith(Number),
        successRate: sql<number>`sum(case when ${usageLogs.status} = 'SUCCESS' then 1 else 0 end)::float / count(*) * 100`.mapWith(Number),
      })
      .from(usageLogs)
      .where(timeFilter)
      .groupBy(usageLogs.provider);

    const byModelRes = await db
      .select({
        model: usageLogs.model,
        requests: sql<number>`count(*)`.mapWith(Number),
        totalCost: sql<number>`COALESCE(sum(${usageLogs.costUsd}), 0)`.mapWith(Number),
        avgLatency: sql<number>`avg(${usageLogs.latencyMs})`.mapWith(Number),
        successRate: sql<number>`sum(case when ${usageLogs.status} = 'SUCCESS' then 1 else 0 end)::float / count(*) * 100`.mapWith(Number),
      })
      .from(usageLogs)
      .where(timeFilter)
      .groupBy(usageLogs.model);

    const byQueryTypeRes = await db
      .select({
        queryType: sql<string>`COALESCE(${usageLogs.queryType}, 'unknown')`,
        requests: sql<number>`count(*)`.mapWith(Number),
        totalCost: sql<number>`COALESCE(sum(${usageLogs.costUsd}), 0)`.mapWith(Number),
        successRate: sql<number>`sum(case when ${usageLogs.status} = 'SUCCESS' then 1 else 0 end)::float / count(*) * 100`.mapWith(Number),
      })
      .from(usageLogs)
      .where(timeFilter)
      .groupBy(sql`COALESCE(${usageLogs.queryType}, 'unknown')`);

    const complexityBucketsRes = await db
      .select({
        bucket: sql<number>`width_bucket(COALESCE(${usageLogs.complexityScore}, 0), 0, 100, 10)`.mapWith(Number),
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(usageLogs)
      .where(timeFilter)
      .groupBy(sql`width_bucket(COALESCE(${usageLogs.complexityScore}, 0), 0, 100, 10)`)
      .orderBy(sql`width_bucket(COALESCE(${usageLogs.complexityScore}, 0), 0, 100, 10) ASC`);

    // Format complexity buckets to labels (e.g., "0-9", "10-19", etc.)
    const complexityBuckets = Array.from({ length: 11 }, (_, i) => {
      const bucketIdx = i + 1;
      const found = complexityBucketsRes.find(b => b.bucket === bucketIdx);
      const label = i === 10 ? "100+" : `${i * 10}-${i * 10 + 9}`;
      return { bucket: label, count: found ? found.count : 0 };
    });

    const routingReasonsRes = await db
      .select({
        reason: sql<string>`COALESCE(${usageLogs.routingReason}, 'unknown')`,
        count: sql<number>`count(*)`.mapWith(Number),
      })
      .from(usageLogs)
      .where(timeFilter)
      .groupBy(sql`COALESCE(${usageLogs.routingReason}, 'unknown')`);

    return NextResponse.json({
      byProvider: byProviderRes,
      byModel: byModelRes,
      byQueryType: byQueryTypeRes,
      complexityBuckets,
      routingReasons: routingReasonsRes,
    });
  } catch (error) {
    console.error("Failed to fetch analytics:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
