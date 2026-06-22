// =============================================================================
// AuraGate — Gemini Provider (Full Implementation)
// =============================================================================
// Purpose:
//   Implements the LLMProvider interface for Google's Gemini API.
//   Handles message format conversion and streaming via SSE.
//
// Interactions:
//   - Registered in providers/registry.ts
//   - Called by stream-handler.ts via the LLMProvider interface
//   - Never imported directly by route.ts (AD-3, AD-13)
//
// API:
//   POST https://generativelanguage.googleapis.com/v1beta/models/{model}
//        :streamGenerateContent?alt=sse&key={API_KEY}
//
// Message Format Conversion:
//   AuraGate: { role: "user", content: "Hello" }
//   Gemini:   { role: "user", parts: [{ text: "Hello" }] }
//   System messages → systemInstruction at top level (not in contents)
// =============================================================================

import type { LLMProvider, StreamRequest, Message } from "./types";

// ---------------------------------------------------------------------------
// Message Format Conversion
// ---------------------------------------------------------------------------

interface GeminiPart {
  text: string;
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiRequestBody {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
  generationConfig?: {
    temperature?: number;
  };
}

/**
 * Converts AuraGate's OpenAI-compatible messages to Gemini's format.
 *
 * Key differences:
 *   - Gemini uses "model" instead of "assistant" for the role
 *   - Gemini wraps text in a parts[] array
 *   - System messages go into systemInstruction, not contents
 */
function convertMessages(messages: Message[]): {
  contents: GeminiContent[];
  systemInstruction?: { parts: GeminiPart[] };
} {
  const systemMessages = messages.filter((m) => m.role === "system");
  const conversationMessages = messages.filter((m) => m.role !== "system");

  const contents: GeminiContent[] = conversationMessages.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content }],
  }));

  let systemInstruction: { parts: GeminiPart[] } | undefined;
  if (systemMessages.length > 0) {
    systemInstruction = {
      parts: systemMessages.map((m) => ({ text: m.content })),
    };
  }

  return { contents, systemInstruction };
}

/**
 * Constructs the full Gemini streaming endpoint URL.
 */
function buildEndpoint(model: string, apiKey: string): string {
  return (
    `https://generativelanguage.googleapis.com/v1beta/models/${model}` +
    `:streamGenerateContent?alt=sse&key=${apiKey}`
  );
}

// ---------------------------------------------------------------------------
// Provider Implementation
// ---------------------------------------------------------------------------

export const geminiProvider: LLMProvider = {
  name: "gemini",

  async stream(request: StreamRequest, signal: AbortSignal): Promise<Response> {
    const { contents, systemInstruction } = convertMessages(request.messages);

    const body: GeminiRequestBody = {
      contents,
    };

    if (systemInstruction) {
      body.systemInstruction = systemInstruction;
    }

    if (request.temperature !== undefined) {
      body.generationConfig = { temperature: request.temperature };
    }

    const endpoint = buildEndpoint(request.model, request.apiKey);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    return response;
  },
};
