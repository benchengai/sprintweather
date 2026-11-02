/** Local-mode store: one JSON file on disk.
 *
 * What it deliberately does not hold: member names or ids, timestamps on
 * responses, the code a response was submitted with, or the order responses
 * arrived in (each one is inserted at a random position). Notes are deleted
 * once themes have been generated for their sprint.
 */

import { randomInt } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { CheckinError, hashCode, newCode, parseCheckin } from "./checkin";
import { DEFAULT_K, parseK } from "./config";
import type { Dataset } from "./release";
import type { ActionItem, Dimension, PromptResult, QuestionId, Sprint, ThemeResult } from "./types";
import { QUESTION_IDS } from "./types";

export interface StoreData extends Dataset {
  version: 1;
  /** Per sprint: hashes of issued codes and of used codes, both kept sorted. */
  codes: Record<string, { issued: string[]; used: string[] }>;
}

export const DEFAULT_DIMENSIONS: Dimension[] = [
  { id: "subteam", label: "Sub-team", values: [] },
  { id: "role", label: "Role", values: ["Developer", "QA", "Design", "Product"] },
];

export function emptyStore(k = DEFAULT_K): StoreData {
  return { version: 1, k, dimensions: DEFAULT_DIMENSIONS, sprints: [], responses: [], actions: [], themes: [], prompts: [], codes: {} };
}

export function storePath(): string {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.SW_STORE ?? ".data/store.json");
}

export async function readStore(file = storePath()): Promise<StoreData> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as StoreData;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyStore(process.env.SW_K ? parseK(process.env.SW_K) : DEFAULT_K);
    throw e;
  }
}

async function writeStore(data: StoreData, file = storePath()): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, file);
}

let queue: Promise<unknown> = Promise.resolve();

/** Read-modify-write under an in-process lock. */
export function mutate<T>(fn: (data: StoreData) => T | Promise<T>, file = storePath()): Promise<T> {
  const run = queue.then(async () => {
    const data = await readStore(file);
    const result = await fn(data);
    await writeStore(data, file);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export class StoreError extends Error {}

export function openSprint(data: StoreData): Sprint | undefined {
  return data.sprints.find((s) => s.status === "open");
}

export function createSprint(data: StoreData, label: string, codeCount: number): { sprint: Sprint; codes: string[] } {
  if (openSprint(data)) throw new StoreError("close the open sprint's check-in first");
  if (!label.trim()) throw new StoreError("a sprint label is required");
  if (!Number.isInteger(codeCount) || codeCount < 1 || codeCount > 200) throw new StoreError("issue between 1 and 200 codes");
  const index = Math.max(0, ...data.sprints.map((s) => s.index)) + 1;
  const sprint: Sprint = { id: `s${index}`, label: label.trim(), index, status: "open" };
  const codes = Array.from({ length: codeCount }, newCode);
  data.sprints.push(sprint);
  data.codes[sprint.id] = { issued: codes.map((c) => hashCode(sprint.id, c)).sort(), used: [] };
  return { sprint, codes };
}

export function submitCheckin(data: StoreData, body: unknown): void {
  const sprint = openSprint(data);
  if (!sprint) throw new CheckinError("check-in is not open");
  const { code, answer } = parseCheckin(body, data.dimensions);
  const hash = hashCode(sprint.id, code);
  const codes = data.codes[sprint.id];
  // One message for unknown and used codes, so the reply does not reveal which.
  if (!codes || !codes.issued.includes(hash) || codes.used.includes(hash)) throw new CheckinError("this code is not valid for the open check-in");
  codes.used.push(hash);
  codes.used.sort();
  data.responses.splice(randomInt(data.responses.length + 1), 0, { sprint: sprint.id, ...answer });
}

/** Whether the open sprint has reached k responses, as a yes/no (no running count). */
export function readyToClose(data: StoreData): boolean {
  const sprint = openSprint(data);
  return !!sprint && data.responses.filter((r) => r.sprint === sprint.id).length >= data.k;
}

export function closeSprint(data: StoreData): Sprint {
  const sprint = openSprint(data);
  if (!sprint) throw new StoreError("no open check-in to close");
  sprint.status = "closed";
  sprint.frozen = { k: data.k, dimensions: structuredClone(data.dimensions) };
  return sprint;
}

export function notesFor(data: StoreData, sprintId: string): string[] {
  return data.responses.filter((r) => r.sprint === sprintId && r.note).map((r) => r.note!);
}

/** Delete the free text of a sprint (after themes, or on request). */
export function discardNotes(data: StoreData, sprintId: string): void {
  for (const r of data.responses) if (r.sprint === sprintId) delete r.note;
}

export function saveThemes(data: StoreData, result: ThemeResult): void {
  if (data.themes.some((t) => t.sprint === result.sprint)) throw new StoreError("themes for this sprint already exist");
  data.themes.push(result);
  discardNotes(data, result.sprint);
}

export function savePrompts(data: StoreData, result: PromptResult): void {
  data.prompts = [...data.prompts.filter((p) => p.sprint !== result.sprint), result];
}

export function addAction(data: StoreData, input: { afterSprint?: unknown; text?: unknown; metric?: unknown }): ActionItem {
  const sprint = data.sprints.find((s) => s.id === input.afterSprint && s.status === "closed");
  if (!sprint) throw new StoreError("pick a closed sprint");
  if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 200) throw new StoreError("describe the action in 1 to 200 characters");
  if (!QUESTION_IDS.includes(input.metric as QuestionId)) throw new StoreError("pick a metric");
  const action: ActionItem = { id: `a${data.actions.length + 1}`, afterSprint: sprint.id, text: input.text.trim(), metric: input.metric as QuestionId };
  data.actions.push(action);
  return action;
}

/** Settings apply to sprints closed from now on; closed sprints keep what was frozen. */
export function updateSettings(data: StoreData, input: { k?: unknown; dimensions?: unknown }): void {
  // Locked during a check-in: toggling k and watching "ready to close" would count responses.
  if (openSprint(data)) throw new StoreError("change settings between sprints, not during a check-in");
  if (input.k !== undefined) data.k = parseK(input.k);
  if (input.dimensions !== undefined) {
    const dims = input.dimensions as Dimension[];
    if (!Array.isArray(dims)) throw new StoreError("dimensions must be a list");
    data.dimensions = dims.map((d) => ({
      id: String(d.id),
      label: String(d.label),
      values: [...new Set((d.values ?? []).map((v) => String(v).trim()).filter(Boolean))],
    }));
  }
}

export function themesFor(data: StoreData, sprintId: string): ThemeResult | undefined {
  return data.themes.find((t) => t.sprint === sprintId);
}
