/** An observer who sees the whole release and knows the raw membership of every
 * released set (the strongest position: they know who is in which sub-team and
 * role). Written independently of lib/release.ts so the tests do not reuse the
 * code they check. */

import type { Dataset, Release } from "@/lib/release";

export interface ReleasedSet {
  label: string;
  members: boolean[];
}

/** Every set whose sum, count or mean appears anywhere in the release, as a 0/1
 * vector over all responses of all sprints. */
export function releasedSets(ds: Dataset, release: Release): ReleasedSet[] {
  const universe = ds.responses;
  const sets: ReleasedSet[] = [];
  for (const s of release.sprints) {
    if (s.team) sets.push({ label: `${s.id}/team`, members: universe.map((r) => r.sprint === s.id) });
    for (const b of s.breakdowns) {
      for (const c of b.cells) {
        if (!c.shown) continue;
        sets.push({
          label: `${s.id}/${c.dimension}=${c.value}`,
          members: universe.map((r) => r.sprint === s.id && r.attrs[c.dimension] === c.value),
        });
      }
    }
  }
  for (const a of release.actions) {
    for (const w of [a.before, a.after]) {
      if (!w) continue;
      sets.push({ label: `${a.id}/window:${w.sprints.join("+")}`, members: universe.map((r) => w.sprints.includes(r.sprint)) });
    }
  }
  return sets;
}

/** Group responses by which released sets they belong to. */
export function atomSizes(sets: ReleasedSet[], size: number): { indices: number[] }[] {
  const byKey = new Map<string, number[]>();
  for (let i = 0; i < size; i++) {
    const key = sets.map((s) => (s.members[i] ? 1 : 0)).join("");
    if (!key.includes("1")) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), i]);
  }
  return [...byKey.values()].map((indices) => ({ indices }));
}

function rank(rows: number[][]): number {
  const m = rows.map((r) => [...r]);
  let rk = 0;
  const cols = m[0]?.length ?? 0;
  for (let c = 0; c < cols && rk < m.length; c++) {
    let pivot = rk;
    for (let r = rk + 1; r < m.length; r++) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-9) continue;
    [m[rk], m[pivot]] = [m[pivot], m[rk]];
    for (let r = 0; r < m.length; r++) {
      if (r === rk) continue;
      const f = m[r][c] / m[rk][c];
      if (f !== 0) for (let j = c; j < cols; j++) m[r][j] -= f * m[rk][j];
    }
    rk++;
  }
  return rk;
}

/** Indices of responses whose individual answers an observer could solve for by
 * adding and subtracting released aggregates: e_i lies in the row space. */
export function isolatableResponses(sets: ReleasedSet[], size: number): number[] {
  if (sets.length === 0) return [];
  const rows = sets.map((s) => s.members.map((b) => (b ? 1 : 0)));
  const base = rank(rows);
  const found: number[] = [];
  for (let i = 0; i < size; i++) {
    if (!sets.some((s) => s.members[i])) continue;
    const unit = Array.from({ length: size }, (_, j) => (j === i ? 1 : 0));
    if (rank([...rows, unit]) === base) found.push(i);
  }
  return found;
}

/** Signed combinations of up to `depth` released sets that produce a 0/1 vector:
 * the classic differencing attacks (A - B, A - B - C, A + B - C ...). Returns the
 * smallest non-empty support found. */
export function smallestDifference(sets: ReleasedSet[], size: number, depth = 3): { support: number; labels: string[] } | null {
  let best: { support: number; labels: string[] } | null = null;
  const vec = (s: ReleasedSet): number[] => s.members.map((b) => (b ? 1 : 0));
  const consider = (v: number[], labels: string[]) => {
    if (!v.every((x) => x === 0 || x === 1)) return;
    const support = v.reduce((a: number, b) => a + b, 0);
    if (support > 0 && (!best || support < best.support)) best = { support, labels };
  };
  const n = sets.length;
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (a === b) continue;
      const va = vec(sets[a]);
      const vb = vec(sets[b]);
      const d = va.map((x, i) => x - vb[i]);
      consider(d, [sets[a].label, `-${sets[b].label}`]);
      if (depth < 3) continue;
      for (let c = b + 1; c < n; c++) {
        if (c === a) continue;
        const vc = vec(sets[c]);
        consider(d.map((x, i) => x - vc[i]), [sets[a].label, `-${sets[b].label}`, `-${sets[c].label}`]);
        consider(d.map((x, i) => x + vc[i]), [sets[a].label, `-${sets[b].label}`, `+${sets[c].label}`]);
      }
    }
  }
  void size;
  return best;
}
