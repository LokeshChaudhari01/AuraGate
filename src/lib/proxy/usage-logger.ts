// =============================================================================
// AuraGate — Non-Blocking Usage Logger
// =============================================================================
// Purpose:
//   Persists usage data to the usage_logs table ASYNCHRONOUSLY after stream
//   completion. Never delays client responses (AD-8).
//
// Contract:
//   1. Complete response streaming first.
//   2. Return response to client immediately.
//   3. Persist usage_logs asynchronously after completion.
//   4. Logging failures NEVER affect the request lifecycle.
//   5. Log failures internally for debugging.
//
// Phase 5 Upgrade:
//   This fire-and-forget INSERT will be replaced with a BullMQ job enqueue
//   — same non-blocking contract, but with retry guarantees and budget
//   decrement via SELECT ... FOR UPDATE.
//
// Interactions:
//   - Called by route.ts onComplete callback (step 10).
//   - Inserts into usage_logs (Phase 2 schema).
//   - Never imported by any other proxy module (AD-13).
// =============================================================================

import { telemetryQueue } from "@/lib/queue/telemetry-queue";
import type { StreamResult, RoutingReason } from "./providers/types";

/**
 * Logs usage data asynchronously. Fire-and-forget — NEVER awaited
 * in the response path.
 *
 * @param params.requestId - Correlation ID
 * @param params.tenantId - The tenant's UUID
 * @param params.result - StreamResult from the stream handler
 * @param params.cacheHit - Whether this was served from cache
 * @param params.routingReason - Why this model was selected
 * @param params.queryType - Phase 6 query classification
 * @param params.complexityScore - Phase 6 complexity score
 */
export function logUsageAsync(params: {
  requestId: string;
  tenantId: string;
  result: StreamResult;
  cacheHit: boolean;
  routingReason: RoutingReason;
  queryType?: "simple" | "coding" | "complex";
  complexityScore?: number;
}): void {
  const { requestId, tenantId, result, cacheHit, routingReason, queryType, complexityScore } = params;

  telemetryQueue.add("usage", {
    requestId,
    tenantId,
    provider: result.provider,
    model: result.model,
    routingReason,
    latencyMs: result.latencyMs,
    promptTokens: result.promptTokens,
    completionTokens: result.completionTokens,
    cacheHit,
    failoverUsed: result.failoverUsed,
    providerStatusCode: result.providerStatusCode,
    status: result.isComplete ? "SUCCESS" : "FAILED",
    queryType: queryType ?? null,
    complexityScore: complexityScore ?? null,
  }).catch((error: Error) => {
    // Log internally but NEVER throw — request is already completed
    console.error(
      `🔴 [UsageLog] Failed to enqueue job for request ${requestId.substring(0, 8)}...:`,
      error.message
    );
  });
}
