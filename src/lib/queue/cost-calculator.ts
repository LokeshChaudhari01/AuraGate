// Gemini pricing (per 1M tokens):
interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  "gemini-2.0-flash":      { inputPer1M: 0.075, outputPer1M: 0.30 },
  "gemini-2.0-flash-lite": { inputPer1M: 0.075, outputPer1M: 0.30 },
  "gemini-1.5-flash":      { inputPer1M: 0.075, outputPer1M: 0.30 },
  "gemini-1.5-pro":        { inputPer1M: 1.25,  outputPer1M: 5.00 },
};

const DEFAULT_PRICING: ModelPricing = { inputPer1M: 0.075, outputPer1M: 0.30 };

export function calculateCost(
  model: string,
  promptTokens: number,
  completionTokens: number
): string {
  const pricing = PRICING[model] ?? DEFAULT_PRICING;

  const inputCost  = (promptTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (completionTokens / 1_000_000) * pricing.outputPer1M;
  const totalCost  = inputCost + outputCost;

  return totalCost.toFixed(4);
}
