import { body, handle, json, model } from "@/lib/api";
import { LLMError, openaiCaller } from "@/lib/llm/client";
import { buildRelease } from "@/lib/release";
import { StoreError, mutate, notesFor, readStore, saveThemes } from "@/lib/store";
import { extractThemes, toThemeResult } from "@/lib/themes/pipeline";

/** Generate themes for a closed, released sprint, store them, delete its notes. */
export async function POST(request: Request) {
  return handle(async () => {
    const { sprintId } = await body(request);
    const data = await readStore();
    const sprint = buildRelease(data).sprints.find((s) => s.id === sprintId);
    if (!sprint || sprint.status !== "released") throw new StoreError("themes need a closed sprint with at least k responses");
    if (data.themes.some((t) => t.sprint === sprintId)) throw new StoreError("themes for this sprint already exist");
    if (!process.env.OPENAI_API_KEY) throw new LLMError("set OPENAI_API_KEY in .env.local to generate themes");
    const notes = notesFor(data, sprint.id);
    const result = await extractThemes(notes, { k: sprint.k!, call: openaiCaller(model()) });
    const stored = toThemeResult(sprint.id, notes.length, model(), result);
    await mutate((d) => saveThemes(d, stored));
    return json({ themes: stored.themes.length });
  });
}
