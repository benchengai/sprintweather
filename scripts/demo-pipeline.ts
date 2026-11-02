/** Copy the outputs of one saved pipeline run into the demo.
 *
 * The demo never shows hand-written themes or prompts: it shows what the real
 * pipeline produced in a cached evaluation run. This script makes no API call; it
 * reads runs/<...>/<model>/run<r>/s1..s6.json and prompts.json and writes
 * data/demo/themes.json and data/demo/prompts.json, with the run's path as source.
 *
 *   npx tsx scripts/demo-pipeline.ts --from runs/eval/gpt-6-luna/run1
 */

import { existsSync } from "node:fs";

import type { CallMeta } from "../lib/llm/client";
import { toThemeResult, type PipelineResult } from "../lib/themes/pipeline";
import type { PromptResult, ThemeResult } from "../lib/types";
import { arg, readJson, writeJson, type NoteSet } from "./common";

const from = arg("from");
if (!from) throw new Error("usage: --from runs/<dir>/<model>/run<r>");
const model = from.split("/").at(-2)!;
const notes = readJson<NoteSet>("data/synthetic/notes.json");

const themes: ThemeResult[] = [];
for (const scope of notes.scopes) {
  const run = readJson<{ ok: boolean; result?: PipelineResult; calls: CallMeta[] }>(`${from}/${scope.id}.json`);
  if (!run.ok || !run.result) throw new Error(`${from}/${scope.id}.json is a failed run; pick a complete one`);
  const result = toThemeResult(scope.id, scope.notes.length, run.calls[0]?.model ?? model, run.result, from);
  themes.push(result);
}

const prompts: PromptResult[] = [];
const promptFile = `${from}/prompts.json`;
if (existsSync(promptFile)) {
  const run = readJson<{ ok: boolean; sprints: { sprint: string; prompts: PromptResult["prompts"]; meta: CallMeta | null }[] }>(promptFile);
  if (run.ok) {
    for (const s of run.sprints) {
      prompts.push({ sprint: s.sprint, prompts: s.prompts, model: s.meta?.model ?? model, generatedAt: themes[0].generatedAt, costUsd: s.meta?.costUsd ?? null, source: from });
    }
  }
}

writeJson("data/demo/themes.json", themes);
writeJson("data/demo/prompts.json", prompts);
console.log(`demo now shows ${themes.reduce((a, t) => a + t.themes.length, 0)} themes and ${prompts.reduce((a, p) => a + p.prompts.length, 0)} prompts from ${from}`);
