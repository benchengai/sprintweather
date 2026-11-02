/** Structured-output calls to OpenAI's Responses API with a strict JSON schema.
 *
 * Every LLM step goes through a `JsonCaller`: a system prompt, a user prompt and
 * a schema in, the raw JSON text and usage metadata out. Callers validate the
 * result and do all trust-critical work deterministically. Tests inject a stub
 * caller, so nothing in the test suite reaches the network.
 */

import OpenAI from "openai";

import { costUsd } from "./pricing";

export interface CallMeta {
  model: string;
  requestId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  latencyS: number;
  costUsd: number | null;
}

export interface JsonRequest {
  system: string;
  prompt: string;
  schema: Record<string, unknown>;
  name: string;
}

export type JsonCaller = (req: JsonRequest) => Promise<{ text: string; meta: CallMeta }>;

export class LLMError extends Error {}

/** A spending cap shared by every call in one process. */
export class Budget {
  constructor(
    public limitUsd: number,
    public spentUsd = 0,
  ) {}
  check(): void {
    if (this.spentUsd >= this.limitUsd) {
      throw new LLMError(`budget reached: $${this.spentUsd.toFixed(4)} of $${this.limitUsd.toFixed(2)} spent`);
    }
  }
  add(cost: number | null): void {
    this.spentUsd += cost ?? 0;
  }
}

export function openaiCaller(model: string, options: { budget?: Budget; onCall?: (meta: CallMeta) => void } = {}): JsonCaller {
  const client = new OpenAI();
  return async ({ system, prompt, schema, name }) => {
    options.budget?.check();
    const started = performance.now();
    const response = await client.responses.create({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      text: { format: { type: "json_schema", name, schema, strict: true } },
    });
    const latencyS = Math.round((performance.now() - started) / 10) / 100;
    if (response.status === "incomplete") throw new LLMError(`response incomplete: ${JSON.stringify(response.incomplete_details)}`);
    for (const item of response.output) {
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type === "refusal") throw new LLMError(`model declined the request (${part.refusal})`);
      }
    }
    const u = response.usage!;
    const cached = u.input_tokens_details?.cached_tokens ?? 0;
    const meta: CallMeta = {
      model: response.model,
      requestId: (response as { _request_id?: string | null })._request_id ?? null,
      inputTokens: u.input_tokens,
      cachedInputTokens: cached,
      outputTokens: u.output_tokens,
      reasoningTokens: u.output_tokens_details?.reasoning_tokens ?? 0,
      latencyS,
      costUsd: costUsd(response.model, u.input_tokens, cached, u.output_tokens),
    };
    options.budget?.add(meta.costUsd);
    options.onCall?.(meta);
    return { text: response.output_text, meta };
  };
}
