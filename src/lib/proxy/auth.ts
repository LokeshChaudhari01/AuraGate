// =============================================================================
// AuraGate — API Key Validation & Budget Check
// =============================================================================
// Purpose:
//   Validates an incoming API key and returns the tenant context including
//   budget state. Uses a two-tier lookup: Redis cache → Postgres fallback.
//
// Interactions:
//   - Called by route.ts as step 1-2 of the proxy pipeline.
//   - Uses Phase 3 key cache (getCachedKeyMapping / setCachedKeyMapping).
//   - Queries Phase 2 schema (api_keys JOIN tenants) on cache miss.
//   - Returns AuthResult with budgetUsd for 402 checks in route.ts.
//
// Dependencies:
//   - src/lib/redis/key-cache.ts (Phase 3)
//   - src/lib/db/index.ts (Phase 2)
//   - src/lib/db/schema.ts (Phase 2)
//   - crypto (Node.js built-in)
// =============================================================================

import { createHash } from "crypto";
import { db } from "@/lib/db";
import { apiKeys, tenants } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  getCachedKeyMapping,
  setCachedKeyMapping,
} from "@/lib/redis/key-cache";
import type { AuthResult } from "./providers/types";

/**
 * Hashes a raw API key using SHA-256.
 * Same algorithm used in the seed script — ensures hashes match.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Validates an API key and returns the tenant context.
 *
 * Pipeline:
 *   1. SHA-256 hash the raw key
 *   2. Check Redis key cache (5-min TTL)
 *   3. On cache miss: query Postgres (api_keys JOIN tenants)
 *   4. On cache miss + valid: populate Redis cache
 *   5. Validate: key active + tenant active
 *   6. Return AuthResult with budgetUsd, or null if invalid
 *
 * @param rawKey - The raw API key from the Authorization header
 * @returns AuthResult if valid, null if invalid/not found
 */
export async function validateApiKey(
  rawKey: string
): Promise<AuthResult | null> {
  const keyHash = hashApiKey(rawKey);

  // ----- Tier 1: Redis Cache -----
  const cached = await getCachedKeyMapping(keyHash);

  if (cached) {
    // Validate active state from cache
    if (!cached.keyIsActive || !cached.tenantIsActive) {
      return null;
    }

    return {
      tenantId: cached.tenantId,
      tenantName: "", // Not stored in cache — acceptable for non-logging uses
      budgetUsd: cached.budgetUsd,
      keyHash,
    };
  }

  // ----- Tier 2: Postgres Fallback -----
  try {
    const results = await db
      .select({
        keyId: apiKeys.id,
        keyIsActive: apiKeys.isActive,
        tenantId: tenants.id,
        tenantName: tenants.name,
        tenantIsActive: tenants.isActive,
        budgetUsd: tenants.budgetUsd,
      })
      .from(apiKeys)
      .innerJoin(tenants, eq(apiKeys.tenantId, tenants.id))
      .where(and(eq(apiKeys.keyHash, keyHash)))
      .limit(1);

    if (results.length === 0) {
      return null;
    }

    const row = results[0];

    // Cache the mapping in Redis (5-min TTL) regardless of active state
    // so repeated invalid key lookups don't hammer Postgres
    await setCachedKeyMapping(keyHash, {
      tenantId: row.tenantId,
      tenantIsActive: row.tenantIsActive,
      keyIsActive: row.keyIsActive,
      budgetUsd: parseFloat(row.budgetUsd ?? "0"),
    });

    // Validate active state
    if (!row.keyIsActive || !row.tenantIsActive) {
      return null;
    }

    return {
      tenantId: row.tenantId,
      tenantName: row.tenantName,
      budgetUsd: parseFloat(row.budgetUsd ?? "0"),
      keyHash,
    };
  } catch (error) {
    console.error(
      "🔴 [Auth] Postgres query failed:",
      (error as Error).message
    );
    return null;
  }
}

/**
 * Extracts the Bearer token from an Authorization header value.
 *
 * @param authHeader - The full "Bearer <token>" string
 * @returns The raw token, or null if malformed
 */
export function extractBearerToken(
  authHeader: string | null
): string | null {
  if (!authHeader) return null;
  if (!authHeader.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7).trim();
  return token.length > 0 ? token : null;
}
