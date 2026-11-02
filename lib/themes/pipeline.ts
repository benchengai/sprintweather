/** Free-text notes -> k-anonymous themes.
 *
 * 1. Scrub links, emails, handles, ticket ids and numbers; shuffle; give each note
 *    an opaque id. The model never sees roles, sub-teams or scores.
 * 2. Extract: the model proposes themes and cites the notes behind each one. The
 *    schema only accepts ids that exist in the prompt.
 * 3. Verify: a second call checks, theme by theme, which cited notes really make
 *    that point. Only verified notes count, and a theme needs at least k of them.
 * 4. Guard (deterministic): a statement may not reuse a word or four-word phrase
 *    that only one note uses, or a name that fewer than k notes use. Flagged
 *    statements get up to two rewrite calls and are checked after each; any that
 *    still fail are withheld.
 *
 * Only the statement, topic, polarity and support count leave this module for
 * storage. Note ids are internal to one run and the notes are deleted afterwards.
 */

import { randomInt } from "node:crypto";

import type { CallMeta, JsonCaller } from "../llm/client";
import type { StoredTheme, ThemeResult } from "../types";
import { checkStatement, scrub, type GuardResult } from "./guard";

export const TOPICS = ["workload", "process", "tooling", "goals", "collaboration", "wellbeing", "other"] as const;
export const POLARITIES = ["concern", "positive", "mixed"] as const;
export const MAX_THEMES = 6;
export const MAX_REWRITES = 2;

export interface PipelineTheme extends StoredTheme {
  /** Indices into the input notes. Used by the evaluation only, never stored. */
  supportIdx: number[];
  rewritten: boolean;
}

export interface Withheld {
  statement: string;
  reason: "claimed-below-k" | "verified-below-k" | "wording";
  supportIdx: number[];
  guard?: GuardResult;
}

export interface PipelineResult {
  themes: PipelineTheme[];
  withheld: Withheld[];
  calls: (CallMeta & { step: "extract" | "verify" | "rewrite" })[];
  /** Raw model outputs, kept by the evaluation for auditing. */
  raw: { extract?: unknown; verify?: unknown; rewrite?: unknown };
  guard: { flagged: number; rewritten: number };
}

const EXTRACT_SYSTEM = (k: number) => `You summarise anonymous sprint check-in notes from one software team into shared themes for the team's retrospective.

Rules:
1. A theme is a point that at least ${k} different notes make. If fewer than ${k} notes share a point, leave it out, however important it seems.
2. For each theme, cite the id of every note that makes that point, and only those.
3. State one point per theme, as one plain sentence of at most 14 words, in generic wording that many writers could have used. Do not add details that only some of the cited notes mention. Do not quote or closely echo any note. Leave out names, product or project names, numbers, jokes and metaphors.
4. Describe what the notes say about the work: workload, process, tools, goals, collaboration. Do not add feelings the writers did not state, and never describe one person.
5. Return at most ${MAX_THEMES} themes. Returning none is fine.`;

const VERIFY_SYSTEM = `You check whether anonymous notes support a theme statement.

For each theme you get the statement and the notes that were cited for it. List the ids of the notes that make the statement's point: a reader would agree the note says that, even if the wording or emphasis differs. Leave out notes that make a related but different point, or only mention the topic.`;

const REWRITE_SYSTEM = `You rewrite theme statements for a team retrospective so they cannot be traced to one person's wording.

For each statement you get words and phrases that must not appear, because only a few notes used them. Keep the meaning, use plain generic wording, at most 16 words, and do not use any of the listed words, phrases or close variants of them.`;

function extractSchema(ids: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["themes"],
    properties: {
      themes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["statement", "topic", "polarity", "note_ids"],
          properties: {
            statement: { type: "string" },
            topic: { type: "string", enum: [...TOPICS] },
            polarity: { type: "string", enum: [...POLARITIES] },
            note_ids: { type: "array", items: { type: "string", enum: ids } },
          },
        },
      },
    },
  };
}

function verifySchema(themeIds: string[], ids: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["judgements"],
    properties: {
      judgements: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["theme_id", "supported_note_ids"],
          properties: {
            theme_id: { type: "string", enum: themeIds },
            supported_note_ids: { type: "array", items: { type: "string", enum: ids } },
          },
        },
      },
    },
  };
}

function rewriteSchema(themeIds: string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["rewrites"],
    properties: {
      rewrites: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["theme_id", "statement"],
          properties: { theme_id: { type: "string", enum: themeIds }, statement: { type: "string" } },
        },
      },
    },
  };
}

interface Candidate {
  statement: string;
  topic: (typeof TOPICS)[number];
  polarity: (typeof POLARITIES)[number];
  cited: string[];
}

export interface PipelineOptions {
  k: number;
  call: JsonCaller;
  /** Uniform integer in [0, n). Injected so the evaluation can fix the shuffle. */
  random?: (n: number) => number;
}

export async function extractThemes(notes: string[], { k, call, random = randomInt }: PipelineOptions): Promise<PipelineResult> {
  const result: PipelineResult = { themes: [], withheld: [], calls: [], raw: {}, guard: { flagged: 0, rewritten: 0 } };
  if (notes.length < k) return result;

  // 1. Scrub, shuffle, assign opaque ids.
  const order = notes.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = random(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const scrubbed = notes.map(scrub);
  const ids = order.map((_, pos) => `n${String(pos + 1).padStart(2, "0")}`);
  const idToIndex = new Map(ids.map((id, pos) => [id, order[pos]]));
  const listing = ids.map((id, pos) => `[${id}] ${scrubbed[order[pos]]}`).join("\n");

  // 2. Extract.
  const extract = await call({
    system: EXTRACT_SYSTEM(k),
    prompt: `Notes (${notes.length}):\n${listing}`,
    schema: extractSchema(ids),
    name: "themes",
  });
  result.calls.push({ step: "extract", ...extract.meta });
  const parsed = JSON.parse(extract.text) as { themes: { statement: string; topic: Candidate["topic"]; polarity: Candidate["polarity"]; note_ids: string[] }[] };
  result.raw.extract = parsed;
  const candidates: Candidate[] = [];
  for (const t of parsed.themes.slice(0, MAX_THEMES)) {
    const statement = t.statement.trim();
    const cited = [...new Set(t.note_ids)].filter((id) => idToIndex.has(id));
    if (!statement) continue;
    if (cited.length < k) {
      result.withheld.push({ statement, reason: "claimed-below-k", supportIdx: cited.map((id) => idToIndex.get(id)!) });
      continue;
    }
    candidates.push({ statement, topic: t.topic, polarity: t.polarity, cited });
  }
  if (candidates.length === 0) return result;

  // 3. Verify support, theme by theme.
  const themeIds = candidates.map((_, i) => `t${i + 1}`);
  const verifyPrompt = candidates
    .map((c, i) => {
      const cited = c.cited.map((id) => `  [${id}] ${scrubbed[idToIndex.get(id)!]}`).join("\n");
      return `Theme ${themeIds[i]}: ${c.statement}\nCited notes:\n${cited}`;
    })
    .join("\n\n");
  const verify = await call({ system: VERIFY_SYSTEM, prompt: verifyPrompt, schema: verifySchema(themeIds, ids), name: "support" });
  result.calls.push({ step: "verify", ...verify.meta });
  const judged = JSON.parse(verify.text) as { judgements: { theme_id: string; supported_note_ids: string[] }[] };
  result.raw.verify = judged;

  const supported: (Candidate & { verified: string[]; id: string })[] = [];
  candidates.forEach((c, i) => {
    const said = new Set(judged.judgements.filter((j) => j.theme_id === themeIds[i]).flatMap((j) => j.supported_note_ids));
    // The judge can only confirm citations, never add new ones.
    const verified = c.cited.filter((id) => said.has(id));
    if (verified.length < k) {
      result.withheld.push({ statement: c.statement, reason: "verified-below-k", supportIdx: verified.map((id) => idToIndex.get(id)!) });
    } else {
      supported.push({ ...c, verified, id: themeIds[i] });
    }
  });

  // 4. Wording guard, with up to MAX_REWRITES rewrites for flagged statements.
  const current = new Map(supported.map((s) => [s.id, s.statement]));
  const checks = new Map(supported.map((s) => [s.id, checkStatement(s.statement, scrubbed, k)]));
  result.guard.flagged = supported.filter((s) => !checks.get(s.id)!.ok).length;
  const rewrites: unknown[] = [];
  // Everything flagged so far, so a later round cannot drift back to earlier wording.
  const avoid = new Map(supported.map((s) => [s.id, new Set<string>()]));
  for (let round = 0; round < MAX_REWRITES; round++) {
    const flagged = supported.filter((s) => !checks.get(s.id)!.ok);
    if (flagged.length === 0) break;
    const prompt = flagged
      .map((s) => {
        const g = checks.get(s.id)!;
        const list = avoid.get(s.id)!;
        for (const w of g.words) list.add(w);
        for (const p of g.phrases) list.add(`"${p}"`);
        if (g.placeholders) list.add("bracketed placeholders such as [link]");
        return `Theme ${s.id}: ${current.get(s.id)}\nDo not use: ${[...list].join(", ")}`;
      })
      .join("\n\n");
    const rewrite = await call({ system: REWRITE_SYSTEM, prompt, schema: rewriteSchema(flagged.map((s) => s.id)), name: "rewrite" });
    result.calls.push({ step: "rewrite", ...rewrite.meta });
    const out = JSON.parse(rewrite.text) as { rewrites: { theme_id: string; statement: string }[] };
    rewrites.push(out);
    for (const r of out.rewrites) {
      const statement = r.statement.trim();
      if (!statement || !current.has(r.theme_id) || checks.get(r.theme_id)!.ok) continue;
      current.set(r.theme_id, statement);
      checks.set(r.theme_id, checkStatement(statement, scrubbed, k));
    }
  }
  if (rewrites.length) result.raw.rewrite = rewrites;

  for (const s of supported) {
    const supportIdx = s.verified.map((id) => idToIndex.get(id)!);
    const statement = current.get(s.id)!;
    if (!checks.get(s.id)!.ok) {
      result.withheld.push({ statement, reason: "wording", supportIdx, guard: checks.get(s.id) });
      continue;
    }
    const rewritten = statement !== s.statement;
    if (rewritten) result.guard.rewritten++;
    result.themes.push({ statement, topic: s.topic, polarity: s.polarity, support: supportIdx.length, supportIdx, rewritten });
  }
  result.themes.sort((a, b) => b.support - a.support);
  return result;
}

export function totalCost(calls: { costUsd: number | null }[]): number | null {
  return calls.some((c) => c.costUsd === null) ? null : calls.reduce((a, c) => a + (c.costUsd ?? 0), 0);
}

/** What gets stored: statements and counts, no note ids or text. */
export function toThemeResult(sprint: string, notes: number, model: string, r: PipelineResult, source?: string): ThemeResult {
  return {
    sprint,
    notes,
    themes: r.themes.map(({ statement, topic, polarity, support }) => ({ statement, topic, polarity, support })),
    withheld: r.withheld.length,
    model,
    generatedAt: new Date().toISOString().slice(0, 10),
    costUsd: totalCost(r.calls),
    ...(source ? { source } : {}),
  };
}
