// =============================================================================
// AuraGate — API Key Validation Cache
// =============================================================================
// Purpose:
//   Caches the mapping from API key hash → tenant information in Redis.
//   This avoids hitting PostgreSQL on every proxy request for key validation.
//   The cache has a short TTL (5 minutes) to ensure key revocations
//   propagate within a bounded time window.
//
// Interactions:
//   - Phase 4 proxy: calls getCachedKeyMapping() before querying Postgres.
//   - Phase 4 proxy: calls setCachedKeyMapping() after a successful Postgres lookup.
//   - Admin API (future): calls invalidateKeyCache() when revoking a key.
//
// Dependencies:
//   - ioredis (./client.ts)
//   - ./types.ts (CachedKeyMapping)
//
// Failure Scenarios:
//   - Redis unreachable on GET: returns null → proxy falls back to Postgres.
//   - Redis unreachable on SET: logs error → next request will also hit Postgres.
//   - Both are non-fatal — Postgres is the source of truth.
//
// Scaling Considerations:
//   - Each cached mapping is ~100 bytes. At 1000 API keys → ~100KB total.
//   - 5-minute TTL balances latency savings vs. revocation propagation speed.
// =============================================================================

import { redis } from "./client";
import type { CachedKeyMapping } from "./types";

// ---------------------------------------------------------------------------
// Key Namespace & TTL
// ---------------------------------------------------------------------------
const KEY_PREFIX = "auragate:key:";
const DEFAULT_TTL_SECONDS = 300; // 5 minutes

/**
 * Generates the Redis key for a given API key hash.
 * Format: auragate:key:<key_hash>
 */
function getKeyMappingKey(keyHash: string): string {
  return `${KEY_PREFIX}${keyHash}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieves a cached API key → tenant mapping.
 *
 * On Redis failure, returns null — the proxy falls back to querying Postgres
 * directly. This ensures a Redis outage doesn't break authentication.
 *
 * @param keyHash - SHA-256 hash of the raw API key
 * @returns CachedKeyMapping if found, null on miss or error
 */
export async function getCachedKeyMapping(
  keyHash: string
): Promise<CachedKeyMapping | null> {
  try {
    const data = await redis.get(getKeyMappingKey(keyHash));

    if (!data) {
      return null;
    }

    const parsed = JSON.parse(data) as CachedKeyMapping;

    // Basic validation
    if (!parsed.tenantId) {
      console.warn(
        "⚠️ [KeyCache] Corrupted cache entry for key:",
        keyHash.substring(0, 8) + "..."
      );
      return null;
    }

    return parsed;
  } catch (error) {
    console.error(
      "🔴 [KeyCache] GET error, falling back to Postgres:",
      (error as Error).message
    );
    return null;
  }
}

/**
 * Caches an API key → tenant mapping with a 5-minute TTL.
 *
 * Called after a successful Postgres lookup to speed up subsequent
 * requests using the same API key.
 *
 * @param keyHash - SHA-256 hash of the raw API key
 * @param mapping - The tenant information to cache
 * @param ttlSeconds - Optional TTL override (default: 300s / 5 minutes)
 */
export async function setCachedKeyMapping(
  keyHash: string,
  mapping: CachedKeyMapping,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<void> {
  try {
    const serialized = JSON.stringify(mapping);
    await redis.set(getKeyMappingKey(keyHash), serialized, "EX", ttlSeconds);
  } catch (error) {
    // Non-fatal: next request will simply hit Postgres again
    console.error(
      "🔴 [KeyCache] SET error:",
      (error as Error).message
    );
  }
}

/**
 * Invalidates a cached API key mapping.
 *
 * Should be called when:
 *   - An API key is revoked/deactivated
 *   - A tenant is deactivated
 *   - An admin explicitly invalidates a key
 *
 * After invalidation, the next request with this key will hit Postgres,
 * picking up the latest state.
 *
 * @param keyHash - SHA-256 hash of the API key to invalidate
 */
export async function invalidateKeyCache(keyHash: string): Promise<void> {
  try {
    await redis.del(getKeyMappingKey(keyHash));
  } catch (error) {
    console.error(
      "🔴 [KeyCache] Invalidation error:",
      (error as Error).message
    );
  }
}

/**
 * Invalidates all cached key mappings for a given tenant.
 *
 * Uses SCAN to find and delete all matching keys without blocking Redis.
 * Called when a tenant is deactivated to immediately revoke all their keys.
 *
 * Note: This scans all key cache entries. At scale (10K+ keys), consider
 * maintaining a reverse index (tenant_id → [key_hashes]) in Redis.
 *
 * @param _tenantId - The tenant ID (used for logging only; actual matching
 *                    requires scanning cached values)
 */
export async function invalidateTenantKeys(_tenantId: string): Promise<void> {
  // For the current scale, a full SCAN is acceptable.
  // At high key counts, maintain a reverse index: auragate:tenant_keys:<tenant_id> → SET of key_hashes
  const pattern = `${KEY_PREFIX}*`;

  try {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100
      );
      cursor = nextCursor;

      for (const key of keys) {
        const data = await redis.get(key);
        if (data) {
          const mapping = JSON.parse(data) as CachedKeyMapping;
          if (mapping.tenantId === _tenantId) {
            await redis.del(key);
          }
        }
      }
    } while (cursor !== "0");
  } catch (error) {
    console.error(
      "🔴 [KeyCache] Tenant invalidation error:",
      (error as Error).message
    );
  }
}
