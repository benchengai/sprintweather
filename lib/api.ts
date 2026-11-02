/** Shared plumbing for the local-mode route handlers. */

import { CheckinError } from "./checkin";
import { ConfigError } from "./config";
import { LLMError } from "./llm/client";
import { buildRelease } from "./release";
import { StoreError, openSprint, readyToClose, type StoreData } from "./store";

export const DEFAULT_MODEL = "gpt-6-luna";
export const model = () => process.env.SW_MODEL ?? DEFAULT_MODEL;

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** Expected errors become a 400 with their message; anything else is a 500
 * without details, so no stack trace or store content reaches the client. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof CheckinError || e instanceof StoreError || e instanceof ConfigError) return json({ error: e.message }, 400);
    if (e instanceof LLMError) return json({ error: `model call failed: ${e.message}` }, 502);
    console.error(e);
    return json({ error: "internal error" }, 500);
  }
}

export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = await request.json();
    return typeof b === "object" && b !== null ? (b as Record<string, unknown>) : {};
  } catch {
    throw new StoreError("expected a JSON body");
  }
}

/** What the facilitator page needs. Yes/no flags only: no response or note counts. */
export function facilitatorStatus(data: StoreData) {
  const release = buildRelease(data);
  const open = openSprint(data);
  return {
    k: data.k,
    dimensions: data.dimensions,
    model: model(),
    apiKey: Boolean(process.env.OPENAI_API_KEY),
    open: open ? { id: open.id, label: open.label, ready: readyToClose(data), codesIssued: data.codes[open.id]?.issued.length ?? 0 } : null,
    closed: release.sprints
      .filter((s) => s.status !== "open")
      .map((s) => ({
        id: s.id,
        label: s.label,
        released: s.status === "released",
        hasNotes: data.responses.some((r) => r.sprint === s.id && r.note),
        hasThemes: data.themes.some((t) => t.sprint === s.id),
        hasPrompts: data.prompts.some((p) => p.sprint === s.id),
      })),
    actions: data.actions,
  };
}

export type FacilitatorStatus = ReturnType<typeof facilitatorStatus>;
