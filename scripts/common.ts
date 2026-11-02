/** Helpers shared by the evaluation and demo scripts. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import OpenAI from "openai";

import { LLMError, type CallMeta } from "../lib/llm/client";

export interface PlantedTheme {
  id: string;
  summary: string;
}

export interface LabelledNote {
  text: string;
  themes: string[];
  markers?: string[];
}

export interface Scope {
  id: string;
  label: string;
  planted: PlantedTheme[];
  notes: LabelledNote[];
}

export interface NoteSet {
  k: number;
  scopes: Scope[];
}

export const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

export function writeJson(file: string, data: unknown): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

/** Load KEY=VALUE lines without overriding variables already set, and without
 * printing anything. */
export function loadEnv(file: string | undefined): void {
  if (!file || !existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A fixed shuffle per (scope, run), shared by every model so they see the same order. */
export function seededInt(scope: string, run: number): (n: number) => number {
  let h = 2166136261;
  for (const c of `${scope}#${run}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = mulberry32(h);
  return (n) => Math.floor(rand() * n);
}

export const LEDGER = "runs/ledger.jsonl";

export function ledgerTotal(): number {
  if (!existsSync(LEDGER)) return 0;
  return readFileSync(LEDGER, "utf8")
    .split("\n")
    .filter(Boolean)
    .reduce((a, line) => a + ((JSON.parse(line) as { costUsd: number | null }).costUsd ?? 0), 0);
}

export function recordCall(meta: CallMeta, context: Record<string, unknown>): void {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  appendFileSync(LEDGER, `${JSON.stringify({ at: new Date().toISOString(), ...context, ...meta })}\n`);
}

/** Run async jobs with at most `limit` in flight. After the first error no new
 * job starts; jobs already running finish, then the error is rethrown. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  let failure: unknown = null;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length && failure === null) {
        const i = next++;
        try {
          out[i] = await fn(items[i]);
        } catch (e) {
          failure ??= e;
        }
      }
    }),
  );
  if (failure !== null) throw failure;
  return out;
}

/** Errors that say nothing about the model (budget cap, auth, quota, rate limit,
 * server, network): the benchmark stops and caches nothing, so a rerun resumes. */
export function stopsBenchmark(e: unknown): boolean {
  if (e instanceof LLMError) return e.message.startsWith("budget");
  if (e instanceof OpenAI.APIError) return e.status === undefined || [401, 403, 429].includes(e.status) || e.status >= 500;
  return false;
}

const TRANSIENT = /^(Error: )?(401|403|429|5\d\d)\b|no credits|connection error|timed out/i;

/** A cached run, or null if there is none or it only records a transient error
 * (older caches stored those as failed runs). */
export function cached<T extends { ok: boolean; error?: string }>(file: string): T | null {
  if (!existsSync(file)) return null;
  const run = readJson<T>(file);
  return !run.ok && TRANSIENT.test(run.error ?? "") ? null : run;
}
