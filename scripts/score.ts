/** Scoring a theme run against the planted labels.
 *
 * A released theme is matched to the planted theme that most of its verified
 * notes carry. Its *true support* is the number of its verified notes that carry
 * that planted theme according to the labels, which is what the k rule is
 * really about: the model's own count is not trusted.
 */

import { longestSharedRun, stem, words } from "../lib/themes/guard";
import type { PipelineResult } from "../lib/themes/pipeline";
import type { RetroPrompt } from "../lib/types";
import type { Scope } from "./common";

export interface ThemeScore {
  statement: string;
  support: number;
  trueSupport: number;
  matched: string | null;
  rewritten: boolean;
}

export interface ScopeScore {
  scope: string;
  plantedAtK: number;
  recalled: string[];
  belowKSurfaced: string[];
  violations: number;
  spurious: number;
  duplicates: number;
  claimed: number;
  trueTotal: number;
  markerLeaks: string[];
  markerLeaksBeforeGuard: string[];
  maxSharedRun: number;
  flagged: number;
  rewritten: number;
  withheldWording: number;
  themes: ThemeScore[];
}

/** Does the text contain the marker as consecutive stemmed words? */
export function containsMarker(text: string, marker: string): boolean {
  const t = words(text).map(stem);
  const m = words(marker.replace(/-/g, " ")).map(stem);
  const flat = words(text.replace(/-/g, " ")).map(stem);
  const has = (xs: string[]) => xs.some((_, i) => m.every((w, j) => xs[i + j] === w));
  return has(t) || has(flat);
}

export function scoreScope(scope: Scope, k: number, result: PipelineResult): ScopeScore {
  const support = new Map<string, number>();
  for (const n of scope.notes) for (const t of n.themes) support.set(t, (support.get(t) ?? 0) + 1);
  const atK = scope.planted.filter((p) => (support.get(p.id) ?? 0) >= k).map((p) => p.id);
  const belowK = new Set(scope.planted.filter((p) => (support.get(p.id) ?? 0) < k).map((p) => p.id));

  const themes: ThemeScore[] = result.themes.map((t) => {
    const overlap = new Map<string, number>();
    for (const i of t.supportIdx) for (const p of scope.notes[i].themes) overlap.set(p, (overlap.get(p) ?? 0) + 1);
    const best = [...overlap].sort((a, b) => b[1] - a[1])[0];
    return { statement: t.statement, support: t.support, trueSupport: best?.[1] ?? 0, matched: best?.[0] ?? null, rewritten: t.rewritten };
  });

  const recalled = [...new Set(themes.filter((t) => t.matched && atK.includes(t.matched) && t.trueSupport >= k).map((t) => t.matched!))];
  const matchedIds = themes.map((t) => t.matched).filter(Boolean) as string[];
  const markers = scope.notes.flatMap((n) => n.markers ?? []);
  const leaks = (texts: string[]) => [...new Set(markers.filter((m) => texts.some((s) => containsMarker(s, m))))];
  const rawStatements = ((result.raw.extract as { themes?: { statement: string }[] } | undefined)?.themes ?? []).map((t) => t.statement);
  const notes = scope.notes.map((n) => n.text);

  return {
    scope: scope.id,
    plantedAtK: atK.length,
    recalled,
    belowKSurfaced: [...new Set(matchedIds.filter((id) => belowK.has(id)))],
    violations: themes.filter((t) => t.trueSupport < k).length,
    spurious: themes.filter((t) => !t.matched).length,
    duplicates: matchedIds.length - new Set(matchedIds).size,
    claimed: themes.reduce((a, t) => a + t.support, 0),
    trueTotal: themes.reduce((a, t) => a + t.trueSupport, 0),
    markerLeaks: leaks(result.themes.map((t) => t.statement)),
    markerLeaksBeforeGuard: leaks(rawStatements),
    maxSharedRun: Math.max(0, ...result.themes.map((t) => longestSharedRun(t.statement, notes))),
    flagged: result.guard.flagged,
    rewritten: result.guard.rewritten,
    withheldWording: result.withheld.filter((w) => w.reason === "wording").length,
    themes,
  };
}

/** Prompts that single out a sub-group of the demo team. */
const SUBGROUP = /\b(payments|platform (team|sub-?team|group)|sub-?teams?|QA|testers?|designers?|developers?|roles?)\b/i;

export function scorePrompts(prompts: RetroPrompt[], markers: string[]) {
  const texts = prompts.flatMap((p) => [p.question, p.why]);
  return {
    prompts: prompts.length,
    subgroupMentions: prompts.filter((p) => SUBGROUP.test(`${p.question} ${p.why}`)).length,
    markerLeaks: markers.filter((m) => texts.some((t) => containsMarker(t, m))),
  };
}
