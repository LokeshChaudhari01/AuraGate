// =============================================================================
// AuraGate — Prompt Response Cache (Cache-Aside Pattern)
// =============================================================================
// Purpose:
//   Implements the cache-aside pattern for LLM prompt responses. Before
//   forwarding a request to the LLM provider, the proxy checks this cache.
//   If a matching response exists, it's returned instantly with X-Cache: HIT,
//   saving both latency and cost.
//
// Cache Key Design:
//   SHA-256 hash of JSON.stringify({ model, messages, temperature }).
//   Namespaced as: auragate:cache:v1:<sha256_hash>
//   The version segment (v1) allows bulk invalidation by incrementing.
//
// Interactions:
//   - Phase 4 proxy: calls getCachedResponse() before LLM call.
//   - Phase 4 proxy: calls setCachedResponse() after successful LLM response.
//   - Phase 6 dashboard: uses cache hit data for "Cost Saved" metric.
//
// Dependencies:
//   - ioredis (./client.ts)
//   - crypto (SHA-256 hashing)
//   - ./types.ts (CachedResponse, PromptCacheConfig)
//
// Failure Scenarios:
//   - Redis unreachable on GET: returns null (cache miss) — proxy proceeds to LLM.
//   - Redis unreachable on SET: logs error, response is still returned to client.
//   - Corrupted cache data: JSON.parse wrapped in try/catch, returns null on failure.
//
// Scaling Considerations:
//   - Each cached response is ~1-5KB (compressed JSON).
//   - At 10K unique prompts with 1-hour TTL, memory usage is ~10-50MB — negligible.
//   - TTL jitter prevents cache stampede on expiry.
// =============================================================================

import { redis } from "./client";
import { createHash } from "crypto";
import type { CachedResponse, PromptCacheConfig } from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
function getConfig(): PromptCacheConfig {
  return {
    ttlSeconds: parseInt(process.env.PROMPT_CACHE_TTL_SECONDS || "3600", 10),
    jitterSeconds: parseInt(
      process.env.PROMPT_CACHE_JITTER_SECONDS || "300",
      10
    ),
    version: process.env.PROMPT_CACHE_VERSION || "v1",
  };
}

// ---------------------------------------------------------------------------
// Key Generation
// ---------------------------------------------------------------------------
const KEY_PREFIX = "auragate:cache:";

/**
 * Generates a deterministic cache key from the request parameters.
 *
 * The key is a SHA-256 hash of the canonical JSON representation of
 * the inputs that affect the LLM output. This ensures:
 *   - Identical requests always produce the same key.
 *   - Different model/temperature combinations produce different keys.
 *   - Key length is always 64 chars (hex-encoded SHA-256).
 *
 * @param model - The LLM model name (e.g., "gpt-4o", "gemini-1.5-flash")
 * @param messages - The conversation messages array
 * @param temperature - The sampling temperature (default: 1.0)
 * @returns Namespaced cache key: auragate:cache:v1:<sha256>
 */
export function generateCacheKey(
  model: string,
  messages: unknown[],
  temperature: number = 1.0
): string {
  const config = getConfig();

  // Canonical JSON: sorted keys ensure deterministic hashing
  const canonical = JSON.stringify({
    m: model,
    msg: messages,
    t: temperature,
  });

  const hash = createHash("sha256").update(canonical).digest("hex");

  return `${KEY_PREFIX}${config.version}:${hash}`;
}

/**
 * Calculates the TTL with random jitter to prevent cache stampede.
 *
 * Cache stampede occurs when many keys expire simultaneously, causing
 * a flood of requests to the LLM. Adding random jitter distributes
 * expirations across a time window.
 *
 * @returns TTL in seconds (base + random jitter)
 */
function getTtlWithJitter(): number {
  const config = getConfig();
  const jitter = Math.floor(Math.random() * config.jitterSeconds);
  return config.ttlSeconds + jitter;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieves a cached LLM response for the given cache key.
 *
 * On Redis failure, returns null (cache miss) — the proxy proceeds
 * to call the LLM normally. This ensures a Redis outage never blocks
 * request processing.
 *
 * @param cacheKey - The namespaced cache key from generateCacheKey()
 * @returns CachedResponse if found, null on miss or error
 */
export async function getCachedResponse(
  cacheKey: string
): Promise<CachedResponse | null> {
  try {
    const data = await redis.get(cacheKey);

    if (!data) {
      return null;
    }

    // Parse and validate the cached data
    const parsed = JSON.parse(data) as CachedResponse;

    // Basic validation: ensure required fields exist
    if (!parsed.completion || !parsed.model) {
      console.warn(
        "⚠️ [PromptCache] Corrupted cache entry, treating as miss:",
        cacheKey
      );
      // Clean up corrupted entry
      await redis.del(cacheKey).catch(() => {});
      return null;
    }

    return parsed;
  } catch (error) {
    // Fail gracefully: Redis down or corrupted data → treat as cache miss
    console.error(
      "🔴 [PromptCache] GET error, treating as miss:",
      (error as Error).message
    );
    return null;
  }
}

/**
 * Stores an LLM response in the cache with TTL + jitter.
 *
 * On Redis failure, logs the error but does NOT throw — the response
 * is still returned to the client, just not cached.
 *
 * @param cacheKey - The namespaced cache key from generateCacheKey()
 * @param response - The structured response to cache
 */
export async function setCachedResponse(
  cacheKey: string,
  response: CachedResponse
): Promise<void> {
  try {
    const ttl = getTtlWithJitter();
    const serialized = JSON.stringify(response);

    await redis.set(cacheKey, serialized, "EX", ttl);
  } catch (error) {
    // Non-fatal: response is still returned to client, just not cached
    console.error(
      "🔴 [PromptCache] SET error, response not cached:",
      (error as Error).message
    );
  }
}

/**
 * Invalidates a specific cache entry.
 * Useful for admin operations or when a model is updated.
 *
 * @param cacheKey - The cache key to invalidate
 */
export async function invalidateCacheEntry(cacheKey: string): Promise<void> {
  try {
    await redis.del(cacheKey);
  } catch (error) {
    console.error(
      "🔴 [PromptCache] Invalidation error:",
      (error as Error).message
    );
  }
}

/**
 * Invalidates ALL cached responses by deleting keys matching the current
 * version prefix. Use with caution in production.
 *
 * @returns Number of keys deleted
 */
export async function invalidateAllCache(): Promise<number> {
  const config = getConfig();
  const pattern = `${KEY_PREFIX}${config.version}:*`;

  try {
    let cursor = "0";
    let totalDeleted = 0;

    // Use SCAN to avoid blocking Redis with a single KEYS command
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      }
    } while (cursor !== "0");

    return totalDeleted;
  } catch (error) {
    console.error(
      "🔴 [PromptCache] Bulk invalidation error:",
      (error as Error).message
    );
    return 0;
  }
}
