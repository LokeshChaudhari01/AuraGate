// =============================================================================
// AuraGate — Provider Registry
// =============================================================================
// Purpose:
//   Maps provider names to their LLMProvider implementations.
//   route.ts and stream-handler.ts import ONLY from this registry —
//   they never import a specific provider directly (AD-3, AD-13).
//
// To add a new provider:
//   1. Implement the LLMProvider interface in providers/<name>.ts
//   2. Import and register it below
//   3. Zero changes to route.ts or stream-handler.ts
// =============================================================================

import type { LLMProvider } from "./types";
import { geminiProvider } from "./gemini";
import { groqProvider } from "./groq";
// import { openaiProvider } from './openai';  // Uncomment when implemented

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const providers: Record<string, LLMProvider> = {
  gemini: geminiProvider,
  groq: groqProvider,
  // openai: openaiProvider,
};

/**
 * Retrieves a provider implementation by name.
 *
 * @param name - The provider name (e.g., "gemini", "openai")
 * @returns The LLMProvider implementation
 * @throws Error if the provider is not registered
 */
export function getProvider(name: string): LLMProvider {
  const provider = providers[name];
  if (!provider) {
    throw new Error(
      `[AuraGate] Unknown provider: "${name}". ` +
        `Available providers: ${Object.keys(providers).join(", ")}`
    );
  }
  return provider;
}

/**
 * Returns a list of all registered provider names.
 * Used for validation and logging.
 */
export function getAvailableProviders(): string[] {
  return Object.keys(providers);
}
