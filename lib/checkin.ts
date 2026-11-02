/** Validation of a submitted check-in, and the single-use codes that admit it. */

import { createHash, randomInt } from "node:crypto";

import { QUESTION_IDS, type CheckinResponse, type Dimension, type Score } from "./types";

export const NOTE_MAX_CHARS = 500;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export class CheckinError extends Error {}

export function newCode(): string {
  const pick = () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${Array.from({ length: 4 }, pick).join("")}-${Array.from({ length: 4 }, pick).join("")}`;
}

/** Codes are stored only as hashes, so the store cannot show which code was used. */
export function hashCode(sprintId: string, code: string): string {
  const normalised = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return createHash("sha256").update(`${sprintId}:${normalised}`).digest("hex");
}

/** Parse a submitted check-in. Unknown attribute values are refused rather than
 * stored, because a free-text "role" could identify someone. */
export function parseCheckin(body: unknown, dimensions: Dimension[]): { code: string; answer: Omit<CheckinResponse, "sprint"> } {
  if (typeof body !== "object" || body === null) throw new CheckinError("expected a JSON object");
  const b = body as Record<string, unknown>;
  if (typeof b.code !== "string" || b.code.trim() === "") throw new CheckinError("a check-in code is required");
  const scores = {} as Record<(typeof QUESTION_IDS)[number], Score>;
  for (const q of QUESTION_IDS) {
    const v = b[q];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 5) throw new CheckinError(`${q} must be an integer from 1 to 5`);
    scores[q] = v as Score;
  }
  if (typeof b.blocked !== "boolean") throw new CheckinError("blocked must be true or false");
  const attrs: Record<string, string> = {};
  const given = (typeof b.attrs === "object" && b.attrs !== null ? b.attrs : {}) as Record<string, unknown>;
  for (const [key, value] of Object.entries(given)) {
    if (value === undefined || value === null || value === "") continue;
    const dim = dimensions.find((d) => d.id === key);
    if (!dim) throw new CheckinError(`unknown attribute ${JSON.stringify(key)}`);
    if (typeof value !== "string" || !dim.values.includes(value)) throw new CheckinError(`unknown ${dim.label.toLowerCase()}`);
    attrs[key] = value;
  }
  let note: string | undefined;
  if (b.note !== undefined && b.note !== null) {
    if (typeof b.note !== "string") throw new CheckinError("note must be text");
    const trimmed = b.note.trim();
    if (trimmed.length > NOTE_MAX_CHARS) throw new CheckinError(`note must be at most ${NOTE_MAX_CHARS} characters`);
    if (trimmed) note = trimmed;
  }
  return { code: b.code, answer: { ...scores, blocked: b.blocked, attrs, ...(note ? { note } : {}) } };
}
