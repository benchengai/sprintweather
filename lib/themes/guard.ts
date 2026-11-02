/** Deterministic checks around the theme step, so that a theme statement cannot
 * carry one person's wording into the retro.
 *
 * The rule is "k-anonymous vocabulary": a statement may use a word or a phrase
 * from the notes only if at least k notes use it. Words the model brings in
 * itself, and ordinary words on the common list, are always allowed.
 */

const STOPWORDS = `a about above after again against all also am an and any are as at be because been before
being below between both but by can could did do does doing down during each few for from further had has
have having he her here hers herself him himself his how i if in into is it its itself just let me more most
my myself no nor not now of off on once only or other our ours ourselves out over own same she should so
some such than that the their theirs them themselves then there these they this those through to too under
until up very was we were what when where which while who whom why will with would you your yours yourself
yourselves isn't wasn't weren't don't doesn't didn't can't couldn't won't wouldn't shouldn't i'm i've i'd
we're we've they're it's that's there's lot lots bit really quite still even much many yet ever`;

// Everyday and generic work vocabulary: words a paraphrase may share with a few
// notes without echoing anyone in particular.
const COMMON = `able across actually add added again ago ahead almost alone along already always another answer
anyone anything area around ask asked away back bad badly before begin behind being best better big block
blocked blocker blocking board book break bring broken build built busy call calls came care case catch change
changed changes check clear clearer close code come comes coming common complete context continue cost could
count current day days deadline deal decide decided decision deliver delivered delivery design detail
different difficult done doubt drag drop due early easy end ended enough estimate every everyone everything
expect expected extra fact fail failed fair fast feature feedback feel feeling felt few fine finish finished
first fix fixed focus focused follow found free full get gets getting give given go goal goals going good got
great group half hand handle happen happened hard harder help helped helpful high hold hour hours idea
important improve incident instead issue issues item items job keep kept kind know known large last late
later lead learn least leave left less light like likely line little long longer look looked looking lose lost
low made main make makes making manage many matter mean meant meet meeting meetings mid middle might mind miss
missed missing moment month months morning move moved moving much need needed needs never new next nice night
nobody none normal nothing notice number often old one ones open order others part people person pick
picked place plan planned planning plenty point possible pressure pretty priority priorities problem problems
process product progress project pull push put quick quickly rather reach read ready real reason release
released releases remain request rest result review reviewed reviews right rough run running rush rushed said
same saw say see seem seemed seems send sense set several share shared short show side since slow slowly small
smooth smoothly someone something sometimes soon sort sprint sprints start started stay step steps stop stuck
support sure system take taken takes talk task tasks team teams tell test tested testing tests thing things
think thought time times today together told took tool tools top total track tried try trying turn two type
understand unclear unplanned until use used useful usual wait waited waiting want wanted way week weeks well
went whole wish without work worked working works worse worth wrong year`;

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
const ALLOWED = new Set([...STOP, ...words(COMMON).map(stem)]);

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

function grams(stems: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i + GRAM <= stems.length; i++) out.push(stems.slice(i, i + GRAM).join(" "));
  return out;
}

export interface GuardResult {
  ok: boolean;
  /** Words used by 1 to k-1 notes and not on the common list. */
  words: string[];
  /** Four-word sequences shared with 1 to k-1 notes. */
  phrases: string[];
  placeholders: boolean;
}

export function checkStatement(statement: string, notes: string[], k: number): GuardResult {
  const noteStems = notes.map((n) => words(n).map(stem));
  const noteSets = noteStems.map((s) => new Set(s));
  const noteGrams = noteStems.map((s) => new Set(grams(s)));
  const df = (test: (i: number) => boolean) => notes.reduce((a, _, i) => a + (test(i) ? 1 : 0), 0);
  const rare = (n: number) => n >= 1 && n < k;

  const raw = words(statement);
  const stems = raw.map(stem);
  const flaggedWords = new Set<string>();
  stems.forEach((s, i) => {
    if (!ALLOWED.has(s) && rare(df((j) => noteSets[j].has(s)))) flaggedWords.add(raw[i]);
  });
  const flaggedPhrases = new Set<string>();
  grams(stems).forEach((g, i) => {
    if (rare(df((j) => noteGrams[j].has(g)))) flaggedPhrases.add(raw.slice(i, i + GRAM).join(" "));
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
