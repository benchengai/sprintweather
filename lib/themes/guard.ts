/** Deterministic checks around the theme step, so that a theme statement cannot
 * carry one person's wording into the retro.
 *
 * Rules for a statement, checked against all notes in the scope:
 * - no word that only one note uses (unless it is an ordinary word on the common list);
 * - no four-word sequence that only one note uses;
 * - no capitalised name (a person, product or place) that fewer than k notes use;
 * - no placeholder left by scrubbing.
 * Words the model brings in itself never trigger a rule: only wording traceable to
 * the notes does.
 */

import { COMMON_WORDS } from "./common-words";

const STOPWORDS = `a about above after again against all also am an and any are as at be because been before
being below between both but by can could did do does doing down during each few for from further had has
have having he her here hers herself him himself his how i if in into is it its itself just let me more most
my myself no nor not now of off on once only or other our ours ourselves out over own same she should so
some such than that the their theirs them themselves then there these they this those through to too under
until up very was we were what when where which while who whom why will with would you your yours yourself
yourselves isn't wasn't weren't don't doesn't didn't can't couldn't won't wouldn't shouldn't i'm i've i'd
we're we've they're it's that's there's lot lots bit really quite still even much many yet ever`;

/** Lower-case, split on anything that is not a letter, digit or apostrophe, and
 * crudely stem so that "deploys", "deployed" and "deploying" count as one word. */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/^'+|'+$/g, "").replace(/'s$/, "");
  if (w.length > 4 && w.endsWith("ies")) w = `${w.slice(0, -3)}y`;
  else if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("e")) w = w.slice(0, -1);
  return w;
}

export function words(text: string): string[] {
  return text.toLowerCase().split(/[^\p{L}\p{N}']+/u).filter((w) => w.replace(/'/g, "") !== "");
}

const STOP = new Set(words(STOPWORDS).map(stem));
const ALLOWED = new Set([...STOP, ...words(COMMON_WORDS).map(stem)]);

/** Remove identifiers before any model sees a note. */
export function scrub(note: string): string {
  return note
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link]")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]")
    .replace(/(^|\s)@[\w.-]+/g, "$1[someone]")
    .replace(/\b[A-Z][A-Z0-9]{1,9}-\d+\b/g, "[ticket]")
    .replace(/\b\d{2,}\b/g, "[number]");
}

const GRAM = 4;
/** Wording shared by fewer notes than this is one person's wording. */
export const MIN_SHARED = 2;

/** Stems of capitalised words that are not at the start of a sentence. */
function properNouns(notes: string[]): Set<string> {
  const out = new Set<string>();
  for (const note of notes) {
    for (const m of note.matchAll(/(?<![.!?;:]\s|^)\b([A-Z][a-z\p{Ll}]+)\b/gu)) {
      if (m.index !== undefined && m.index > 0) out.add(stem(m[1]));
    }
  }
  return out;
}

function grams(stems: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + GRAM <= stems.length; i++) out.push(stems.slice(i, i + GRAM).join(" "));
  return out;
}

export interface GuardResult {
  ok: boolean;
  /** Words only one note uses, or names fewer than k notes use. */
  words: string[];
  /** Four-word sequences only one note uses. */
  phrases: string[];
  placeholders: boolean;
}

export function checkStatement(statement: string, notes: string[], k: number): GuardResult {
  const noteStems = notes.map((n) => words(n).map(stem));
  const noteSets = noteStems.map((s) => new Set(s));
  const noteGrams = noteStems.map((s) => new Set(grams(s)));
  const df = (test: (i: number) => boolean) => notes.reduce((a, _, i) => a + (test(i) ? 1 : 0), 0);
  const below = (n: number, min: number) => n >= 1 && n < min;
  const names = properNouns(notes);

  const raw = words(statement);
  const stems = raw.map(stem);
  const flaggedWords = new Set<string>();
  stems.forEach((s, i) => {
    if (ALLOWED.has(s)) return;
    if (below(df((j) => noteSets[j].has(s)), names.has(s) ? k : MIN_SHARED)) flaggedWords.add(raw[i]);
  });
  const flaggedPhrases = new Set<string>();
  grams(stems).forEach((g, i) => {
    if (below(df((j) => noteGrams[j].has(g)), MIN_SHARED)) flaggedPhrases.add(raw.slice(i, i + GRAM).join(" "));
  });
  const placeholders = /\[(link|email|someone|ticket|number)\]/i.test(statement);
  return {
    ok: flaggedWords.size === 0 && flaggedPhrases.size === 0 && !placeholders,
    words: [...flaggedWords],
    phrases: [...flaggedPhrases],
    placeholders,
  };
}

/** Longest run of consecutive words (after stemming) that a statement shares
 * with any single note. Used by the evaluation, not by the guard. */
export function longestSharedRun(statement: string, notes: string[]): number {
  const a = words(statement).map(stem);
  let best = 0;
  for (const note of notes) {
    const b = words(note).map(stem);
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const keep = prev[j];
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) best = prev[j];
        diag = keep;
      }
    }
  }
  return best;
}
