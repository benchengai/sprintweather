/** Published per-token prices, used to report what each LLM call costs.
 *
 * USD per million tokens: [input, cached input, output], standard tier.
 */

export const AS_OF = "2026-11-01";
export const SOURCE = "https://developers.openai.com/api/docs/pricing";

export const PRICES: Record<string, [number, number, number]> = {
  "gpt-6.1-sol": [2.0, 0.1, 10.0],
  "gpt-6.1-terra": [1.0, 0.05, 5.0],
  "gpt-6-luna": [0.1, 0.01, 0.5],
};

/** Exact id, or a dated snapshot of a listed id (gpt-6.1-terra-2026-...). */
export function price(model: string): [number, number, number] | null {
  if (model in PRICES) return PRICES[model];
  const hit = Object.entries(PRICES).find(([m]) => model.startsWith(`${m}-`));
  return hit ? hit[1] : null;
}

export function costUsd(model: string, inputTokens: number, cachedInputTokens: number, outputTokens: number): number | null {
  const p = price(model);
  if (!p) return null;
  return ((inputTokens - cachedInputTokens) * p[0] + cachedInputTokens * p[1] + outputTokens * p[2]) / 1_000_000;
}
