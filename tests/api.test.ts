/** The local-mode API, exercised through its real route handlers against a
 * temporary store. Covers the paths a team member or facilitator can reach. */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as actions from "@/app/api/actions/route.api";
import * as checkin from "@/app/api/checkin/route.api";
import * as discard from "@/app/api/notes/discard/route.api";
import * as release from "@/app/api/release/route.api";
import * as settings from "@/app/api/settings/route.api";
import * as close from "@/app/api/sprints/close/route.api";
import * as sprints from "@/app/api/sprints/route.api";
import * as status from "@/app/api/status/route.api";
import * as themes from "@/app/api/themes/route.api";
import { buildRelease, type Release } from "@/lib/release";
import { readStore } from "@/lib/store";
import { atomSizes, isolatableResponses, releasedSets } from "./attacker";

let dir: string;
const post = (body: unknown) => new Request("http://local/api", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
const read = async (res: Response) => ({ status: res.status, body: (await res.json()) as Record<string, unknown> });

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sw-"));
  process.env.SW_STORE = path.join(dir, "store.json");
  delete process.env.SW_K;
  delete process.env.OPENAI_API_KEY;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const answer = (code: string, extra: Record<string, unknown> = {}) => ({ code, energy: 3, workload: 4, clarity: 2, blocked: false, ...extra });

async function openSprint(codes = 8) {
  const out = await read(await sprints.POST(post({ label: "Sprint 1", codes })));
  expect(out.status).toBe(201);
  return out.body.codes as string[];
}

describe("API: sprint cycle", () => {
  it("releases nothing while open, then only k-anonymous aggregates", async () => {
    await settings.POST(post({ dimensions: [{ id: "subteam", label: "Sub-team", values: ["A", "B"] }, { id: "role", label: "Role", values: ["Dev", "QA"] }] }));
    const codes = await openSprint(8);
    for (const [i, code] of codes.slice(0, 7).entries()) {
      const res = await read(await checkin.POST(post(answer(code, { attrs: { subteam: i < 5 ? "A" : "B" }, note: `distinctive note number ${i}` }))));
      expect(res).toEqual({ status: 201, body: { ok: true } });
    }

    const open = (await read(await release.GET())).body as unknown as Release;
    expect(open.sprints[0].status).toBe("open");
    expect(open.sprints[0].team).toBeNull();

    // The facilitator sees a yes/no, not a count, and cannot change k mid-check-in.
    const st = (await read(await status.GET())).body as { open: Record<string, unknown> };
    expect(st.open.ready).toBe(true);
    expect(JSON.stringify(st)).not.toMatch(/"(responses|n|count)":/);
    expect((await read(await settings.POST(post({ k: 3 })))).status).toBe(400);

    await close.POST();
    const res = await read(await release.GET());
    const rel = res.body as unknown as Release;
    expect(rel.sprints[0].status).toBe("released");
    expect(rel.sprints[0].team!.n).toBe(7);
    // A (5) and B (2): showing A would expose B by subtraction, so neither is shown.
    expect(rel.sprints[0].breakdowns[0].cells.map((c) => c.shown)).toEqual([false, false]);
    // The API returns exactly the audited release, and no raw field or note text.
    expect(rel).toEqual(buildRelease(await readStore()));
    const raw = JSON.stringify(res.body);
    for (const leak of ['"attrs"', '"note"', "distinctive note", '"codes"', '"responses"']) expect(raw).not.toContain(leak);
  });

  it("refuses a used or unknown code with the same message, and refuses late answers", async () => {
    const codes = await openSprint(3);
    expect((await read(await checkin.POST(post(answer(codes[0]))))).status).toBe(201);
    const reused = await read(await checkin.POST(post(answer(codes[0]))));
    const unknown = await read(await checkin.POST(post(answer("ZZZZ-ZZZZ"))));
    expect(reused.status).toBe(400);
    expect(unknown).toEqual(reused);
    await close.POST();
    expect((await read(await checkin.POST(post(answer(codes[1]))))).status).toBe(400);
  });

  it("stores no code, name or time with a response", async () => {
    const codes = await openSprint(2);
    await checkin.POST(post(answer(codes[0], { note: "hello" })));
    const store = readFileSync(process.env.SW_STORE!, "utf8");
    expect(store).not.toContain(codes[0]);
    const data = await readStore();
    expect(Object.keys(data.responses[0]).sort()).toEqual(["attrs", "blocked", "clarity", "energy", "note", "sprint", "workload"]);
  });

  it("rejects invalid answers and unknown group values", async () => {
    const codes = await openSprint(2);
    for (const bad of [answer(codes[0], { energy: 6 }), answer(codes[0], { blocked: "yes" }), answer(codes[0], { attrs: { role: "CTO's assistant" } }), answer(codes[0], { note: "x".repeat(501) })]) {
      expect((await read(await checkin.POST(post(bad)))).status).toBe(400);
    }
  });

  it("refuses k below 3", async () => {
    for (const k of [2, 0, 2.5, "1"]) expect((await read(await settings.POST(post({ k })))).status).toBe(400);
    expect((await read(await settings.POST(post({ k: 3 })))).status).toBe(200);
  });

  it("does not generate themes without a key or for a below-k sprint, and can discard notes", async () => {
    const codes = await openSprint(6);
    for (const code of codes.slice(0, 4)) await checkin.POST(post(answer(code, { note: "n" })));
    await close.POST();
    expect((await read(await themes.POST(post({ sprintId: "s1" })))).status).toBe(400);
    await discard.POST(post({ sprintId: "s1" }));
    expect((await readStore()).responses.every((r) => r.note === undefined)).toBe(true);
    expect((await read(await actions.POST(post({ afterSprint: "s1", text: "x", metric: "energy" })))).status).toBe(201);
  });
});

describe("API: property test", () => {
  it("no sequence of check-ins and closes yields a release that isolates fewer than k responses", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.array(fc.record({ subteam: fc.constantFrom("A", "B", ""), role: fc.constantFrom("Dev", "QA", "Design", "") }), { maxLength: 14 }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.integer({ min: 3, max: 6 }),
        async (sprintAnswers, k) => {
          rmSync(process.env.SW_STORE!, { force: true });
          await settings.POST(post({ k, dimensions: [{ id: "subteam", label: "Sub-team", values: ["A", "B"] }, { id: "role", label: "Role", values: ["Dev", "QA", "Design"] }] }));
          for (const [s, group] of sprintAnswers.entries()) {
            const codes = (await read(await sprints.POST(post({ label: `Sprint ${s + 1}`, codes: 14 })))).body.codes as string[];
            for (const [i, a] of group.entries()) await checkin.POST(post(answer(codes[i], { attrs: a, energy: 1 + (i % 5) })));
            await close.POST();
            await actions.POST(post({ afterSprint: `s${s + 1}`, text: "a", metric: "energy" }));
          }
          const rel = (await read(await release.GET())).body as unknown as Release;
          const data = await readStore();
          const sets = releasedSets(data, rel);
          for (const atom of atomSizes(sets, data.responses.length)) expect(atom.indices.length).toBeGreaterThanOrEqual(k);
          expect(isolatableResponses(sets, data.responses.length)).toEqual([]);
        },
      ),
      { numRuns: 40 },
    );
  });
});
