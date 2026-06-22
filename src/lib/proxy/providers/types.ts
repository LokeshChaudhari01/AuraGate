// =============================================================================
// AuraGate — Provider Types & Shared Interfaces
// =============================================================================
// Purpose:
//   Central type contract for Phase 4. Every proxy module imports from here —
//   never from each other. This enforces AD-13 (Contract Integrity).
//
// Interactions:
//   - Imported by: route.ts, auth.ts, pii-scrubber.ts, cost-router.ts,
//     stream-handler.ts, usage-logger.ts, errors.ts, gemini.ts, registry.ts
//   - No runtime dependencies — pure type definitions.
// =============================================================================

// ---------------------------------------------------------------------------
// Inbound Request Types
// ---------------------------------------------------------------------------

/**
 * A single message in the conversation.
 * Follows the OpenAI-compatible format (role + content).
 */
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

/**
 * The parsed JSON body of a POST /api/v1/proxy request.
 */
export interface ProxyRequest {
  /** Optional model override. If set, cost router honors it (Tier 1). */
  model?: string;
  /** The conversation messages array. Must be non-empty. */
  messages: Message[];
  /** Sampling temperature. Passed through to the LLM provider. */
  temperature?: number;
  /** Whether to stream the response. Always true for this gateway. */
  stream?: boolean;
}

// ---------------------------------------------------------------------------
// Provider Abstraction Layer
// ---------------------------------------------------------------------------

/**
 * The data a provider needs to initiate a streaming request.
 * Provider implementations receive this — they never access env vars directly.
 */
export interface StreamRequest {
  model: string;
  messages: Message[];
  apiKey: string;
  temperature?: number;
}

/**
 * The core provider interface. Every provider (Gemini, OpenAI, Groq)
 * must implement this contract. The stream handler and route handler
 * interact with providers ONLY through this interface.
 *
 * To add a new provider:
 *   1. Implement this interface in providers/<name>.ts
 *   2. Register it in providers/registry.ts
 *   3. Zero changes to route.ts or stream-handler.ts
 */
export interface LLMProvider {
  /** Human-readable provider name (e.g., "gemini", "openai"). */
  readonly name: string;

  /**
   * Initiates a streaming request to the LLM.
   *
   * @param request - The structured request data
   * @param signal - AbortSignal for timeout/cancellation
   * @returns Raw fetch Response with SSE body stream
   * @throws On network errors — caller handles failover
   */
  stream(request: StreamRequest, signal: AbortSignal): Promise<Response>;
}

// ---------------------------------------------------------------------------
// Provider Configuration (for stream handler)
// ---------------------------------------------------------------------------

/**
 * Configuration passed to the stream handler for a single provider attempt.
 * Timeouts come from env vars — never hardcoded (AD-12).
 */
export interface ProviderConfig {
  /** The provider implementation (from registry). */
  provider: LLMProvider;
  /** The model to use (e.g., "gemini-2.0-flash"). */
  model: string;
  /** The API key for this provider. */
  apiKey: string;
  /** Timeout in ms before aborting. From PROXY_TIMEOUT_MS env var. */
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Cost Routing
// ---------------------------------------------------------------------------

/**
 * Why a request was routed to a specific model.
 * Stored in usage_logs.routing_reason for Phase 6 dashboard analytics.
 */
export type RoutingReason =
  | "under_threshold" // Default: prompt is small → Flash
  | "over_threshold" // Prompt exceeds token threshold → Pro
  | "complexity_based" // Reasoning keywords detected → Pro
  | "user_specified" // User explicitly set model in request
  | "fallback_provider" // Primary failed, fell back to alternate
  | "cache_hit" // Served from prompt cache
  | "code_block_detected"
  | "code_keywords"
  | "complexity_score_high"
  | "default_simple";

/**
 * The output of the cost router. Tells the orchestrator which
 * provider and model to use, and why.
 */
export interface RouteDecision {
  /** Provider name (key in the registry). */
  providerName: string;
  /** Model to use (e.g., "gemini-2.0-flash"). */
  model: string;
  /** Estimated token count (chars / 4). */
  estimatedTokens: number;
  /** Why this route was chosen. Persisted to usage_logs. */
  routingReason: RoutingReason;
  /** Phase 6 query type classification. */
  queryType: "simple" | "coding" | "complex";
  /** Phase 6 routing complexity score. */
  complexityScore: number;
}

// ---------------------------------------------------------------------------
// Stream Result (output of stream handler)
// ---------------------------------------------------------------------------

/**
 * The result produced after a stream completes (or fails).
 * Used by route.ts for: cache write, usage logging, response headers.
 */
export interface StreamResult {
  /** Correlation ID for this request. */
  requestId: string;
  /** The accumulated completion text. */
  completion: string;
  /** Provider that served this response (e.g., "gemini"). */
  provider: string;
  /** Model that generated this response (e.g., "gemini-2.0-flash"). */
  model: string;
  /** Why this model was selected. */
  routingReason: RoutingReason;
  /** Phase 6 query type. */
  queryType?: "simple" | "coding" | "complex";
  /** Phase 6 complexity score. */
  complexityScore?: number;
  /** Whether the primary provider failed and we fell back. */
  failoverUsed: boolean;
  /** Total request latency in milliseconds. */
  latencyMs: number;
  /** HTTP status code from the upstream LLM. */
  providerStatusCode: number;
  /** Tokens in the original prompt (from provider's usageMetadata). */
  promptTokens: number;
  /** Tokens in the completion (from provider's usageMetadata). */
  completionTokens: number;
  /** Whether the stream completed fully without error or disconnect. */
  isComplete: boolean;
}

// ---------------------------------------------------------------------------
// Auth Result
// ---------------------------------------------------------------------------

/**
 * Returned by the auth module after successful API key validation.
 * Contains everything the orchestrator needs: tenant identity + budget.
 */
export interface AuthResult {
  /** The tenant's UUID. */
  tenantId: string;
  /** The tenant's display name (for logging). */
  tenantName: string;
  /** The tenant's remaining budget in USD. */
  budgetUsd: number;
  /** The SHA-256 hash of the API key (for rate limiting). */
  keyHash: string;
}

// ---------------------------------------------------------------------------
// PII Scrubbing Result
// ---------------------------------------------------------------------------

/**
 * Returned by the PII scrubber. Contains sanitized messages and metadata.
 */
export interface ScrubResult {
  /** Messages with PII replaced by [PII_REDACTED:type] tags. */
  sanitizedMessages: Message[];
  /** Whether any PII was detected. */
  piiDetected: boolean;
  /** Total number of PII instances found and redacted. */
  piiCount: number;
}
