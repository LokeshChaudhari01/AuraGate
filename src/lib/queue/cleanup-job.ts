import "dotenv/config";
import { pool } from "@/lib/db";
import { telemetryQueue } from "./telemetry-queue";

export async function scheduleCleanupJob() {
  await telemetryQueue.add(
    "cleanup",
    // @ts-ignore - Dummy data for cleanup job
    {},
    {
      repeat: { pattern: "0 3 * * *" }, // 3 AM daily
      jobId: "processed-jobs-cleanup",
    }
  );
}

export async function processCleanupJob() {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `DELETE FROM processed_jobs WHERE processed_at < NOW() - INTERVAL '7 days'`
    );
    console.log(`🧹 [Cleanup] Removed ${res.rowCount} old processed_jobs rows.`);
  } catch (error) {
    console.error("🔴 [Cleanup] Failed to clean processed_jobs:", error);
  } finally {
    client.release();
  }
}
