/** Benchmark the theme step and retro prompts across models.
 *
 * For each model and run: extract themes from every scope (six demo sprints =
 * development set, two held-out teams), then generate retro prompts for each demo
 * sprint from a release that includes that run's themes. Each finished scope is
 * cached under runs/eval/<model>/run<r>/, so an interrupted benchmark resumes
 * where it stopped. A failed call is recorded and counted, not retried. Every call
 * is appended to runs/ledger.jsonl, and the run stops once the budget is spent.
 *
 *   npx tsx scripts/eval-themes.ts --env-file <path> [--models a,b] [--runs 3] [--scopes s1,h1] [--sets dev]
 *     [--budget 1.9] [--out runs/eval] [--report docs/eval/results.md] [--score-only]
 *
 * --score-only scores whatever is cached and never calls the API.
 */

import { existsSync } from "node:fs";

import { Budget, LLMError, openaiCaller, type CallMeta } from "../lib/llm/client";
import { AS_OF } from "../lib/llm/pricing";
import { buildRelease, type Dataset } from "../lib/release";
import { retroPrompts } from "../lib/retro";
import { extractThemes, toThemeResult, type PipelineResult } from "../lib/themes/pipeline";
import type { PromptResult } from "../lib/types";
import { arg, ledgerTotal, loadEnv, pool, readJson, recordCall, seededInt, writeJson, type NoteSet, type Scope } from "./common";
import { scorePrompts, scoreScope, type ScopeScore } from "./score";

const VERSION = 1;
const MODELS = (arg("models") ?? "gpt-6-luna,gpt-6.1-terra").split(",");
const RUNS = Number(arg("runs") ?? 3);
const OUT = arg("out") ?? "runs/eval";
const ONLY = arg("scopes")?.split(",");
const SETS = arg("sets")?.split(",");
const BUDGET = Number(arg("budget") ?? 1.9);
const SCORE_ONLY = process.argv.includes("--score-only");
const REPORT = arg("report");
loadEnv(arg("env-file") ?? ".env");

const devSet = readJson<NoteSet>("data/synthetic/notes.json");
const devTeams = readJson<NoteSet>("data/eval/dev-teams.json");
const heldOut = readJson<NoteSet>("data/eval/heldout.json");
const K = devSet.k;
const scopes: (Scope & { set: "dev" | "held-out" })[] = [
  ...devSet.scopes.map((s) => ({ ...s, set: "dev" as const })),
  ...devTeams.scopes.map((s) => ({ ...s, set: "dev" as const })),
  ...heldOut.scopes.map((s) => ({ ...s, set: "held-out" as const })),
].filter((s) => (!ONLY || ONLY.includes(s.id)) && (!SETS || SETS.includes(s.set)));
const FILTERED = ONLY !== undefined || SETS !== undefined;
const RUN_PROMPTS = devSet.scopes.every((d) => scopes.some((s) => s.id === d.id));
const dataset = readJson<Dataset>("data/demo/dataset.json");
const budget = new Budget(BUDGET, ledgerTotal());

interface ThemeRun {
  version: number;
  ok: boolean;
  error?: string;
  result?: PipelineResult;
  calls: CallMeta[];
}

interface PromptRun {
  version: number;
  ok: boolean;
  error?: string;
  sprints: { sprint: string; prompts: PromptResult["prompts"]; meta: CallMeta | null }[];
}

function caller(model: string, context: Record<string, unknown>) {
  return openaiCaller(model, { budget, onCall: (meta) => recordCall(meta, context) });
}

async function themeRun(model: string, run: number, scope: Scope): Promise<ThemeRun> {
  const file = `${OUT}/${model}/run${run}/${scope.id}.json`;
  if (existsSync(file)) return readJson<ThemeRun>(file);
  if (SCORE_ONLY) return { version: VERSION, ok: false, error: "not run", calls: [] };
  const calls: CallMeta[] = [];
  const call = caller(model, { script: "eval", model, run, scope: scope.id });
  const tracked: typeof call = async (req) => {
    const out = await call(req);
    calls.push(out.meta);
    return out;
  };
  let out: ThemeRun;
  try {
    const result = await extractThemes(scope.notes.map((n) => n.text), { k: K, call: tracked, random: seededInt(scope.id, run) });
    out = { version: VERSION, ok: true, result, calls };
  } catch (e) {
    if (e instanceof LLMError && e.message.startsWith("budget")) throw e;
    out = { version: VERSION, ok: false, error: String(e).slice(0, 500), calls };
  }
  writeJson(file, out);
  console.log(`  ${model} run ${run} ${scope.id}: ${out.ok ? `${out.result!.themes.length} themes` : `FAILED ${out.error}`}`);
  return out;
}

async function promptRun(model: string, run: number, themes: Map<string, ThemeRun>): Promise<PromptRun> {
  const file = `${OUT}/${model}/run${run}/prompts.json`;
  if (existsSync(file)) return readJson<PromptRun>(file);
  if (SCORE_ONLY) return { version: VERSION, ok: false, error: "not run", sprints: [] };
  const themeResults = devSet.scopes
    .filter((s) => themes.get(s.id)?.ok)
    .map((s) => toThemeResult(s.id, s.notes.length, model, themes.get(s.id)!.result!, `${OUT}/${model}/run${run}`));
  const release = buildRelease({ ...dataset, themes: themeResults });
  const call = caller(model, { script: "eval-prompts", model, run });
  let out: PromptRun;
  try {
    const sprints = await pool(release.sprints.filter((s) => s.status === "released"), 3, async (s) => {
      const { prompts, meta } = await retroPrompts(release, s.id, call);
      return { sprint: s.id, prompts, meta };
    });
    out = { version: VERSION, ok: true, sprints };
  } catch (e) {
    if (e instanceof LLMError && e.message.startsWith("budget")) throw e;
    out = { version: VERSION, ok: false, error: String(e).slice(0, 500), sprints: [] };
  }
  writeJson(file, out);
  console.log(`  ${model} run ${run} prompts: ${out.ok ? "ok" : `FAILED ${out.error}`}`);
  return out;
}

interface RunRow {
  model: string;
  run: number;
  failedScopes: string[];
  recallDev: number;
  recallHeldOut: number;
  themes: number;
  violations: number;
  belowKSurfaced: number;
  spurious: number;
  duplicates: number;
  supportPrecision: number;
  markerLeaks: number;
  markerLeaksBeforeGuard: number;
  maxSharedRun: number;
  flagged: number;
  rewritten: number;
  withheldWording: number;
  prompts: number;
  promptSubgroupMentions: number;
  promptMarkerLeaks: number;
  themeCostUsd: number;
  promptCostUsd: number;
  costUsd: number;
  latencyS: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  scopes: ScopeScore[];
}

function rowFor(model: string, run: number, themes: Map<string, ThemeRun>, prompts: PromptRun): RunRow {
  const scores = scopes.filter((s) => themes.get(s.id)?.ok).map((s) => ({ set: s.set, score: scoreScope(s, K, themes.get(s.id)!.result!) }));
  const sum = (f: (x: ScopeScore) => number, set?: string) => scores.filter((s) => !set || s.set === set).reduce((a, s) => a + f(s.score), 0);
  // NaN when the set was not run, so the report says so instead of showing 0.
  const recall = (set: string) => sum((x) => x.recalled.length, set) / sum((x) => x.plantedAtK, set);
  const allCalls = [...themes.values()].flatMap((t) => t.calls);
  const promptCalls = prompts.sprints.map((p) => p.meta).filter(Boolean) as CallMeta[];
  const markers = devSet.scopes.flatMap((s) => s.notes.flatMap((n) => n.markers ?? []));
  const p = prompts.sprints.map((s) => scorePrompts(s.prompts, markers));
  const cost = (cs: CallMeta[]) => cs.reduce((a, c) => a + (c.costUsd ?? 0), 0);
  return {
    model,
    run,
    failedScopes: scopes.filter((s) => !themes.get(s.id)?.ok).map((s) => s.id),
    recallDev: recall("dev"),
    recallHeldOut: recall("held-out"),
    themes: sum((x) => x.themes.length),
    violations: sum((x) => x.violations),
    belowKSurfaced: sum((x) => x.belowKSurfaced.length),
    spurious: sum((x) => x.spurious),
    duplicates: sum((x) => x.duplicates),
    supportPrecision: sum((x) => x.trueTotal) / Math.max(1, sum((x) => x.claimed)),
    markerLeaks: sum((x) => x.markerLeaks.length),
    markerLeaksBeforeGuard: sum((x) => x.markerLeaksBeforeGuard.length),
    maxSharedRun: Math.max(0, ...scores.map((s) => s.score.maxSharedRun)),
    flagged: sum((x) => x.flagged),
    rewritten: sum((x) => x.rewritten),
    withheldWording: sum((x) => x.withheldWording),
    prompts: prompts.ok && prompts.sprints.length ? p.reduce((a, x) => a + x.prompts, 0) : NaN,
    promptSubgroupMentions: p.reduce((a, x) => a + x.subgroupMentions, 0),
    promptMarkerLeaks: p.reduce((a, x) => a + x.markerLeaks.length, 0),
    themeCostUsd: cost(allCalls),
    promptCostUsd: cost(promptCalls),
    costUsd: cost(allCalls) + cost(promptCalls),
    latencyS: [...allCalls, ...promptCalls].reduce((a, c) => a + c.latencyS, 0),
    inputTokens: [...allCalls, ...promptCalls].reduce((a, c) => a + c.inputTokens, 0),
    outputTokens: [...allCalls, ...promptCalls].reduce((a, c) => a + c.outputTokens, 0),
    reasoningTokens: [...allCalls, ...promptCalls].reduce((a, c) => a + c.reasoningTokens, 0),
    scopes: scores.map((s) => s.score),
  };
}

type Summary = Record<string, { mean: number; min: number; max: number }>;

function summarise(rows: RunRow[]): Summary {
  const out: Summary = {};
  for (const key of Object.keys(rows[0]) as (keyof RunRow)[]) {
    if (typeof rows[0][key] !== "number" || key === "run") continue;
    const xs = rows.map((r) => r[key] as number);
    out[key] = { mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) };
  }
  return out;
}

function cell(s: Summary, key: string, digits = 2): string {
  const v = s[key];
  if (Number.isNaN(v.mean)) return "not run";
  const f = (x: number) => x.toFixed(digits);
  return f(v.min) === f(v.max) ? f(v.mean) : `${f(v.mean)} (${f(v.min)}–${f(v.max)})`;
}

function markdown(models: Record<string, { rows: RunRow[]; summary: Summary }>): string {
  const lines = [
    `Generated by \`scripts/eval-themes.ts\`: ${RUNS} runs per model, k = ${K}, prices as of ${AS_OF}. Mean across runs, range in brackets.`,
    "",
    "| Model | Recall, dev (6 sprints + 2 teams) | Recall, held out (2 teams) | Themes released | Below-k themes surfaced | Released themes with true support < k | Support precision | Spurious | Distinctive markers leaked | Markers in raw drafts (before guard) | Longest shared run (words) | Guard: flagged / rewritten / withheld | Cost per run (USD) | Time per run (s) |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const [model, { summary: s }] of Object.entries(models)) {
    const guard = `${cell(s, "flagged", 1)} / ${cell(s, "rewritten", 1)} / ${cell(s, "withheldWording", 1)}`;
    lines.push(
      `| \`${model}\` | ${cell(s, "recallDev")} | ${cell(s, "recallHeldOut")} | ${cell(s, "themes", 1)} | ${cell(s, "belowKSurfaced", 1)} | ${cell(s, "violations", 1)} | ${cell(s, "supportPrecision")} | ${cell(s, "spurious", 1)} | ${cell(s, "markerLeaks", 1)} | ${cell(s, "markerLeaksBeforeGuard", 1)} | ${cell(s, "maxSharedRun", 0)} | ${guard} | ${cell(s, "costUsd", 4)} | ${cell(s, "latencyS", 0)} |`,
    );
  }
  lines.push("", "Retro prompts (six demo sprints per run):", "", "| Model | Prompts | Naming a sub-group | Distinctive markers | Prompt cost per run (USD) | Theme cost per run (USD) | Input / output tokens per run | Reasoning tokens |", "|---|---|---|---|---|---|---|---|");
  for (const [model, { summary: s }] of Object.entries(models)) {
    if (Number.isNaN(s.prompts.mean)) {
      lines.push(`| \`${model}\` | not run | | | | ${cell(s, "themeCostUsd", 4)} | ${cell(s, "inputTokens", 0)} / ${cell(s, "outputTokens", 0)} | ${cell(s, "reasoningTokens", 0)} |`);
      continue;
    }
    lines.push(
      `| \`${model}\` | ${cell(s, "prompts", 1)} | ${cell(s, "promptSubgroupMentions", 1)} | ${cell(s, "promptMarkerLeaks", 1)} | ${cell(s, "promptCostUsd", 4)} | ${cell(s, "themeCostUsd", 4)} | ${cell(s, "inputTokens", 0)} / ${cell(s, "outputTokens", 0)} | ${cell(s, "reasoningTokens", 0)} |`,
    );
  }
  const failed = Object.values(models).flatMap(({ rows }) => rows.filter((r) => r.failedScopes.length).map((r) => `- \`${r.model}\` run ${r.run}: ${r.failedScopes.join(", ")}`));
  if (failed.length) lines.push("", "Failed scopes (counted, not retried):", "", ...failed);
  return `${lines.join("\n")}\n`;
}

async function main() {
  console.log(`budget: $${budget.spentUsd.toFixed(4)} spent of $${BUDGET.toFixed(2)}`);
  const pairs = MODELS.flatMap((model) => Array.from({ length: RUNS }, (_, i) => ({ model, run: i + 1 })));
  const done = await pool(pairs, 2, async ({ model, run }) => {
    const themeRuns = await pool(scopes, 4, (s) => themeRun(model, run, s));
    const themes = new Map(scopes.map((s, i) => [s.id, themeRuns[i]]));
    const prompts = RUN_PROMPTS ? await promptRun(model, run, themes) : { version: VERSION, ok: true, sprints: [] };
    return rowFor(model, run, themes, prompts);
  });
  const models: Record<string, { rows: RunRow[]; summary: Summary }> = {};
  for (const model of MODELS) {
    const rows = done.filter((r) => r.model === model);
    models[model] = { rows, summary: summarise(rows) };
  }
  if (!FILTERED || REPORT) {
    const report = REPORT ?? "docs/eval/results.md";
    writeJson(`${OUT}/results.json`, { k: K, runs: RUNS, pricesAsOf: AS_OF, models });
    const { writeFileSync } = await import("node:fs");
    writeFileSync(report, markdown(models));
    console.log(`wrote ${report}`);
  }
  for (const [model, { summary }] of Object.entries(models)) {
    console.log(`${model}: recall dev ${cell(summary, "recallDev")}, held out ${cell(summary, "recallHeldOut")}, violations ${cell(summary, "violations", 1)}, leaks ${cell(summary, "markerLeaks", 1)}, cost ${cell(summary, "costUsd", 4)}`);
  }
  console.log(`ledger total: $${ledgerTotal().toFixed(4)}`);
}

await main();
