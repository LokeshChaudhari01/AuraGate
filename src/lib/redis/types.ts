// =============================================================================
// AuraGate — Shared Redis Type Definitions
// =============================================================================
// Purpose:
//   Defines the TypeScript interfaces used across all Redis middleware modules
//   (rate limiter, prompt cache, key cache). Centralizes type contracts to
//   ensure consistency between the Redis layer and the Phase 4 proxy engine.
//
// Interactions:
//   - Imported by rate-limiter.ts, prompt-cache.ts, key-cache.ts, and
//     the Phase 4 proxy route handler.
//   - No runtime dependencies — pure type definitions.
// =============================================================================

/**
 * Result returned by the sliding window rate limiter.
 * Contains all data needed to populate standard rate limit response headers:
 *   X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
 */
export interface RateLimitResult {
  /** Whether the request is allowed through. */
  allowed: boolean;
  /** Current number of requests in the active window. */
  current: number;
  /** Maximum requests allowed per window. */
  limit: number;
  /** Remaining requests before hitting the limit. */
  remaining: number;
  /** Unix timestamp (ms) when the current window resets. */
  resetMs: number;
}

/**
 * Structured response stored in the prompt cache.
 * Contains the LLM completion and metadata needed for telemetry logging.
 */
export interface CachedResponse {
  /** The LLM completion text. */
  completion: string;
  /** The model that generated this response (e.g., "gpt-4o", "gemini-1.5-flash"). */
  model: string;
  /** Provider that served this response (e.g., "openai", "gemini"). */
  provider: string;
  /** Number of tokens in the original prompt. */
  promptTokens: number;
  /** Number of tokens in the completion. */
  completionTokens: number;
  /** Unix timestamp (ms) when this response was cached. */
  cachedAt: number;
}

/**
 * Cached mapping from API key hash to tenant information.
 * Used to avoid hitting Postgres on every request for key validation.
 */
export interface CachedKeyMapping {
  /** The tenant's UUID. */
  tenantId: string;
  /** Whether the tenant is currently active. */
  tenantIsActive: boolean;
  /** Whether this specific API key is active. */
  keyIsActive: boolean;
  /** The tenant's remaining budget in USD. Enables budget check from cache. */
  budgetUsd: number;
}

/**
 * Configuration for the rate limiter, sourced from environment variables.
 */
export interface RateLimitConfig {
  /** Maximum requests allowed per window. Default: 100. */
  maxRequests: number;
  /** Window size in milliseconds. Default: 60000 (1 minute). */
  windowMs: number;
}

/**
 * Configuration for the prompt cache, sourced from environment variables.
 */
export interface PromptCacheConfig {
  /** Base TTL in seconds. Default: 3600 (1 hour). */
  ttlSeconds: number;
  /** Maximum jitter in seconds to add to TTL. Default: 300 (5 minutes). */
  jitterSeconds: number;
  /** Cache key version prefix. Default: "v1". */
  version: string;
}
