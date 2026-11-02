/** Shared data model. Nothing here identifies a person: a response has no
 * member id, no timestamp and no link to the code used to submit it. */

export const QUESTIONS = [
  {
    id: "energy",
    label: "Energy",
    prompt: "How was your energy this sprint?",
    low: "Drained",
    high: "Energised",
  },
  {
    id: "workload",
    label: "Workload",
    prompt: "How manageable was your workload?",
    low: "Unmanageable",
    high: "Very manageable",
  },
  {
    id: "clarity",
    label: "Goal clarity",
    prompt: "How clear were the sprint goals?",
    low: "Unclear",
    high: "Very clear",
  },
] as const;

export type QuestionId = (typeof QUESTIONS)[number]["id"];
export const QUESTION_IDS: QuestionId[] = QUESTIONS.map((q) => q.id);

export const BLOCKED_PROMPT = "Were you blocked for a day or more this sprint?";

export type Score = 1 | 2 | 3 | 4 | 5;

export interface CheckinResponse {
  sprint: string;
  energy: Score;
  workload: Score;
  clarity: Score;
  blocked: boolean;
  /** Self-reported and optional; absent means "prefer not to say". */
  attrs: Record<string, string>;
  /** Optional free text. Never released; only used for themes, then deleted. */
  note?: string;
}

export interface Dimension {
  id: string;
  label: string;
  values: string[];
}

export interface Sprint {
  id: string;
  label: string;
  /** Position in time; trends are ordered by it. */
  index: number;
  status: "open" | "closed";
  /** Settings frozen when check-in closes. A closed sprint's release is a pure
   * function of its responses and these, so it never changes afterwards. */
  frozen?: { k: number; dimensions: Dimension[] };
}

export interface ActionItem {
  id: string;
  /** The action was agreed in the retro after this sprint. */
  afterSprint: string;
  text: string;
  metric: QuestionId;
}

/** A theme as stored after the pipeline: statement and support count only. */
export interface StoredTheme {
  statement: string;
  topic: string;
  polarity: "concern" | "positive" | "mixed";
  support: number;
}

export interface ThemeResult {
  sprint: string;
  notes: number;
  themes: StoredTheme[];
  withheld: number;
  model: string;
  generatedAt: string;
  costUsd: number | null;
  /** Provenance of a saved run, shown in the demo. */
  source?: string;
}

export interface RetroPrompt {
  question: string;
  why: string;
  basedOn: string[];
}

export interface PromptResult {
  sprint: string;
  prompts: RetroPrompt[];
  model: string;
  generatedAt: string;
  costUsd: number | null;
  source?: string;
}
