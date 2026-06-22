import { Queue } from "bullmq";
import "dotenv/config";

export interface TelemetryJobData {
  requestId: string;
  tenantId: string;
  provider: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cacheHit: boolean;
  failoverUsed: boolean;
  providerStatusCode: number | null;
  status: "SUCCESS" | "FAILED" | "CACHED";
  routingReason: string | null;
  queryType: "simple" | "coding" | "complex" | null;
  complexityScore: number | null;
}

export const TELEMETRY_QUEUE_NAME = "auragate_telemetry";

function getRedisConnection() {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error("REDIS_URL not set");

  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "6379", 10),
    password: parsed.password || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
  };
}

export const telemetryQueue = new Queue<TelemetryJobData>(TELEMETRY_QUEUE_NAME, {
  connection: getRedisConnection(),
  defaultJobOptions: {
    removeOnComplete: 1000,
    removeOnFail: 5000,
    attempts: 3,
    backoff: { type: "exponential", delay: 1000 },
  },
});
