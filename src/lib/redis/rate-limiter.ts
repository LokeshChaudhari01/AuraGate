// =============================================================================
// AuraGate — Sliding Window Rate Limiter
// =============================================================================
// Purpose:
//   Provides an atomic, race-condition-proof rate limiter using a Redis Lua
//   script. Enforces a configurable limit (default: 100 req/min) per API key.
//
// Interactions:
//   - Phase 4 proxy route handler calls `checkRateLimit()` on every request.
//   - Uses the ioredis client from ./client.ts.
//   - Executes the Lua script from ./lua/sliding-window.lua via EVALSHA.
//   - Returns a RateLimitResult used to set X-RateLimit-* response headers.
//
// Dependencies:
//   - ioredis (client with defineCommand support)
//   - ./lua/sliding-window.lua (atomic Lua script)
//   - ./types.ts (RateLimitResult, RateLimitConfig)
//
// Failure Scenarios:
//   - Redis unreachable: fail-open (allow the request, log the error).
//   - Lua script not cached: ioredis auto-falls back from EVALSHA to EVAL.
//
// Scaling Considerations:
//   - O(log N) per call where N = requests in window. At 100 req/min, N ≤ 100.
//   - Keys auto-expire via PEXPIRE — no manual cleanup needed.
// =============================================================================

import { redis } from "./client";
import type { RateLimitResult, RateLimitConfig } from "./types";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Lua Script Loading
// ---------------------------------------------------------------------------
// The script is loaded once at module initialization time.
// ioredis's EVAL/EVALSHA mechanism handles caching automatically.
// ---------------------------------------------------------------------------
const LUA_SCRIPT_PATH = path.join(
  process.cwd(),
  "src",
  "lib",
  "redis",
  "lua",
  "sliding-window.lua"
);

let luaScript: string;

try {
  luaScript = fs.readFileSync(LUA_SCRIPT_PATH, "utf-8");
} catch {
  // Fallback: inline script if file read fails (e.g., in bundled environments)
  console.warn(
    "⚠️ [RateLimiter] Could not read Lua script from disk, using inline fallback."
  );
  luaScript = `
    local key = KEYS[1]
    local now = tonumber(ARGV[1])
    local window = tonumber(ARGV[2])
    local limit = tonumber(ARGV[3])
    local member = ARGV[4]
    redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
    local current_count = redis.call('ZCARD', key)
    if current_count < limit then
      redis.call('ZADD', key, now, member)
      redis.call('PEXPIRE', key, window)
      current_count = current_count + 1
      return {1, current_count, limit - current_count, now + window}
    else
      redis.call('PEXPIRE', key, window)
      return {0, current_count, 0, now + window}
    end
  `;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
function getConfig(): RateLimitConfig {
  return {
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX || "100", 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  };
}

// ---------------------------------------------------------------------------
// Key Namespace
// ---------------------------------------------------------------------------
const KEY_PREFIX = "auragate:rl:";

/**
 * Generates the Redis key for a given API key hash.
 * Format: auragate:rl:<key_hash>
 */
function getRateLimitKey(keyHash: string): string {
  return `${KEY_PREFIX}${keyHash}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether a request from the given API key is within the rate limit.
 *
 * This function is the primary entry point called by the Phase 4 proxy.
 * It executes an atomic Lua script in Redis that:
 *   1. Purges expired entries from the sliding window
 *   2. Counts current entries
 *   3. Adds the new request if under the limit
 *   4. Returns rich metadata for response headers
 *
 * On Redis failure, this function FAILS OPEN — it returns an "allowed"
 * result to prevent a Redis outage from blocking all proxy traffic.
 *
 * @param keyHash - SHA-256 hash of the API key
 * @param overrideLimit - Optional: override the default max requests
 * @param overrideWindowMs - Optional: override the default window size
 * @returns RateLimitResult with allowed, current, limit, remaining, resetMs
 */
export async function checkRateLimit(
  keyHash: string,
  overrideLimit?: number,
  overrideWindowMs?: number
): Promise<RateLimitResult> {
  const config = getConfig();
  const limit = overrideLimit ?? config.maxRequests;
  const windowMs = overrideWindowMs ?? config.windowMs;

  const key = getRateLimitKey(keyHash);
  const now = Date.now();
  // Unique member: timestamp + random suffix to prevent collisions
  // within the same millisecond across concurrent requests
  const member = `${now}:${Math.random().toString(36).substring(2, 10)}`;

  try {
    const result = (await redis.eval(
      luaScript,
      1, // Number of KEYS
      key, // KEYS[1]
      now.toString(), // ARGV[1]: current timestamp
      windowMs.toString(), // ARGV[2]: window size
      limit.toString(), // ARGV[3]: max requests
      member // ARGV[4]: unique member
    )) as number[];

    const [allowed, currentCount, remaining, resetMs] = result;

    return {
      allowed: allowed === 1,
      current: currentCount,
      limit,
      remaining,
      resetMs,
    };
  } catch (error) {
    // FAIL OPEN: If Redis is down, allow the request through.
    // This is a deliberate design choice — availability over strict enforcement.
    // The error is logged for monitoring/alerting.
    console.error(
      "🔴 [RateLimiter] Redis error, failing open:",
      (error as Error).message
    );

    return {
      allowed: true,
      current: 0,
      limit,
      remaining: limit,
      resetMs: now + windowMs,
    };
  }
}

/**
 * Resets the rate limit counter for a specific API key.
 * Useful for admin operations or testing.
 *
 * @param keyHash - SHA-256 hash of the API key to reset
 */
export async function resetRateLimit(keyHash: string): Promise<void> {
  const key = getRateLimitKey(keyHash);
  try {
    await redis.del(key);
  } catch (error) {
    console.error(
      "🔴 [RateLimiter] Failed to reset rate limit:",
      (error as Error).message
    );
  }
}
