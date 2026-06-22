import { Worker, type Job } from "bullmq";
import "dotenv/config";
import { pool } from "@/lib/db";
import { calculateCost } from "./cost-calculator";
import { invalidateKeyCache } from "@/lib/redis/key-cache";
import { TELEMETRY_QUEUE_NAME, type TelemetryJobData } from "./telemetry-queue";

function getRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null,
  };
}

export const telemetryWorker = new Worker<TelemetryJobData>(
  TELEMETRY_QUEUE_NAME,
  async (job: Job<TelemetryJobData>) => {
    const data = job.data;
    
    // Cost calculation (exact tokens only)
    let costUsd = "0.0000";
    if (data.status === "SUCCESS" && !data.cacheHit) {
      costUsd = calculateCost(data.model, data.promptTokens, data.completionTokens);
    }

    const client = await pool.connect();
    
    try {
      await client.query("BEGIN");
      
      // 1. Idempotency Gate
      try {
        await client.query(
          `INSERT INTO processed_jobs (request_id) VALUES ($1)`,
          [data.requestId]
        );
      } catch (err: any) {
        if (err.code === "23505") {
          // Unique violation: job already processed
          await client.query("ROLLBACK");
          console.log(`⏭️  [Worker] Job ${job.id} already processed (requestId: ${data.requestId}). Skipping.`);
          return;
        }
        throw err;
      }
      
      // 2. Insert into usage_logs
      await client.query(
        `INSERT INTO usage_logs (
          request_id, tenant_id, provider, model, latency_ms, 
          prompt_tokens, completion_tokens, cost_usd, cache_hit, 
          failover_used, provider_status_code, status, routing_reason,
          query_type, complexity_score
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [
          data.requestId, data.tenantId, data.provider, data.model, data.latencyMs,
          data.promptTokens, data.completionTokens, costUsd, data.cacheHit,
          data.failoverUsed, data.providerStatusCode, data.status, data.routingReason,
          data.queryType, data.complexityScore
        ]
      );
      
      // 3. Decrement Budget (only if cost > 0)
      if (parseFloat(costUsd) > 0) {
        // Row-level lock to prevent concurrent modifications
        await client.query(
          `SELECT budget_usd FROM tenants WHERE id = $1 FOR UPDATE`,
          [data.tenantId]
        );
        
        await client.query(
          `UPDATE tenants SET budget_usd = budget_usd - $1 WHERE id = $2`,
          [costUsd, data.tenantId]
        );
      }
      
      await client.query("COMMIT");
      console.log(`✅ [Worker] Job ${job.id} processed (req: ${data.requestId.substring(0, 8)}, cost: $${costUsd})`);
      
      // 4. Best-effort cache invalidation
      if (parseFloat(costUsd) > 0) {
        try {
          // We must query api_keys to get the keyHash since we only have tenantId
          const keys = await pool.query(
            `SELECT key_hash FROM api_keys WHERE tenant_id = $1`,
            [data.tenantId]
          );
          
          for (const row of keys.rows) {
            await invalidateKeyCache(row.key_hash);
          }
        } catch (cacheErr) {
          console.error(`🟡 [Worker] Failed to invalidate key cache for tenant ${data.tenantId}`, cacheErr);
        }
      }
      
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`🔴 [Worker] Transaction failed for job ${job.id}:`, error);
      throw error; // Let BullMQ retry
    } finally {
      client.release();
    }
  },
  {
    connection: getRedisConnection(),
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "5", 10),
  }
);

telemetryWorker.on("failed", (job, err) => {
  console.error(`🔴 [Worker] Job ${job?.id} failed with error:`, err.message);
});
