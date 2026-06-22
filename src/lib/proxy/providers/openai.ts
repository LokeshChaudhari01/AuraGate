// =============================================================================
// AuraGate — OpenAI Provider (Stub)
// =============================================================================
// Purpose:
//   Proves the provider abstraction layer is extensible. Implements the
//   LLMProvider interface but throws on invocation.
//
// To fully implement:
//   1. Add OPENAI_API_KEY to .env
//   2. Implement the stream() method with OpenAI's chat completions API
//   3. Uncomment the registration in providers/registry.ts
//   4. Zero changes needed in route.ts or stream-handler.ts
// =============================================================================

import type { LLMProvider, StreamRequest } from "./types";

export const openaiProvider: LLMProvider = {
  name: "openai",

  async stream(_request: StreamRequest, _signal: AbortSignal): Promise<Response> {
    throw new Error(
      "[AuraGate] OpenAI provider is not yet implemented. " +
        "To enable: implement stream() in src/lib/proxy/providers/openai.ts " +
        "and register in providers/registry.ts."
    );
  },
};
