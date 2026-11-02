/** The release: everything SprintWeather will ever show, computed in one place.
 *
 * Every API response and every page reads from `buildRelease`, never from raw
 * responses, so the suppression rules below are the only path from data to screen.
 *
 * Rules (docs/privacy-model.md explains each one):
 * 1. Nothing from a sprint is released while its check-in is open.
 * 2. A sprint's team aggregate is released only if it has at least k responses.
 * 3. A sub-group (a value of role, sub-team, ...) is released only if releasing it
 *    keeps every *atom* at 0 or at least k responses. An atom is a set of responses
 *    that belong to exactly the same released sets. Any sum, count or mean an
 *    observer can derive by adding and subtracting released aggregates (across
 *    groups, across dimensions, or with the team total) is a combination of atom
 *    totals, so no derivable figure covers fewer than k responses.
 * 4. Multi-sprint figures (before/after an action item) only pool whole sprints whose
 *    team aggregate is released, so they never split an atom.
 * 5. Themes are released only for a released sprint, each backed by at least k notes.
 * 6. A closed sprint's release uses the k and dimensions frozen at close, so changing
 *    the settings later cannot produce a second, differently-suppressed version.
 * 7. Hidden cells carry no numbers at all, not even their response count.
 */

import { welchInterval, meanInterval, mean } from "./stats";
import {
  QUESTION_IDS,
  type ActionItem,
  type CheckinResponse,
  type Dimension,
  type PromptResult,
  type QuestionId,
  type Sprint,
  type StoredTheme,
  type ThemeResult,
} from "./types";

export interface Dataset {
  k: number;
  dimensions: Dimension[];
  sprints: Sprint[];
  responses: CheckinResponse[];
  actions: ActionItem[];
  themes: ThemeResult[];
  prompts: PromptResult[];
}

export interface GroupStats {
  n: number;
  means: Record<QuestionId, number>;
  blocked: number;
}

export interface TeamStats extends GroupStats {
  intervals: Record<QuestionId, { lo: number; hi: number }>;
  /** Counts answering 1-2, 3 and 4-5. */
  bands: Record<QuestionId, { low: number; mid: number; high: number }>;
}

export type Cell =
  | { dimension: string; value: string; shown: true; stats: GroupStats }
  | { dimension: string; value: string; shown: false };

export interface Breakdown {
  dimension: string;
  label: string;
  cells: Cell[];
}

export interface SprintRelease {
  id: string;
  label: string;
  index: number;
  status: "open" | "below-k" | "released";
  k: number | null;
  team: TeamStats | null;
  breakdowns: Breakdown[];
  themes: {
    themes: StoredTheme[];
    model: string;
    generatedAt: string;
    source?: string;
  } | null;
  prompts: PromptResult | null;
}

export interface Window {
  sprints: string[];
  n: number;
  mean: number;
}

export interface ActionEffect {
  id: string;
  text: string;
  afterSprint: string;
  metric: QuestionId;
  status: "measured" | "too-early" | "no-baseline";
  before: Window | null;
  after: Window | null;
  diff: { estimate: number; lo: number; hi: number } | null;
  verdict: "up" | "down" | "unclear" | null;
}

export interface Release {
  k: number;
  dimensions: Dimension[];
  sprints: SprintRelease[];
  actions: ActionEffect[];
}

/** Sprints on each side of an action item that the before/after comparison pools. */
export const EFFECT_WINDOW = 2;

const round = (x: number) => Math.round(x * 100) / 100;

/** Responses that share a membership signature across all released sets. */
export function atoms(sets: boolean[][], size: number): Map<string, number> {
  const counts = new Map<string, number>();
  for (let i = 0; i < size; i++) {
    let sig = "";
    for (const s of sets) sig += s[i] ? "1" : "0";
    if (!sig.includes("1")) continue;
    counts.set(sig, (counts.get(sig) ?? 0) + 1);
  }
  return counts;
}

function atomsOk(sets: boolean[][], size: number, k: number): boolean {
  for (const c of atoms(sets, size).values()) if (c < k) return false;
  return true;
}

export interface SprintPlan {
  team: boolean;
  /** dimension id -> values released */
  shown: Map<string, Set<string>>;
}

/** Decide which aggregates of one closed sprint can be released (rules 2 and 3).
 * Greedy and deterministic: the team total first, then each dimension in its
 * configured priority, larger groups first. A group is kept only if the atoms of
 * everything kept so far, plus it, stay at 0 or at least k. */
export function planSprint(responses: CheckinResponse[], dimensions: Dimension[], k: number): SprintPlan {
  const plan: SprintPlan = { team: false, shown: new Map(dimensions.map((d) => [d.id, new Set<string>()])) };
  const size = responses.length;
  if (size < k) return plan;
  plan.team = true;
  const kept: boolean[][] = [responses.map(() => true)];
  for (const dim of dimensions) {
    const groups = dim.values
      .map((value, order) => ({ value, order, members: responses.map((r) => r.attrs[dim.id] === value) }))
      .map((g) => ({ ...g, n: g.members.filter(Boolean).length }))
      .sort((a, b) => b.n - a.n || a.order - b.order);
    for (const g of groups) {
      if (g.n < k) continue;
      if (atomsOk([...kept, g.members], size, k)) {
        kept.push(g.members);
        plan.shown.get(dim.id)!.add(g.value);
      }
    }
  }
  return plan;
}

function groupStats(rs: CheckinResponse[]): GroupStats {
  const means = {} as Record<QuestionId, number>;
  for (const q of QUESTION_IDS) means[q] = round(mean(rs.map((r) => r[q])));
  return { n: rs.length, means, blocked: rs.filter((r) => r.blocked).length };
}

function teamStats(rs: CheckinResponse[]): TeamStats {
  const intervals = {} as TeamStats["intervals"];
  const bands = {} as TeamStats["bands"];
  for (const q of QUESTION_IDS) {
    const xs = rs.map((r) => r[q]);
    const ci = meanInterval(xs)!;
    intervals[q] = { lo: round(ci.lo), hi: round(ci.hi) };
    bands[q] = {
      low: xs.filter((x) => x <= 2).length,
      mid: xs.filter((x) => x === 3).length,
      high: xs.filter((x) => x >= 4).length,
    };
  }
  return { ...groupStats(rs), intervals, bands };
}

function releaseSprint(sprint: Sprint, ds: Dataset): SprintRelease {
  const base = { id: sprint.id, label: sprint.label, index: sprint.index };
  const empty = { team: null, breakdowns: [], themes: null, prompts: null };
  if (sprint.status !== "closed" || !sprint.frozen) return { ...base, ...empty, status: "open", k: null };
  const { k, dimensions } = sprint.frozen;
  const rs = ds.responses.filter((r) => r.sprint === sprint.id);
  const plan = planSprint(rs, dimensions, k);
  if (!plan.team) return { ...base, ...empty, status: "below-k", k };

  const breakdowns: Breakdown[] = dimensions.map((dim) => ({
    dimension: dim.id,
    label: dim.label,
    cells: dim.values.map((value): Cell =>
      plan.shown.get(dim.id)!.has(value)
        ? { dimension: dim.id, value, shown: true, stats: groupStats(rs.filter((r) => r.attrs[dim.id] === value)) }
        : { dimension: dim.id, value, shown: false },
    ),
  }));

  const stored = ds.themes.find((t) => t.sprint === sprint.id);
  const themes = stored
    ? {
        themes: stored.themes.filter((t) => t.support >= k),
        model: stored.model,
        generatedAt: stored.generatedAt,
        source: stored.source,
      }
    : null;
  const prompts = ds.prompts.find((p) => p.sprint === sprint.id) ?? null;
  return { ...base, status: "released", k, team: teamStats(rs), breakdowns, themes, prompts };
}

function effect(action: ActionItem, released: SprintRelease[], ds: Dataset): ActionEffect {
  const base = { id: action.id, text: action.text, afterSprint: action.afterSprint, metric: action.metric };
  const none = { before: null, after: null, diff: null, verdict: null };
  const anchor = ds.sprints.find((s) => s.id === action.afterSprint);
  if (!anchor) return { ...base, ...none, status: "no-baseline" };
  // Rule 4: only whole sprints whose team aggregate is released.
  const beforeSprints = released.filter((s) => s.index <= anchor.index).slice(-EFFECT_WINDOW);
  const afterSprints = released.filter((s) => s.index > anchor.index).slice(0, EFFECT_WINDOW);
  const values = (ss: SprintRelease[]) =>
    ds.responses.filter((r) => ss.some((s) => s.id === r.sprint)).map((r) => r[action.metric]);
  const window = (ss: SprintRelease[]): Window | null => {
    if (ss.length === 0) return null;
    const xs = values(ss);
    return { sprints: ss.map((s) => s.id), n: xs.length, mean: round(mean(xs)) };
  };
  const before = window(beforeSprints);
  const after = window(afterSprints);
  if (!before) return { ...base, ...none, after, status: "no-baseline" };
  if (!after) return { ...base, ...none, before, status: "too-early" };
  const ci = welchInterval(values(beforeSprints), values(afterSprints))!;
  const diff = { estimate: round(ci.estimate), lo: round(ci.lo), hi: round(ci.hi) };
  const verdict = ci.lo > 0 ? "up" : ci.hi < 0 ? "down" : "unclear";
  return { ...base, status: "measured", before, after, diff, verdict };
}

export function buildRelease(ds: Dataset): Release {
  const sprints = [...ds.sprints].sort((a, b) => a.index - b.index).map((s) => releaseSprint(s, ds));
  const released = sprints.filter((s) => s.status === "released");
  return {
    k: ds.k,
    dimensions: ds.dimensions,
    sprints,
    actions: ds.actions.map((a) => effect(a, released, ds)),
  };
}
