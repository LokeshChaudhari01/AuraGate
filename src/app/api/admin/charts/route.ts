import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usageLogs } from "@/lib/db/schema";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const res = await db
      .select({
        hour: sql<string>`date_trunc('hour', ${usageLogs.createdAt})`,
        count: sql<number>`count(*)`.mapWith(Number),
        avgLatency: sql<number>`avg(${usageLogs.latencyMs})`.mapWith(Number),
      })
      .from(usageLogs)
      .where(sql`${usageLogs.createdAt} > NOW() - INTERVAL '24 hours'`)
      .groupBy(sql`date_trunc('hour', ${usageLogs.createdAt})`)
      .orderBy(sql`date_trunc('hour', ${usageLogs.createdAt}) ASC`);

    const requestVolume = res.map((r) => ({ hour: new Date(r.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), count: r.count }));
    const latency = res.map((r) => ({ hour: new Date(r.hour).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), avgMs: Math.round(r.avgLatency) }));

    return NextResponse.json({ requestVolume, latency });
  } catch (error) {
    console.error("Failed to fetch charts data:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
