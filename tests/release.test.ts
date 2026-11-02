import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { ConfigError, parseK } from "@/lib/config";
import { buildRelease, planSprint, type Dataset } from "@/lib/release";
import type { CheckinResponse, Dimension, Score, Sprint } from "@/lib/types";
import { atomSizes, isolatableResponses, releasedSets, smallestDifference } from "./attacker";

const DIMS: Dimension[] = [
  { id: "subteam", label: "Sub-team", values: ["Payments", "Platform", "Mobile"] },
  { id: "role", label: "Role", values: ["Developer", "QA", "Design", "Product"] },
];

const score = fc.integer({ min: 1, max: 5 }) as fc.Arbitrary<Score>;
// Skewed so that small groups, missing attributes and near-subset groups are common.
const attrValue = (values: string[]) =>
  fc.oneof(
    { weight: 5, arbitrary: fc.constant(values[0]) },
    { weight: 3, arbitrary: fc.constantFrom(...values.slice(1)) },
    { weight: 1, arbitrary: fc.constant(undefined) },
  );

const responseArb = (sprint: string) =>
  fc
    .record({
      energy: score,
      workload: score,
      clarity: score,
      blocked: fc.boolean(),
      subteam: attrValue(DIMS[0].values),
      role: attrValue(DIMS[1].values),
    })
    .map(({ subteam, role, ...rest }): CheckinResponse => {
      const attrs: Record<string, string> = {};
      if (subteam) attrs.subteam = subteam;
      if (role) attrs.role = role;
      return { sprint, attrs, ...rest };
    });

const datasetArb: fc.Arbitrary<Dataset> = fc
  .record({
    k: fc.integer({ min: 3, max: 7 }),
    sprintSpecs: fc.array(fc.record({ size: fc.integer({ min: 0, max: 28 }), closed: fc.boolean() }), {
      minLength: 1,
      maxLength: 4,
    }),
    actionSpecs: fc.array(fc.record({ after: fc.nat(), metric: fc.constantFrom("energy", "workload", "clarity") }), {
      maxLength: 3,
    }),
  })
  .chain(({ k, sprintSpecs, actionSpecs }) => {
    const sprints: Sprint[] = sprintSpecs.map((s, i) => ({
      id: `s${i + 1}`,
      label: `Sprint ${i + 1}`,
      index: i + 1,
      status: s.closed || i < sprintSpecs.length - 1 ? "closed" : "open",
      frozen: s.closed || i < sprintSpecs.length - 1 ? { k, dimensions: DIMS } : undefined,
    }));
    const responses = fc.tuple(...sprintSpecs.map((s, i) => fc.array(responseArb(`s${i + 1}`), { minLength: s.size, maxLength: s.size })));
    return responses.map((perSprint) => ({
      k,
      dimensions: DIMS,
      sprints,
      responses: perSprint.flat(),
      actions: actionSpecs.map((a, i) => ({
        id: `a${i + 1}`,
        afterSprint: sprints[a.after % sprints.length].id,
        text: "action",
        metric: a.metric as "energy" | "workload" | "clarity",
      })),
      themes: [],
      prompts: [],
    }));
  });

const kOf = (ds: Dataset, sprint: string) => ds.sprints.find((s) => s.id === sprint)!.frozen?.k ?? Infinity;

describe("release: property tests", () => {
  it("every released aggregate covers at least k responses", () => {
    fc.assert(
      fc.property(datasetArb, (ds) => {
        const release = buildRelease(ds);
        for (const s of release.sprints) {
          if (s.team) expect(s.team.n).toBeGreaterThanOrEqual(s.k!);
          for (const b of s.breakdowns) for (const c of b.cells) if (c.shown) expect(c.stats.n).toBeGreaterThanOrEqual(s.k!);
        }
        for (const a of release.actions) {
          for (const w of [a.before, a.after]) if (w) expect(w.n).toBeGreaterThanOrEqual(ds.k);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("no difference of released sets (across groups, dimensions, sprints and windows) isolates fewer than k responses", () => {
    fc.assert(
      fc.property(datasetArb, (ds) => {
        const release = buildRelease(ds);
        const sets = releasedSets(ds, release);
        for (const atom of atomSizes(sets, ds.responses.length)) {
          const sprint = ds.responses[atom.indices[0]].sprint;
          // An atom never spans two sprints, and is never smaller than k.
          expect(new Set(atom.indices.map((i) => ds.responses[i].sprint)).size).toBe(1);
          expect(atom.indices.length).toBeGreaterThanOrEqual(kOf(ds, sprint));
        }
        const diff = smallestDifference(sets, ds.responses.length);
        if (diff) expect(diff.support).toBeGreaterThanOrEqual(ds.k);
      }),
      { numRuns: 300 },
    );
  });

  it("no single response can be solved for from any linear combination of released aggregates", () => {
    fc.assert(
      fc.property(datasetArb, (ds) => {
        const release = buildRelease(ds);
        const sets = releasedSets(ds, release);
        expect(isolatableResponses(sets, ds.responses.length)).toEqual([]);
      }),
      { numRuns: 150 },
    );
  });

  it("hidden cells, open sprints and below-k sprints carry no numbers", () => {
    fc.assert(
      fc.property(datasetArb, (ds) => {
        const release = buildRelease(ds);
        for (const s of release.sprints) {
          if (s.status !== "released") {
            expect(s.team).toBeNull();
            expect(s.breakdowns).toEqual([]);
            expect(s.themes).toBeNull();
            expect(s.prompts).toBeNull();
          }
          for (const b of s.breakdowns) {
            for (const c of b.cells) if (!c.shown) expect(Object.keys(c).sort()).toEqual(["dimension", "shown", "value"]);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it("the release does not depend on the order responses were stored in", () => {
    fc.assert(
      fc.property(datasetArb, fc.integer(), (ds, seed) => {
        const shuffled = [...ds.responses];
        let x = seed;
        for (let i = shuffled.length - 1; i > 0; i--) {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          const j = x % (i + 1);
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        expect(buildRelease({ ...ds, responses: shuffled })).toEqual(buildRelease(ds));
      }),
      { numRuns: 150 },
    );
  });

  it("changing k or the dimensions later does not change a closed sprint's release", () => {
    fc.assert(
      fc.property(datasetArb, fc.integer({ min: 3, max: 9 }), (ds, newK) => {
        const before = buildRelease(ds);
        const after = buildRelease({ ...ds, k: newK, dimensions: [DIMS[1]] });
        expect(after.sprints).toEqual(before.sprints);
      }),
      { numRuns: 100 },
    );
  });

  it("themes backed by fewer than k notes are never released", () => {
    fc.assert(
      fc.property(datasetArb, fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 6 }), (ds, supports) => {
        const themes = ds.sprints.map((s) => ({
          sprint: s.id,
          notes: 12,
          themes: supports.map((support, i) => ({ statement: `t${i}`, topic: "other", polarity: "concern" as const, support })),
          withheld: 0,
          model: "test",
          generatedAt: "2026-11-02",
          costUsd: 0,
        }));
        const release = buildRelease({ ...ds, themes });
        for (const s of release.sprints) {
          if (s.status !== "released") expect(s.themes).toBeNull();
          for (const t of s.themes?.themes ?? []) expect(t.support).toBeGreaterThanOrEqual(s.k!);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe("release: worked examples", () => {
  const r = (sprint: string, attrs: Record<string, string>, energy: Score = 3): CheckinResponse => ({
    sprint,
    energy,
    workload: 3,
    clarity: 3,
    blocked: false,
    attrs,
  });
  const many = (n: number, attrs: Record<string, string>, sprint = "s1") => Array.from({ length: n }, () => r(sprint, attrs));

  it("secondary suppression: a group is hidden when the rest would be fewer than k", () => {
    const rs = [...many(6, { role: "Developer" }), ...many(5, { role: "QA" }), ...many(3, { role: "Design" })];
    const plan = planSprint(rs, [DIMS[1]], 5);
    // Developer (6) is shown; showing QA (5) as well would expose Design (3) = 14 - 6 - 5.
    expect([...plan.shown.get("role")!]).toEqual(["Developer"]);
  });

  it("people who prefer not to say are protected too", () => {
    const rs = [...many(6, { role: "Developer" }), ...many(2, {})];
    // Team (8) minus Developer (6) would reveal the 2 who did not state a role.
    expect([...planSprint(rs, [DIMS[1]], 5).shown.get("role")!]).toEqual([]);
  });

  it("cross-dimension differencing: a near-subset group in another dimension is suppressed", () => {
    // All 5 QA are in Payments; Payments has 6. Payments - QA would be one person.
    const rs = [
      ...many(5, { subteam: "Payments", role: "QA" }),
      ...many(1, { subteam: "Payments", role: "Developer" }),
      ...many(6, { subteam: "Platform", role: "Developer" }),
    ];
    // On its own, the role breakdown is safe: Developer 7, QA 5.
    expect([...planSprint(rs, [DIMS[1]], 5).shown.get("role")!].sort()).toEqual(["Developer", "QA"]);
    // With sub-teams released first (6 and 6), QA would let Payments - QA expose one
    // person, and Developer would split Payments 1 / Platform 6. Both roles are hidden.
    const plan = planSprint(rs, DIMS, 5);
    expect([...plan.shown.get("subteam")!].sort()).toEqual(["Payments", "Platform"]);
    expect([...plan.shown.get("role")!]).toEqual([]);
  });

  it("before/after windows skip sprints whose team aggregate was not released", () => {
    const sprints: Sprint[] = [1, 2, 3, 4].map((i) => ({
      id: `s${i}`,
      label: `Sprint ${i}`,
      index: i,
      status: "closed",
      frozen: { k: 5, dimensions: [] },
    }));
    const responses = [...many(6, {}, "s1"), ...many(3, {}, "s2"), ...many(6, {}, "s3"), ...many(7, {}, "s4")];
    const release = buildRelease({
      k: 5,
      dimensions: [],
      sprints,
      responses,
      actions: [{ id: "a1", afterSprint: "s2", text: "x", metric: "energy" }],
      themes: [],
      prompts: [],
    });
    expect(release.sprints.map((s) => s.status)).toEqual(["released", "below-k", "released", "released"]);
    expect(release.actions[0].before!.sprints).toEqual(["s1"]);
    expect(release.actions[0].after!.sprints).toEqual(["s3", "s4"]);
  });
});

describe("k configuration", () => {
  it("defaults are refused below 3 and never clamped", () => {
    expect(parseK(5)).toBe(5);
    expect(parseK("3")).toBe(3);
    for (const bad of [2, 0, -1, 2.5, "two", "", null, undefined, 51]) expect(() => parseK(bad)).toThrow(ConfigError);
  });
});
