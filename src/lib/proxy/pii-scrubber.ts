// =============================================================================
// AuraGate — PII Scrubber (Compiled Regex Constants)
// =============================================================================
// Purpose:
//   Sanitizes user message content before external transmission to LLM
//   providers. Detects and redacts: emails, API keys, passwords, secrets,
//   tokens. Does NOT detect SSN or credit cards (AD-5, user directive).
//
// Interactions:
//   - Called by route.ts as step 6 of the proxy pipeline.
//   - Receives messages from the parsed request body.
//   - Returns ScrubResult with sanitized messages + metadata.
//
// Performance:
//   All regex patterns are compiled as module-level constants (AD-5).
//   This prevents regex object re-creation per request under high
//   concurrency — zero per-request allocation overhead.
//
// Scope:
//   Applied to user message content ONLY. System prompts are controlled
//   by the gateway (not by end users) and are not scrubbed.
// =============================================================================

import type { Message, ScrubResult } from "./providers/types";

// ---------------------------------------------------------------------------
// Compiled Regex Constants (module-level — AD-5)
// ---------------------------------------------------------------------------
// These are created ONCE at module load time, not per-request.
// The 'gi' flags: global (all matches) + case-insensitive.
// ---------------------------------------------------------------------------

/**
 * Email addresses: user@domain.tld
 * Conservative pattern — requires @ and at least one dot in domain.
 */
const EMAIL_REGEX = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/gi;

/**
 * Secrets, API keys, passwords, tokens in key=value or key: value format.
 * Matches: api_key=sk_12345, password: hunter2, SECRET=abc, token: xyz
 * Case-insensitive to catch API_KEY, Api-Key, apiKey, etc.
 */
const SECRET_REGEX =
  /(?:api[_-]?key|password|passwd|secret|token|auth[_-]?token|access[_-]?key|private[_-]?key)\s*[=:]\s*\S+/gi;

/**
 * Mapping from regex to its PII type tag for replacement strings.
 * Order matters — more specific patterns should come first.
 */
const PII_PATTERNS: ReadonlyArray<{
  regex: RegExp;
  type: string;
}> = [
  { regex: SECRET_REGEX, type: "SECRET" },
  { regex: EMAIL_REGEX, type: "EMAIL" },
] as const;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Sanitizes messages by detecting and redacting PII in user content.
 *
 * Only user messages are scrubbed. System and assistant messages are
 * passed through unchanged — system prompts are gateway-controlled,
 * and assistant messages are LLM-generated.
 *
 * @param messages - The raw conversation messages from the request body
 * @returns ScrubResult with sanitized messages and PII detection metadata
 */
export function sanitizeMessages(messages: Message[]): ScrubResult {
  let totalPiiCount = 0;

  const sanitizedMessages = messages.map((msg) => {
    // Only scrub user messages
    if (msg.role !== "user") {
      return msg;
    }

    let content = msg.content;
    let messageHits = 0;

    for (const pattern of PII_PATTERNS) {
      // Reset lastIndex for global regex (stateful in JS)
      pattern.regex.lastIndex = 0;

      const matches = content.match(pattern.regex);
      if (matches) {
        messageHits += matches.length;
        // Reset again before replace (global regex is stateful)
        pattern.regex.lastIndex = 0;
        content = content.replace(
          pattern.regex,
          `[PII_REDACTED:${pattern.type}]`
        );
      }
    }

    totalPiiCount += messageHits;

    if (messageHits === 0) {
      return msg; // No changes — return original reference
    }

    return { ...msg, content };
  });

  return {
    sanitizedMessages,
    piiDetected: totalPiiCount > 0,
    piiCount: totalPiiCount,
  };
}
