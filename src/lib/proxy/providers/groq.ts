// =============================================================================
// AuraGate — Groq Provider (Full Implementation)
// =============================================================================
// Purpose:
//   Implements the LLMProvider interface for Groq's API using their
//   OpenAI-compatible chat completions endpoint with SSE streaming.
//
// API:
//   POST https://api.groq.com/openai/v1/chat/completions
//   Auth: Authorization: Bearer $GROQ_API_KEY
//
// Models (Phase 6):
//   llama-3.3-70b-versatile → routed for coding/debugging queries
// =============================================================================

import type { LLMProvider, StreamRequest } from "./types";

export const groqProvider: LLMProvider = {
  name: "groq",

  async stream(request: StreamRequest, signal: AbortSignal): Promise<Response> {
    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature ?? 0.7,
      stream: true,
    };

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${request.apiKey}`,
      },
      body: JSON.stringify(body),
      signal,
    });

    return response;
  },
};

