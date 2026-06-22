// =============================================================================
// AuraGate — Standardized Error Responses
// =============================================================================
// Purpose:
//   All error responses follow OpenAI's error format with an added requestId
//   for end-to-end correlation (AD-9, AD-14).
//
// Format:
//   { error: { message, type, code, requestId } }
//
// Every error response includes X-Request-ID header.
// =============================================================================

import type { RateLimitResult } from "@/lib/redis/types";

/**
 * Creates a standardized JSON error response.
 * All error responses in AuraGate go through this function.
 */
export function errorResponse(
  status: number,
  message: string,
  type: string,
  requestId: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return Response.json(
    {
      error: {
        message,
        type,
        code: status.toString(),
        requestId,
      },
    },
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "X-Request-ID": requestId,
        ...extraHeaders,
      },
    }
  );
}

// ---------------------------------------------------------------------------
// Factory Functions — Pre-built error constructors
// ---------------------------------------------------------------------------

/** 400 — Malformed request body, missing fields, etc. */
export function badRequest(requestId: string, message: string, extraHeaders?: Record<string, string>): Response {
  return errorResponse(400, message, "invalid_request_error", requestId, extraHeaders);
}

/** 401 — Missing, invalid, or revoked API key / inactive tenant. */
export function unauthorized(requestId: string): Response {
  return errorResponse(
    401,
    "Invalid or missing API key",
    "authentication_error",
    requestId
  );
}

/** 402 — Tenant has exceeded their configured budget. */
export function budgetExceeded(requestId: string): Response {
  return errorResponse(
    402,
    "Tenant budget exceeded. Contact your administrator to increase the budget.",
    "budget_error",
    requestId
  );
}

/** 429 — Rate limit exceeded. Includes Retry-After and X-RateLimit-* headers. */
export function rateLimited(requestId: string, rateLimit: RateLimitResult): Response {
  const retryAfterSeconds = Math.ceil((rateLimit.resetMs - Date.now()) / 1000);

  return errorResponse(
    429, 
    `Rate limit exceeded. Retry after ${retryAfterSeconds} seconds.`, 
    "rate_limit_error", 
    requestId,
    {
      "Retry-After": Math.max(retryAfterSeconds, 1).toString(),
      "X-RateLimit-Limit": rateLimit.limit.toString(),
      "X-RateLimit-Remaining": rateLimit.remaining.toString(),
      "X-RateLimit-Reset": rateLimit.resetMs.toString(),
    }
  );
}

/** 502 — Upstream LLM provider returned an error or is unreachable. */
export function providerError(requestId: string, message: string, extraHeaders?: Record<string, string>): Response {
  return errorResponse(502, message, "provider_error", requestId, extraHeaders);
}
