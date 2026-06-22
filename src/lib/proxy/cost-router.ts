// =============================================================================
// AuraGate — Multi-Model Cost Router (Phase 6)
// =============================================================================
// Purpose:
//   Determines which LLM model to use using a multi-signal scoring function.
//   Routes between Gemini Flash (simple), Groq Llama 3.3 (coding), and
//   Gemini Pro (complex).
//
// Signals:
//   - Code blocks (highest confidence)
//   - Code keywords
//   - Token length bands
//   - Complexity vocabulary
//   - Question depth
//
// Returns RouteDecision consumed by stream-handler.ts.
// =============================================================================

import type { Message, RouteDecision, RoutingReason } from "./providers/types";

const SIGNAL_WEIGHTS = {
  CODE_BLOCK:          40,  // ```...``` present
  CODE_KEYWORDS:        5,  // per keyword match, max 25
  TOKENS_OVER_300:     10,  // estimated tokens 300-600
  TOKENS_OVER_600:     20,  // estimated tokens > 600
  COMPLEXITY_KEYWORDS:  8,  // per keyword match, max 24
  QUESTION_DEPTH:       5,  // multiple "?" or "explain why/how"
};

const CODE_KEYWORDS = [
  "function", "class", "import", "export", "const", "let", "var",
  "async", "await", "return", "interface", "type ", "enum",
  "sql", "query", "bug", "error", "exception", "debug", "fix",
  "typescript", "javascript", "python", "rust", "golang", "react",
  "api", "endpoint", "http", "rest", "graphql", "dockerfile",
];

const COMPLEXITY_KEYWORDS = [
  "architecture", "design", "tradeoff", "compare", "analyze",
  "explain", "difference between", "how does", "why does",
  "system design", "scalability", "performance", "optimize",
  "pros and cons", "best practice", "deep dive", "in detail",
];

export function selectProvider(
  messages: Message[],
  requestedModel?: string
): RouteDecision {
  const fullText = messages
    .filter(m => m.role === "user")
    .map(m => m.content)
    .join("\n")
    .toLowerCase();

  const estimatedTokens = Math.ceil(fullText.length / 4);
  
  if (requestedModel) {
    return {
      providerName: "gemini",
      model: requestedModel,
      estimatedTokens,
      routingReason: "user_specified",
      queryType: "simple",
      complexityScore: 0,
    };
  }

  let score = 0;

  // Signal 1: Code blocks
  const hasCodeBlock = /```[\s\S]*?```/.test(fullText);
  if (hasCodeBlock) score += SIGNAL_WEIGHTS.CODE_BLOCK;

  // Signal 2: Code keywords
  const codeKeywordMatches = CODE_KEYWORDS.filter((kw) =>
    fullText.includes(kw)
  ).length;
  score += Math.min(codeKeywordMatches * SIGNAL_WEIGHTS.CODE_KEYWORDS, 25);

  // Signal 3: Token count bands
  if (estimatedTokens > 600) score += SIGNAL_WEIGHTS.TOKENS_OVER_600;
  else if (estimatedTokens > 300) score += SIGNAL_WEIGHTS.TOKENS_OVER_300;

  // Signal 4: Complexity keywords
  const complexityMatches = COMPLEXITY_KEYWORDS.filter((kw) =>
    fullText.includes(kw)
  ).length;
  score += Math.min(complexityMatches * SIGNAL_WEIGHTS.COMPLEXITY_KEYWORDS, 24);

  // Signal 5: Question depth
  const questionMarks = (fullText.match(/\?/g) || []).length;
  if (questionMarks >= 3) score += SIGNAL_WEIGHTS.QUESTION_DEPTH;

  // --- Routing Decision ---
  const isCoding = hasCodeBlock || codeKeywordMatches >= 3;

  if (isCoding) {
    return {
      providerName: "groq",
      model: "llama-3.3-70b-versatile",
      estimatedTokens,
      queryType: "coding",
      complexityScore: score,
      routingReason: hasCodeBlock ? "code_block_detected" : "code_keywords",
    };
  }

  if (score >= 30) {
    return {
      providerName: "gemini",
      model: "gemini-2.5-pro", // or gemini-1.5-pro based on what's configured
      estimatedTokens,
      queryType: "complex",
      complexityScore: score,
      routingReason: "complexity_score_high",
    };
  }

  return {
    providerName: "gemini",
    model: "gemini-2.5-flash", // or gemini-1.5-flash
    estimatedTokens,
    queryType: "simple",
    complexityScore: score,
    routingReason: "default_simple",
  };
}
