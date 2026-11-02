/** Retro prompts, generated from the release only.
 *
 * The model sees what the team itself would see on the retro page: team-level
 * aggregates, released themes and measured action items. It never sees notes,
 * single responses or sub-group breakdowns, so it cannot leak anything the
 * release does not already show, and it cannot single out a small group.
 */

import type { CallMeta, JsonCaller } from "./llm/client";
import type { Release, SprintRelease } from "./release";
import { QUESTIONS, type RetroPrompt } from "./types";

export interface Evidence {
  id: string;
  text: string;
}

const fmt = (x: number) => x.toFixed(1);
const signed = (x: number) => (x > 0 ? `+${x.toFixed(2)}` : x.toFixed(2));

export function evidenceFor(release: Release, sprintId: string): Evidence[] {
  const released = release.sprints.filter((s) => s.status === "released");
  const at = released.findIndex((s) => s.id === sprintId);
  if (at < 0) return [];
  const sprint = released[at];
  const prev: SprintRelease | undefined = released[at - 1];
  const team = sprint.team!;
  const out: Evidence[] = [];
  for (const q of QUESTIONS) {
    const ci = team.intervals[q.id];
    const was = prev ? `; previous released sprint ${fmt(prev.team!.means[q.id])}` : "";
    out.push({
      id: `metric:${q.id}`,
      text: `${q.label} (1 = ${q.low}, 5 = ${q.high}): team mean ${fmt(team.means[q.id])}, 95% CI ${fmt(ci.lo)} to ${fmt(ci.hi)}${was}`,
    });
  }
  const wasBlocked = prev ? `; previous released sprint ${prev.team!.blocked} of ${prev.team!.n}` : "";
  out.push({ id: "blocked", text: `Blocked for a day or more: ${team.blocked} of ${team.n} responses${wasBlocked}` });
  (sprint.themes?.themes ?? []).forEach((t, i) => {
    out.push({ id: `theme:${i + 1}`, text: `Theme from ${t.support} notes (${t.polarity}, ${t.topic}): ${t.statement}` });
  });
  for (const a of release.actions) {
    if (a.status !== "measured" || !a.after!.sprints.includes(sprintId)) continue;
    const q = QUESTIONS.find((x) => x.id === a.metric)!;
    out.push({
      id: `action:${a.id}`,
      text: `Action item "${a.text}" (agreed after ${a.afterSprint}): ${q.label} changed by ${signed(a.diff!.estimate)} (95% CI ${signed(a.diff!.lo)} to ${signed(a.diff!.hi)}), before n=${a.before!.n}, after n=${a.after!.n}`,
    });
  }
  return out;
}

const SYSTEM = `You help a software team prepare its sprint retrospective. You get team-level results from an anonymous, opt-in check-in.

Write 3 or 4 open questions the team could discuss. Rules:
- Use only the evidence given, and cite the evidence ids each question builds on.
- Ask; do not diagnose. Do not state causes as facts, and treat differences inside the confidence interval as unclear.
- Questions are for the whole team: never about an individual, a role or a sub-team, and never ask who answered what.
- Plain, blame-free language, one sentence each. "why" says in at most 25 words what in the evidence prompted the question.`;

function schema(ids: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["prompts"],
    properties: {
      prompts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["question", "why", "based_on"],
          properties: {
            question: { type: "string" },
            why: { type: "string" },
            based_on: { type: "array", items: { type: "string", enum: ids } },
          },
        },
      },
    },
  };
}

export async function retroPrompts(release: Release, sprintId: string, call: JsonCaller): Promise<{ prompts: RetroPrompt[]; meta: CallMeta | null }> {
  const evidence = evidenceFor(release, sprintId);
  if (evidence.length === 0) return { prompts: [], meta: null };
  const label = release.sprints.find((s) => s.id === sprintId)!.label;
  const { text, meta } = await call({
    system: SYSTEM,
    prompt: `Sprint: ${label}\nEvidence:\n${evidence.map((e) => `[${e.id}] ${e.text}`).join("\n")}`,
    schema: schema(evidence.map((e) => e.id)),
    name: "retro_prompts",
  });
  const parsed = JSON.parse(text) as { prompts: { question: string; why: string; based_on: string[] }[] };
  const known = new Set(evidence.map((e) => e.id));
  const prompts = parsed.prompts
    .map((p) => ({ question: p.question.trim(), why: p.why.trim(), basedOn: [...new Set(p.based_on)].filter((id) => known.has(id)) }))
    .filter((p) => p.question && p.basedOn.length > 0)
    .slice(0, 4);
  return { prompts, meta };
}
