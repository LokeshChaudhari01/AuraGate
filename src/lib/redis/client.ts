// =============================================================================
// AuraGate — Singleton ioredis Client
// =============================================================================
// Purpose:
//   Creates and exports a singleton ioredis client for all Redis operations
//   (rate limiting, prompt caching, API key caching, BullMQ in Phase 5).
//   Uses the globalThis caching pattern to prevent connection exhaustion
//   during Next.js hot-module-replacement in development.
//
// Interactions:
//   - Every Redis-dependent module imports `redis` from this file.
//   - Connects using REDIS_URL from .env (or constructs from REDIS_PASSWORD + REDIS_PORT).
//   - Logs connection events for observability.
//
// Dependencies:
//   - ioredis (Redis client with Lua scripting support)
//
// Failure Scenarios:
//   - REDIS_URL not set and REDIS_PASSWORD not set: throws at import time.
//   - Redis unreachable: ioredis retries with exponential backoff.
//     Modules using this client should handle connection failures gracefully (fail-open).
//
// Scaling Considerations:
//   - Single connection is sufficient for 10K+ ops/s (Redis is single-threaded).
//   - For pipelining or Cluster, ioredis supports both natively.
// =============================================================================

import Redis from "ioredis";

// ---------------------------------------------------------------------------
// Connection URL Resolution
// ---------------------------------------------------------------------------
// Prefer REDIS_URL (explicit connection string) over constructing from parts.
// This supports both local dev and hosted Redis (e.g., Upstash, ElastiCache).
// ---------------------------------------------------------------------------
function getRedisUrl(): string {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }

  // Fallback: construct from individual env vars (Phase 1 format)
  const password = process.env.REDIS_PASSWORD;
  const port = process.env.REDIS_PORT || "6379";
  const host = process.env.REDIS_HOST || "localhost";

  if (!password) {
    throw new Error(
      "❌ Redis connection not configured.\n" +
        "   Set REDIS_URL in your .env file, or provide REDIS_PASSWORD + REDIS_PORT.\n" +
        '   Example: REDIS_URL="redis://:your_password@localhost:6379"'
    );
  }

  return `redis://:${password}@${host}:${port}`;
}

// ---------------------------------------------------------------------------
// Client Factory
// ---------------------------------------------------------------------------
function createRedisClient(): Redis {
  const url = getRedisUrl();

  const client = new Redis(url, {
    // Retry configuration: exponential backoff with cap
    retryStrategy(times: number): number | null {
      if (times > 10) {
        console.error(
          `🔴 [Redis] Failed to connect after ${times} attempts. Giving up.`
        );
        return null; // Stop retrying
      }
      const delay = Math.min(times * 200, 5000); // 200ms, 400ms, ..., 5000ms cap
      console.warn(
        `🟡 [Redis] Reconnecting in ${delay}ms (attempt ${times})...`
      );
      return delay;
    },

    // Maximum retries per individual command (not connection)
    maxRetriesPerRequest: 3,

    // Wait for Redis READY event before accepting commands
    enableReadyCheck: true,

    // Connect immediately on instantiation
    lazyConnect: false,

    // Connection metadata for Redis CLIENT LIST identification
    connectionName: "auragate-gateway",
  });

  // ---------------------------------------------------------------------------
  // Connection Event Logging
  // ---------------------------------------------------------------------------
  client.on("connect", () => {
    console.log("🟢 [Redis] Connected successfully.");
  });

  client.on("ready", () => {
    console.log("🟢 [Redis] Ready to accept commands.");
  });

  client.on("error", (err: Error) => {
    console.error("🔴 [Redis] Connection error:", err.message);
  });

  client.on("close", () => {
    console.warn("🟡 [Redis] Connection closed.");
  });

  client.on("reconnecting", () => {
    console.warn("🟡 [Redis] Reconnecting...");
  });

  return client;
}

// ---------------------------------------------------------------------------
// Singleton Pattern (Development HMR Safety)
// ---------------------------------------------------------------------------
// Same pattern as the Drizzle client in src/lib/db/index.ts.
// Prevents connection exhaustion during Next.js hot-module-replacement.
// ---------------------------------------------------------------------------
declare global {
  // eslint-disable-next-line no-var
  var __redis: Redis | undefined;
}

let redis: Redis;

if (process.env.NODE_ENV === "production") {
  redis = createRedisClient();
} else {
  if (!globalThis.__redis) {
    globalThis.__redis = createRedisClient();
  }
  redis = globalThis.__redis;
}

export { redis };
