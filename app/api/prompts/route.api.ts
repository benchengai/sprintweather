import { body, handle, json, model } from "@/lib/api";
import { LLMError, openaiCaller } from "@/lib/llm/client";
import { buildRelease } from "@/lib/release";
import { retroPrompts } from "@/lib/retro";
import { StoreError, mutate, readStore, savePrompts } from "@/lib/store";

/** Retro prompts from the release only (team-level figures, themes, action effects). */
export async function POST(request: Request) {
  return handle(async () => {
    const { sprintId } = await body(request);
    const release = buildRelease(await readStore());
    const sprint = release.sprints.find((s) => s.id === sprintId);
    if (!sprint || sprint.status !== "released") throw new StoreError("prompts need a closed sprint with at least k responses");
    if (!process.env.OPENAI_API_KEY) throw new LLMError("set OPENAI_API_KEY in .env.local to generate prompts");
    const { prompts, meta } = await retroPrompts(release, sprint.id, openaiCaller(model()));
    await mutate((d) =>
      savePrompts(d, { sprint: sprint.id, prompts, model: model(), generatedAt: new Date().toISOString().slice(0, 10), costUsd: meta?.costUsd ?? null }),
    );
    return json({ prompts: prompts.length });
  });
}
