/** Scan the static demo build (out/) for anything that must never ship:
 * the text of any synthetic note, any planted distinctive phrase, raw response
 * fields, or something that looks like an API key. Exits non-zero on a hit.
 *
 *   npm run build:demo   (runs this after `next build`)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { containsMarker } from "./score";
import type { NoteSet } from "./common";

const OUT = "out";
const files: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(html|txt|js|json|css)$/.test(name)) files.push(p);
  }
};
walk(OUT);
const text = files.map((f) => readFileSync(f, "utf8")).join("\n");
// RSC payloads escape quotes; compare against an unescaped, lower-cased copy too.
const plain = text.replace(/\\"/g, '"').toLowerCase();

const sets = ["data/synthetic/notes.json", "data/eval/dev-teams.json", "data/eval/heldout.json"].map(
  (f) => JSON.parse(readFileSync(f, "utf8")) as NoteSet,
);
const notes = sets.flatMap((s) => s.scopes.flatMap((sc) => sc.notes));
const problems: string[] = [];

for (const n of notes) {
  if (plain.includes(n.text.toLowerCase())) problems.push(`note text shipped: "${n.text}"`);
  for (const m of n.markers ?? []) {
    // Markers are checked word-wise against the visible text of each page.
    if (files.some((f) => f.endsWith(".html") && containsMarker(readFileSync(f, "utf8").replace(/<[^>]+>/g, " "), m))) {
      problems.push(`distinctive marker shipped: "${m}"`);
    }
  }
}
for (const key of ['"attrs":', '"note":', '"responses":', '"codes":']) {
  if (plain.includes(key)) problems.push(`raw-data field shipped: ${key}`);
}
if (/sk-[A-Za-z0-9_-]{20,}/.test(text)) problems.push("something that looks like an API key shipped");

console.log(`checked ${files.length} files in ${OUT}/ against ${notes.length} synthetic notes`);
if (problems.length) {
  for (const p of problems) console.error(`  FAIL ${p}`);
  process.exit(1);
}
console.log("  ok: no note text, distinctive phrase, raw response field or key-like string");
