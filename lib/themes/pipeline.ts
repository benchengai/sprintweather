/** Free-text notes -> k-anonymous themes.
 *
 * 1. Scrub links, emails, handles, ticket ids and numbers; shuffle; give each note
 *    an opaque id. The model never sees roles, sub-teams or scores.
 * 2. Extract: the model proposes themes and cites the notes behind each one. The
 *    schema only accepts ids that exist in the prompt.
 * 3. Verify: a second call checks, theme by theme, which cited notes really make
 *    that point. Only verified notes count, and a theme needs at least k of them.
 * 4. Guard (deterministic): a statement may not reuse a word or four-word phrase
 *    that fewer than k notes share. Flagged statements get one rewrite call and are
 *    checked again; any that still fail are withheld.
 *
 * Only the statement, topic, polarity and support count leave this module for
 * storage. Note ids are internal to one run and the notes are deleted afterwards.
 */

import { randomInt } from "node:crypto";

import type { CallMeta, JsonCaller } from "../llm/client";
import type { StoredTheme } from "../types";
import { checkStatement, scrub, type GuardResult } from "./guard";

export const TOPICS = ["workload", "process", "tooling", "goals", "collaboration", "wellbeing", "other"] as const;
export const POLARITIES = ["concern", "positive", "mixed"] as const;
export const MAX_THEMES = 6;

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
3. Write each theme as one plain sentence of at most 16 words, in generic wording that many writers could have used. Do not quote or closely echo any note. Leave out names, product or project names, numbers, jokes, metaphors and any detail that only one note mentions.
4. Describe what the notes say about the work: workload, process, tools, goals, collaboration. Do not add feelings the writers did not state, and never describe one person.
5. Return at most ${MAX_THEMES} themes. Returning none is fine.`;

const VERIFY_SYSTEM = `You check whether anonymous notes support a theme statement.

For each theme you get the statement and the notes that were cited for it. List the ids of the notes that clearly make the point in the statement, even if in other words. Leave out notes that only touch the topic loosely, make a different point, or support only part of a statement that combines several points.`;

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

  // 4. Wording guard, with one rewrite for flagged statements.
  const checks = new Map(supported.map((s) => [s.id, checkStatement(s.statement, scrubbed, k)]));
  const flagged = supported.filter((s) => !checks.get(s.id)!.ok);
  result.guard.flagged = flagged.length;
  const rewrites = new Map<string, string>();
  if (flagged.length > 0) {
    const prompt = flagged
      .map((s) => {
        const g = checks.get(s.id)!;
        const avoid = [...g.words, ...g.phrases.map((p) => `"${p}"`)];
        if (g.placeholders) avoid.push("bracketed placeholders such as [link]");
        return `Theme ${s.id}: ${s.statement}\nDo not use: ${avoid.join(", ")}`;
      })
      .join("\n\n");
    const rewrite = await call({ system: REWRITE_SYSTEM, prompt, schema: rewriteSchema(flagged.map((s) => s.id)), name: "rewrite" });
    result.calls.push({ step: "rewrite", ...rewrite.meta });
    const out = JSON.parse(rewrite.text) as { rewrites: { theme_id: string; statement: string }[] };
    result.raw.rewrite = out;
    for (const r of out.rewrites) if (r.statement.trim()) rewrites.set(r.theme_id, r.statement.trim());
  }

  for (const s of supported) {
    const supportIdx = s.verified.map((id) => idToIndex.get(id)!);
    let statement = s.statement;
    let rewritten = false;
    if (!checks.get(s.id)!.ok) {
      const replacement = rewrites.get(s.id);
      const recheck = replacement ? checkStatement(replacement, scrubbed, k) : null;
      if (!replacement || !recheck!.ok) {
        result.withheld.push({ statement, reason: "wording", supportIdx, guard: recheck ?? checks.get(s.id) });
        continue;
      }
      statement = replacement;
      rewritten = true;
      result.guard.rewritten++;
    }
    result.themes.push({ statement, topic: s.topic, polarity: s.polarity, support: supportIdx.length, supportIdx, rewritten });
  }
  result.themes.sort((a, b) => b.support - a.support);
  return result;
}

export function totalCost(calls: { costUsd: number | null }[]): number | null {
  return calls.some((c) => c.costUsd === null) ? null : calls.reduce((a, c) => a + (c.costUsd ?? 0), 0);
}
