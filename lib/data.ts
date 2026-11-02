/** Where pages and route handlers get data. Server-side only.
 *
 * Demo mode reads the synthetic dataset and the saved pipeline outputs at build
 * time; local mode reads the JSON store on every request. Either way, the only
 * thing that leaves this module for a page is the release.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildRelease, type Dataset, type Release } from "./release";
import { readStore } from "./store";
import type { PromptResult, ThemeResult } from "./types";

export const isDemo = process.env.NEXT_PUBLIC_SW_MODE === "demo";

const demoFile = (name: string) => path.join(/* turbopackIgnore: true */ process.cwd(), "data", "demo", name);

async function readOptional<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

export async function loadDataset(): Promise<Dataset> {
  if (!isDemo) return readStore();
  const base = JSON.parse(await readFile(demoFile("dataset.json"), "utf8")) as Dataset;
  const themes = await readOptional<ThemeResult[]>(demoFile("themes.json"), []);
  const prompts = await readOptional<PromptResult[]>(demoFile("prompts.json"), []);
  return { ...base, themes, prompts };
}

export async function getRelease(): Promise<Release> {
  return buildRelease(await loadDataset());
}
