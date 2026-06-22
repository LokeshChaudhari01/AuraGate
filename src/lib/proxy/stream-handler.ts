// =============================================================================
// AuraGate — SSE Stream Handler with Pre-First-Byte Failover
// =============================================================================
// Purpose:
//   Manages the full streaming lifecycle: connect to LLM, parse SSE,
//   pipe to client, accumulate response, handle failover (pre-first-byte
//   only), and emit clean errors on mid-stream failures.
//
// Failover Policy (AD-6):
//   - Pre-first-byte: If primary fails BEFORE any chunks reach the client,
//     transparently swap to fallback provider. Client never sees the failure.
//   - Mid-stream: If connection drops AFTER chunks have been piped, emit
//     an SSE error event and close the stream cleanly. NO retry.
//
// Interactions:
//   - Called by route.ts as step 10 of the proxy pipeline.
//   - Uses providers via LLMProvider interface (never imports directly).
//   - Calls onComplete callback with StreamResult for cache write + logging.
//
// Timeouts:
//   All from ProviderConfig.timeoutMs (env vars — AD-12). Zero hardcoded.
// =============================================================================

import type {
  Message,
  ProviderConfig,
  StreamResult,
  RoutingReason,
} from "./providers/types";

// ---------------------------------------------------------------------------
// SSE Parsing Helpers
// ---------------------------------------------------------------------------

/**
 * Extracts text content from a Gemini SSE data line.
 * Gemini format: data: {"candidates":[{"content":{"parts":[{"text":"..."}]}}]}
 *
 * @returns The text content, or null if the line isn't a valid data chunk
 */
function extractGeminiText(dataLine: string): string | null {
  try {
    const json = JSON.parse(dataLine);
    return json?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch {
    return null;
  }
}

/**
 * Extracts text content from an OpenAI-compatible SSE data line.
 * Used by Groq (and any future OpenAI-compatible providers).
 * Format: data: {"choices":[{"delta":{"content":"..."}}]}
 */
function extractOpenAIText(dataLine: string): string | null {
  try {
    const json = JSON.parse(dataLine);
    return json?.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

/**
 * Unified text extractor — tries Gemini format first, then OpenAI.
 * Returns the first non-null result.
 */
function extractText(dataLine: string): string | null {
  return extractGeminiText(dataLine) ?? extractOpenAIText(dataLine);
}

/**
 * Extracts usage metadata from a Gemini SSE data line.
 * Gemini includes usageMetadata in the final chunk.
 */
function extractGeminiTokens(dataLine: string): {
  promptTokens: number;
  completionTokens: number;
} | null {
  try {
    const json = JSON.parse(dataLine);
    const meta = json?.usageMetadata;
    if (meta) {
      return {
        promptTokens: meta.promptTokenCount ?? 0,
        completionTokens: meta.candidatesTokenCount ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts usage metadata from an OpenAI-compatible SSE data line.
 * Groq includes usage in the final chunk when stream_options.include_usage is set.
 * As a fallback we parse from the x_groq usage field.
 */
function extractOpenAITokens(dataLine: string): {
  promptTokens: number;
  completionTokens: number;
} | null {
  try {
    const json = JSON.parse(dataLine);
    const usage = json?.usage ?? json?.x_groq?.usage;
    if (usage) {
      return {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Unified usage extractor — tries Gemini format first, then OpenAI.
 */
function extractUsageMetadata(dataLine: string): {
  promptTokens: number;
  completionTokens: number;
} | null {
  return extractGeminiTokens(dataLine) ?? extractOpenAITokens(dataLine);
}

// ---------------------------------------------------------------------------
// Stream Attempt (single provider)
// ---------------------------------------------------------------------------

interface StreamAttemptResult {
  success: boolean;
  statusCode: number;
  response?: Response;
  error?: string;
}

/**
 * Attempts to connect to a single LLM provider with a timeout.
 * Returns the raw Response on success, or error details on failure.
 * This handles the pre-first-byte phase only.
 */
async function attemptStream(
  config: ProviderConfig,
  messages: Message[],
  temperature?: number
): Promise<StreamAttemptResult> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await config.provider.stream(
      {
        model: config.model,
        messages,
        apiKey: config.apiKey,
        temperature,
      },
      controller.signal
    );

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        statusCode: response.status,
        error: `Provider returned ${response.status}: ${response.statusText}`,
      };
    }

    return { success: true, statusCode: response.status, response };
  } catch (error) {
    clearTimeout(timeoutId);
    const message =
      error instanceof DOMException && error.name === "AbortError"
        ? `Timeout after ${config.timeoutMs}ms`
        : (error as Error).message;

    return { success: false, statusCode: 0, error: message };
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

/**
 * Creates a ReadableStream that pipes LLM responses to the client as SSE.
 *
 * Features:
 *   - Pre-first-byte failover: tries fallback if primary fails before streaming
 *   - Mid-stream error: emits `event: error` SSE signal + closes cleanly
 *   - Response accumulation: builds completion text for cache write
 *   - Usage metadata extraction: captures promptTokens/completionTokens
 *   - onComplete callback: fires with StreamResult for async processing
 *
 * @param requestId - Correlation ID for this request
 * @param messages - The conversation messages (post-PII scrubbing)
 * @param primaryConfig - Primary provider configuration
 * @param fallbackConfig - Fallback provider configuration
 * @param routingReason - Why the primary was selected
 * @param onComplete - Callback fired after stream ends (success or mid-stream error)
 * @param temperature - Optional sampling temperature
 * @returns ReadableStream to be used in the Response
 */
export function createProxyStream(
  requestId: string,
  messages: Message[],
  primaryConfig: ProviderConfig,
  fallbackConfig: ProviderConfig,
  routingReason: RoutingReason,
  onComplete: (result: StreamResult) => void,
  temperature?: number
): ReadableStream<Uint8Array> {
  const startTime = Date.now();

  return new ReadableStream({
    async start(controller) {
      let usedProvider = primaryConfig.provider.name;
      let usedModel = primaryConfig.model;
      let failoverUsed = false;
      let providerStatusCode = 0;
      let completionText = "";
      let promptTokens = 0;
      let completionTokens = 0;
      let actualRoutingReason = routingReason;

      // ----- Phase 1: Connect (with failover) -----
      let attempt = await attemptStream(primaryConfig, messages, temperature);

      if (!attempt.success) {
        console.warn(
          `🟡 [Stream] Primary failed (${primaryConfig.provider.name}/${primaryConfig.model}): ${attempt.error}. Trying fallback...`
        );

        // Try fallback
        attempt = await attemptStream(fallbackConfig, messages, temperature);
        if (!attempt.success) {
          // Both failed — emit error and close
          console.error(
            `🔴 [Stream] Fallback also failed (${fallbackConfig.provider.name}/${fallbackConfig.model}): ${attempt.error}`
          );

          const errorEvent =
            `event: error\ndata: ${JSON.stringify({
              message: "All providers failed. Please retry later.",
              code: "PROVIDER_EXHAUSTED",
              requestId,
            })}\n\n`;
          controller.enqueue(encoder.encode(errorEvent));
          controller.close();

          onComplete({
            requestId,
            completion: "",
            provider: primaryConfig.provider.name,
            model: primaryConfig.model,
            routingReason: actualRoutingReason,
            failoverUsed: true,
            latencyMs: Date.now() - startTime,
            providerStatusCode: attempt.statusCode,
            promptTokens: 0,
            completionTokens: 0,
            isComplete: false,
          });
          return;
        }

        // Fallback succeeded
        failoverUsed = true;
        usedProvider = fallbackConfig.provider.name;
        usedModel = fallbackConfig.model;
        actualRoutingReason = "fallback_provider";
      }

      providerStatusCode = attempt.statusCode;

      // ----- Phase 2: Stream chunks to client -----
      const response = attempt.response!;
      const reader = response.body?.getReader();

      if (!reader) {
        const errorEvent =
          `event: error\ndata: ${JSON.stringify({
            message: "Provider returned empty response body",
            code: "EMPTY_RESPONSE",
            requestId,
          })}\n\n`;
        controller.enqueue(encoder.encode(errorEvent));
        controller.close();
        
        onComplete({
          requestId,
          completion: "",
          provider: usedProvider,
          model: usedModel,
          routingReason: actualRoutingReason,
          failoverUsed,
          latencyMs: Date.now() - startTime,
          providerStatusCode,
          promptTokens: 0,
          completionTokens: 0,
          isComplete: false,
        });
        return;
      }

      const decoder = new TextDecoder();
      let buffer = ""; // Buffer for partial SSE lines

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines (delimited by \n\n)
          const parts = buffer.split("\n");
          buffer = parts.pop() ?? ""; // Keep incomplete line in buffer

          for (const line of parts) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(":")) continue; // Skip empty lines and comments

            if (trimmed.startsWith("data: ")) {
              const dataContent = trimmed.slice(6);

              // Skip [DONE] signal
              if (dataContent === "[DONE]") continue;

              // Extract text content — handles both Gemini and OpenAI (Groq) formats
              const text = extractText(dataContent);
              if (text) {
                completionText += text;

                // Re-encode as SSE for the client (OpenAI-compatible format)
                const clientChunk = `data: ${JSON.stringify({
                  choices: [{ delta: { content: text } }],
                })}\n\n`;
                controller.enqueue(encoder.encode(clientChunk));
              }

              // Extract usage metadata (usually in last chunk)
              const usage = extractUsageMetadata(dataContent);
              if (usage) {
                promptTokens = usage.promptTokens;
                completionTokens = usage.completionTokens;
              }
            }
          }
        }

        // Send [DONE] signal
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();

        // Fire completion callback (non-blocking)
        onComplete({
          requestId,
          completion: completionText,
          provider: usedProvider,
          model: usedModel,
          routingReason: actualRoutingReason,
          failoverUsed,
          latencyMs: Date.now() - startTime,
          providerStatusCode,
          promptTokens,
          completionTokens,
          isComplete: true,
        });
      } catch (error) {
        // Mid-stream error: cancel reader, emit SSE error event, close cleanly (AD-6)
        reader?.cancel().catch(() => {});
        
        console.error(
          `🔴 [Stream] Mid-stream error:`,
          (error as Error).message
        );

        const errorEvent =
          `event: error\ndata: ${JSON.stringify({
            message: "Stream interrupted",
            code: "PROVIDER_STREAM_ERROR",
            requestId,
          })}\n\n`;

        try {
          controller.enqueue(encoder.encode(errorEvent));
          controller.close();
        } catch {
          // Controller may already be closed
        }

        onComplete({
          requestId,
          completion: completionText,
          provider: usedProvider,
          model: usedModel,
          routingReason: actualRoutingReason,
          failoverUsed,
          latencyMs: Date.now() - startTime,
          providerStatusCode,
          promptTokens,
          completionTokens,
          isComplete: false,
        });
      }
    },
  });
}
