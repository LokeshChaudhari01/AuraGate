// =============================================================================
// AuraGate — Phase 3 Verification Script
// =============================================================================
// Purpose:
//   End-to-end integration test for all Redis middleware modules.
//   Tests: connection, rate limiter, prompt cache, and key cache.
//
// Usage:
//   npx tsx scripts/test-redis.ts
// =============================================================================

import "dotenv/config";
import { redis } from "../src/lib/redis/client";
import { checkRateLimit, resetRateLimit } from "../src/lib/redis/rate-limiter";
import {
  generateCacheKey,
  getCachedResponse,
  setCachedResponse,
} from "../src/lib/redis/prompt-cache";
import {
  getCachedKeyMapping,
  setCachedKeyMapping,
  invalidateKeyCache,
} from "../src/lib/redis/key-cache";
import type { CachedResponse, CachedKeyMapping } from "../src/lib/redis/types";

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ ${testName}`);
    failed++;
  }
}

async function testConnection(): Promise<void> {
  console.log("\n=== TEST 1: Redis Connection ===\n");

  const pong = await redis.ping();
  assert(pong === "PONG", "redis.ping() returns PONG");

  await redis.set("auragate:test:connection", "hello");
  const val = await redis.get("auragate:test:connection");
  assert(val === "hello", "SET/GET round-trip works");

  await redis.del("auragate:test:connection");
}

async function testRateLimiter(): Promise<void> {
  console.log("\n=== TEST 2: Sliding Window Rate Limiter ===\n");

  const testKeyHash = "test_rate_limit_key_hash_abcdef1234567890";
  const limit = 10; // Small limit for fast testing
  const windowMs = 5000; // 5 second window

  // Clean up any previous test data
  await resetRateLimit(testKeyHash);

  // Test: Send requests up to the limit
  let lastResult;
  for (let i = 1; i <= limit; i++) {
    lastResult = await checkRateLimit(testKeyHash, limit, windowMs);
    if (i <= limit) {
      assert(
        lastResult.allowed === true,
        `Request ${i}/${limit} allowed (remaining: ${lastResult.remaining})`
      );
    }
  }

  // Test: Next request should be rejected
  const rejected = await checkRateLimit(testKeyHash, limit, windowMs);
  assert(rejected.allowed === false, `Request ${limit + 1} rejected (over limit)`);
  assert(rejected.remaining === 0, `Remaining is 0 when rate limited`);
  assert(rejected.current === limit, `Current count equals limit (${rejected.current})`);
  assert(rejected.resetMs > Date.now(), `Reset timestamp is in the future`);

  // Cleanup
  await resetRateLimit(testKeyHash);
  console.log("  🧹 Rate limit key cleaned up.");
}

async function testPromptCache(): Promise<void> {
  console.log("\n=== TEST 3: Prompt Cache (Cache-Aside) ===\n");

  const model = "gpt-4o";
  const messages = [{ role: "user", content: "What is the capital of France?" }];
  const temperature = 0.7;

  const cacheKey = generateCacheKey(model, messages, temperature);
  assert(cacheKey.startsWith("auragate:cache:v1:"), "Cache key has correct namespace prefix");
  assert(cacheKey.length > 30, "Cache key has reasonable length (SHA-256)");

  // Test: Same inputs produce same key (deterministic)
  const cacheKey2 = generateCacheKey(model, messages, temperature);
  assert(cacheKey === cacheKey2, "Same inputs produce identical cache key (deterministic)");

  // Test: Different inputs produce different key
  const cacheKey3 = generateCacheKey("gemini-1.5-flash", messages, temperature);
  assert(cacheKey !== cacheKey3, "Different model produces different cache key");

  // Test: Cache miss
  const miss = await getCachedResponse(cacheKey);
  assert(miss === null, "Cache miss returns null");

  // Test: Cache set + hit
  const testResponse: CachedResponse = {
    completion: "The capital of France is Paris.",
    model: "gpt-4o",
    provider: "openai",
    promptTokens: 10,
    completionTokens: 8,
    cachedAt: Date.now(),
  };

  await setCachedResponse(cacheKey, testResponse);
  const hit = await getCachedResponse(cacheKey);
  assert(hit !== null, "Cache hit returns data after SET");
  assert(hit?.completion === testResponse.completion, "Cached completion matches original");
  assert(hit?.model === testResponse.model, "Cached model matches original");
  assert(hit?.promptTokens === testResponse.promptTokens, "Cached promptTokens matches");
  assert(hit?.completionTokens === testResponse.completionTokens, "Cached completionTokens matches");

  // Test: Check TTL is set
  const ttl = await redis.ttl(cacheKey);
  assert(ttl > 0, `TTL is set on cached entry (${ttl}s remaining)`);
  assert(ttl <= 3600 + 300, `TTL is within expected range (≤ 3900s with jitter)`);

  // Cleanup
  await redis.del(cacheKey);
  console.log("  🧹 Prompt cache key cleaned up.");
}

async function testKeyCache(): Promise<void> {
  console.log("\n=== TEST 4: API Key Validation Cache ===\n");

  const testKeyHash = "test_key_cache_hash_abcdef1234567890abcdef1234567890";

  // Test: Cache miss
  const miss = await getCachedKeyMapping(testKeyHash);
  assert(miss === null, "Key cache miss returns null");

  // Test: Cache set + hit
  const testMapping: CachedKeyMapping = {
    tenantId: "550e8400-e29b-41d4-a716-446655440000",
    tenantIsActive: true,
    keyIsActive: true,
    budgetUsd: 1000,
  };

  await setCachedKeyMapping(testKeyHash, testMapping);
  const hit = await getCachedKeyMapping(testKeyHash);
  assert(hit !== null, "Key cache hit returns data after SET");
  assert(hit?.tenantId === testMapping.tenantId, "Cached tenantId matches");
  assert(hit?.tenantIsActive === true, "Cached tenantIsActive matches");
  assert(hit?.keyIsActive === true, "Cached keyIsActive matches");

  // Test: TTL is set (should be ~300 seconds)
  const redisKey = `auragate:key:${testKeyHash}`;
  const ttl = await redis.ttl(redisKey);
  assert(ttl > 0 && ttl <= 300, `TTL is set (${ttl}s, expected ≤ 300s)`);

  // Test: Invalidation
  await invalidateKeyCache(testKeyHash);
  const afterInvalidation = await getCachedKeyMapping(testKeyHash);
  assert(afterInvalidation === null, "Key cache returns null after invalidation");

  console.log("  🧹 Key cache cleaned up via invalidation.");
}

async function main(): Promise<void> {
  console.log("\n🧪 AuraGate — Phase 3 Redis Middleware Verification\n");
  console.log("=".repeat(50));

  try {
    await testConnection();
    await testRateLimiter();
    await testPromptCache();
    await testKeyCache();

    console.log("\n" + "=".repeat(50));
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);

    if (failed > 0) {
      console.log("❌ Some tests failed. Review output above.\n");
      process.exit(1);
    } else {
      console.log("✅ All Phase 3 tests passed!\n");
    }
  } catch (error) {
    console.error("\n💥 Test suite crashed:", error);
    process.exit(1);
  } finally {
    await redis.quit();
  }
}

main();
