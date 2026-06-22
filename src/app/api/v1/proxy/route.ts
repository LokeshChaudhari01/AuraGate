// =============================================================================
// AuraGate — Core Proxy Route Handler (Orchestrator)
// =============================================================================
// Purpose:
//   The main POST /api/v1/proxy endpoint. Orchestrates the complete request
//   lifecycle through independently testable, decoupled modules.
//
// Pipeline:
//   0. Generate X-Request-ID
//   1. Extract & hash Bearer token → Auth
//   2. Validate key + tenant → 401
//   3. Budget check → 402
//   4. Rate limit → 429
//   5. Parse & validate body → 400
//   6. PII scrub user messages
//   7. Prompt cache check → return cached (X-Cache: HIT)
//   8. Cost route → select provider + model
//   9. Stream to LLM with failover
//   10. Non-blocking: cache write + usage log
//
// Interactions:
//   - Imports each module by function, never by internal. (AD-13)
//   - Uses provider registry — never imports Gemini directly. (AD-3)
//   - All timeouts from env vars. (AD-12)
//
// Runtime:
//   Node.js (NOT Edge) — required for ioredis, pg, crypto. (AD-1)
// =============================================================================

import { NextRequest } from "next/server";
import { extractBearerToken, validateApiKey } from "@/lib/proxy/auth";
import { sanitizeMessages } from "@/lib/proxy/pii-scrubber";
import { selectProvider } from "@/lib/proxy/cost-router";
import { createProxyStream } from "@/lib/proxy/stream-handler";
import { logUsageAsync } from "@/lib/proxy/usage-logger";
import { getProvider } from "@/lib/proxy/providers/registry";
import {
  unauthorized,
  budgetExceeded,
  rateLimited,
  badRequest,
  providerError,
} from "@/lib/proxy/errors";
import { checkRateLimit } from "@/lib/redis/rate-limiter";
import {
  getCachedResponse,
  setCachedResponse,
  generateCacheKey,
} from "@/lib/redis/prompt-cache";

import type {
  Message,
  ProxyRequest,
  ProviderConfig,
  StreamResult,
} from "@/lib/proxy/providers/types";

// ---------------------------------------------------------------------------
// Route Configuration
// ---------------------------------------------------------------------------

export const runtime = "nodejs"; // Required for ioredis + pg (AD-1)
export const dynamic = "force-dynamic"; // Never cache this route

// ---------------------------------------------------------------------------
// POST /api/v1/proxy
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest): Promise<Response> {
  // ===== Step 0: Generate Request Correlation ID (AD-9) =====
  const requestId = crypto.randomUUID();

  // ===== Step 1: Extract Bearer Token =====
  const token = extractBearerToken(
    request.headers.get("authorization")
  );

  if (!token) {
    return unauthorized(requestId);
  }

  // ===== Step 2: Validate API Key + Tenant =====
  const auth = await validateApiKey(token);

  if (!auth) {
    return unauthorized(requestId);
  }

  // ===== Step 3: Budget Check (AD-10) =====
  if (auth.budgetUsd <= 0) {
    return budgetExceeded(requestId);
  }

  // ===== Step 4: Rate Limit Check =====
  const rateLimit = await checkRateLimit(auth.keyHash);

  if (!rateLimit.allowed) {
    return rateLimited(requestId, rateLimit);
  }

  const rateLimitHeaders = {
    "X-RateLimit-Limit": rateLimit.limit.toString(),
    "X-RateLimit-Remaining": rateLimit.remaining.toString(),
    "X-RateLimit-Reset": rateLimit.resetMs.toString(),
  };

  // ===== Step 5: Parse & Validate Request Body =====
  let body: ProxyRequest;
  try {
    body = (await request.json()) as ProxyRequest;
  } catch {
    return badRequest(requestId, "Invalid JSON in request body", rateLimitHeaders);
  }

  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return badRequest(requestId, "messages must be a non-empty array", rateLimitHeaders);
  }

  for (let i = 0; i < body.messages.length; i++) {
    const msg = body.messages[i];
    if (!msg.role || !msg.content || typeof msg.content !== "string") {
      return badRequest(
        requestId,
        `messages[${i}] must have 'role' and 'content' string fields`,
        rateLimitHeaders
      );
    }
    const validRoles = ["user", "assistant", "system"];
    if (!validRoles.includes(msg.role)) {
      return badRequest(
        requestId,
        `messages[${i}].role must be one of: ${validRoles.join(", ")}`,
        rateLimitHeaders
      );
    }
  }

  if (body.temperature !== undefined) {
    if (typeof body.temperature !== "number" || isNaN(body.temperature) || !isFinite(body.temperature)) {
      return badRequest(requestId, "temperature must be a finite number", rateLimitHeaders);
    }
    if (body.temperature < 0.0 || body.temperature > 2.0) {
      return badRequest(requestId, "temperature must be between 0.0 and 2.0", rateLimitHeaders);
    }
  }

  if (body.model !== undefined && body.model !== "auto") {
    if (typeof body.model !== "string") {
      return badRequest(requestId, "model must be a string", rateLimitHeaders);
    }
    // Only Gemini models are fully implemented in Phase 4
    const validModels = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash", "gemini-2.0-flash-lite"];
    if (!validModels.includes(body.model)) {
      return badRequest(
        requestId,
        `model must be one of: ${validModels.join(", ")}, or omitted for auto-routing`,
        rateLimitHeaders
      );
    }
  }

  // ===== Step 6: PII Scrubbing (AD-5) =====
  const { sanitizedMessages, piiDetected, piiCount } = sanitizeMessages(
    body.messages
  );

  if (piiDetected) {
    console.log(
      `🛡️ [PII] Request ${requestId.substring(0, 8)}... — scrubbed ${piiCount} PII instance(s)`
    );
  }

  // ===== Step 7: Prompt Cache Check (AD-7) =====
  const cacheKey = generateCacheKey(
    body.model ?? "auto",
    sanitizedMessages,
    body.temperature
  );

  const cached = await getCachedResponse(cacheKey);

  if (cached) {
    // Log the cache hit asynchronously
    logUsageAsync({
      requestId,
      tenantId: auth.tenantId,
      result: {
        requestId,
        completion: cached.completion,
        provider: cached.provider,
        model: cached.model,
        routingReason: "cache_hit",
        failoverUsed: false,
        latencyMs: 0,
        providerStatusCode: 200,
        promptTokens: cached.promptTokens,
        completionTokens: cached.completionTokens,
        isComplete: true,
      },
      cacheHit: true,
      routingReason: "cache_hit",
    });

    return Response.json(
      {
        choices: [
          {
            message: { role: "assistant", content: cached.completion },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: cached.promptTokens,
          completion_tokens: cached.completionTokens,
        },
      },
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "X-Request-ID": requestId,
          "X-Cache": "HIT",
          "X-AuraGate-Provider": cached.provider,
          "X-AuraGate-Model": cached.model,
          "X-AuraGate-Failover": "false",
          "X-RateLimit-Limit": rateLimit.limit.toString(),
          "X-RateLimit-Remaining": rateLimit.remaining.toString(),
          "X-RateLimit-Reset": rateLimit.resetMs.toString(),
        },
      }
    );
  }

  // ===== Step 8: Cost Routing (AD-4) =====
  const routeDecision = selectProvider(sanitizedMessages, body.model);

  // ===== Step 9: Resolve Provider from Registry (AD-3) =====
  let provider;
  try {
    provider = getProvider(routeDecision.providerName);
  } catch {
    return providerError(
      requestId,
      `Provider "${routeDecision.providerName}" is not available`,
      rateLimitHeaders
    );
  }

  // Resolve API key based on the selected provider
  const apiKey =
    routeDecision.providerName === "groq"
      ? process.env.GROQ_API_KEY
      : process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return providerError(
      requestId,
      `API key for provider "${routeDecision.providerName}" is not configured. Check .env`,
      rateLimitHeaders
    );
  }

  // Build provider configs with env-based timeouts (AD-12)
  let primaryTimeoutMs = parseInt(
    process.env.PROXY_TIMEOUT_MS || "4000",
    10
  );
  if (isNaN(primaryTimeoutMs) || primaryTimeoutMs <= 0) {
    primaryTimeoutMs = 4000;
  }

  let fallbackTimeoutMs = parseInt(
    process.env.PROXY_FALLBACK_TIMEOUT_MS || "8000",
    10
  );
  if (isNaN(fallbackTimeoutMs) || fallbackTimeoutMs <= 0) {
    fallbackTimeoutMs = 8000;
  }

  const primaryConfig: ProviderConfig = {
    provider,
    model: routeDecision.model,
    apiKey,
    timeoutMs: primaryTimeoutMs,
  };

  // Fallback: always fall back to Gemini Flash (safe, cheap, always available)
  const geminiProvider = getProvider("gemini");
  const geminiApiKey = process.env.GEMINI_API_KEY || "";
  const fallbackModel = process.env.COST_ROUTING_CHEAP_MODEL || "gemini-2.5-flash";

  const fallbackConfig: ProviderConfig = {
    provider: geminiProvider,
    model: fallbackModel,
    apiKey: geminiApiKey,
    timeoutMs: fallbackTimeoutMs,
  };

  // ===== Step 10: Stream to LLM with Failover (AD-6) =====
  const stream = createProxyStream(
    requestId,
    sanitizedMessages,
    primaryConfig,
    fallbackConfig,
    routeDecision.routingReason,
    (result: StreamResult) => {
      // ----- onComplete callback (non-blocking) -----

      // Cache the response with provider/model metadata (AD-7)
      if (result.completion && result.isComplete === true) {
        setCachedResponse(cacheKey, {
          completion: result.completion,
          model: result.model,
          provider: result.provider,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          cachedAt: Date.now(),
        }).catch((err: Error) => {
          console.error(
            `🔴 [Cache] Failed to cache response for ${requestId.substring(0, 8)}...:`,
            err.message
          );
        });
      }

      // Log usage asynchronously (AD-8)
      logUsageAsync({
        requestId,
        tenantId: auth.tenantId,
        result,
        cacheHit: false,
        routingReason: result.routingReason,
        queryType: routeDecision.queryType,
        complexityScore: routeDecision.complexityScore,
      });
    },
    body.temperature
  );

  // ===== Return SSE Response =====
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Request-ID": requestId,
      "X-Cache": "MISS",
      "X-AuraGate-Provider": routeDecision.providerName,
      "X-AuraGate-Model": routeDecision.model,
      "X-AuraGate-Failover": "false",
      "X-RateLimit-Limit": rateLimit.limit.toString(),
      "X-RateLimit-Remaining": rateLimit.remaining.toString(),
      "X-RateLimit-Reset": rateLimit.resetMs.toString(),
    },
  });
}
