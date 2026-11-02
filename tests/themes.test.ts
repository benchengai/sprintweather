import { describe, expect, it } from "vitest";

import type { CallMeta, JsonCaller, JsonRequest } from "@/lib/llm/client";
import { checkStatement, longestSharedRun, scrub, stem } from "@/lib/themes/guard";
import { extractThemes } from "@/lib/themes/pipeline";

const META: CallMeta = { model: "stub", requestId: null, inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0, latencyS: 0, costUsd: 0 };

/** Note ids by note text, read back from the prompt the pipeline sent. */
function idsByText(prompt: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of prompt.matchAll(/^\s*\[(n\d+)\] (.*)$/gm)) out.set(m[2], m[1]);
  return out;
}

interface StubTheme {
  statement: string;
  /** Cite notes containing this word. */
  cites: string;
}

function stub(themes: StubTheme[], opts: { judgeDrops?: string; judgeAdds?: boolean; rewrite?: (s: string) => string } = {}) {
  const requests: JsonRequest[] = [];
  let notes = new Map<string, string>();
  const call: JsonCaller = async (req) => {
    requests.push(req);
    if (req.name === "themes") {
      notes = idsByText(req.prompt);
      const out = themes.map((t) => ({
        statement: t.statement,
        topic: "process",
        polarity: "concern",
        note_ids: [...notes].filter(([text]) => text.toLowerCase().includes(t.cites.toLowerCase())).map(([, id]) => id),
      }));
      return { text: JSON.stringify({ themes: out }), meta: META };
    }
    if (req.name === "support") {
      const judgements = [...req.prompt.matchAll(/^Theme (t\d+): .*\nCited notes:\n((?:  \[n\d+\] .*\n?)*)/gm)].map((m) => {
        let ids = [...m[2].matchAll(/\[(n\d+)\] (.*)/g)].filter(([, , text]) => !opts.judgeDrops || !text.includes(opts.judgeDrops)).map(([, id]) => id);
        if (opts.judgeAdds) ids = [...notes.values()];
        return { theme_id: m[1], supported_note_ids: ids };
      });
      return { text: JSON.stringify({ judgements }), meta: META };
    }
    if (req.name === "rewrite") {
      const rewrites = [...req.prompt.matchAll(/^Theme (t\d+): (.*)$/gm)].map((m) => ({ theme_id: m[1], statement: opts.rewrite ? opts.rewrite(m[2]) : m[2] }));
      return { text: JSON.stringify({ rewrites }), meta: META };
    }
    throw new Error(`unexpected call ${req.name}`);
  };
  return { call, requests };
}

const REVIEW = [
  "Code reviews sat for two days before anyone looked at them.",
  "Waiting on reviews again, my PRs were idle most of the week.",
  "Reviews are slow, nobody picks them up until standup.",
  "Pull requests wait too long for a review.",
  "Review turnaround is the bottleneck for me.",
  "Felt like herding caffeinated squirrels while waiting for reviews.",
];
const OTHER = ["The office wifi drops in the afternoon.", "Good sprint overall.", "Wifi was flaky during calls."];

describe("theme pipeline", () => {
  it("makes no call at all when there are fewer than k notes", async () => {
    const { call, requests } = stub([]);
    const r = await extractThemes(REVIEW.slice(0, 4), { k: 5, call });
    expect(requests).toHaveLength(0);
    expect(r.themes).toEqual([]);
  });

  it("releases a theme backed by at least k verified notes", async () => {
    const { call } = stub([{ statement: "Code reviews take too long to be picked up.", cites: "review" }]);
    const r = await extractThemes([...REVIEW, ...OTHER], { k: 5, call });
    expect(r.themes).toHaveLength(1);
    expect(r.themes[0].support).toBeGreaterThanOrEqual(5);
    expect(r.themes[0].supportIdx.every((i) => /review/i.test([...REVIEW, ...OTHER][i]))).toBe(true);
  });

  it("withholds a theme the model claims fewer than k notes for, without verifying it", async () => {
    const { call, requests } = stub([{ statement: "The office wifi is unreliable.", cites: "ifi" }]);
    const r = await extractThemes([...REVIEW, ...OTHER], { k: 5, call });
    expect(r.themes).toEqual([]);
    expect(r.withheld[0].reason).toBe("claimed-below-k");
    expect(requests.map((q) => q.name)).toEqual(["themes"]);
  });

  it("counts only notes the judge confirms, and the judge cannot add notes", async () => {
    // Cites 6 review notes; the judge rejects the two that mention "PR" or "Pull".
    const dropped = stub([{ statement: "Code reviews take too long to be picked up.", cites: "review" }], { judgeDrops: "P" });
    const r = await extractThemes([...REVIEW, ...OTHER], { k: 5, call: dropped.call });
    expect(r.themes).toEqual([]);
    expect(r.withheld[0].reason).toBe("verified-below-k");

    const padded = stub([{ statement: "The wifi is unreliable.", cites: "Wifi" }], { judgeAdds: true });
    // Two wifi notes cited; the judge "confirms" all nine notes, but only citations count.
    const r2 = await extractThemes([...REVIEW, ...OTHER], { k: 2, call: padded.call });
    expect(r2.themes[0].support).toBe(2);
  });

  it("rewrites a statement that echoes one note's wording, and withholds it if the rewrite still does", async () => {
    const echo = "Reviews felt like herding caffeinated squirrels.";
    const fixed = stub([{ statement: echo, cites: "review" }], { rewrite: () => "Code reviews take too long to be picked up." });
    const r = await extractThemes([...REVIEW, ...OTHER], { k: 5, call: fixed.call });
    expect(r.guard).toEqual({ flagged: 1, rewritten: 1 });
    expect(r.themes[0].statement).toBe("Code reviews take too long to be picked up.");
    expect(r.themes[0].rewritten).toBe(true);
    const rewritePrompt = fixed.requests.find((q) => q.name === "rewrite")!.prompt;
    expect(rewritePrompt).toContain("squirrels");

    const stubborn = stub([{ statement: echo, cites: "review" }]);
    const r2 = await extractThemes([...REVIEW, ...OTHER], { k: 5, call: stubborn.call });
    expect(r2.themes).toEqual([]);
    expect(r2.withheld[0].reason).toBe("wording");
  });

  it("never sends roles, scores or unscrubbed identifiers to the model", async () => {
    const { call, requests } = stub([{ statement: "Code reviews take too long to be picked up.", cites: "review" }]);
    const notes = [...REVIEW, "Ping me at sam.lee@example.com or @samlee about PAY-1234, see https://x.example/y"];
    await extractThemes(notes, { k: 5, call });
    const sent = requests.map((q) => q.prompt).join("\n");
    for (const leak of ["sam.lee@example.com", "@samlee", "PAY-1234", "https://x.example/y"]) expect(sent).not.toContain(leak);
  });
});

describe("wording guard", () => {
  const notes = [...REVIEW, ...OTHER];

  it("allows words at least k notes share, and common words", () => {
    expect(checkStatement("Reviews wait too long.", notes, 5).ok).toBe(true);
    expect(checkStatement("Code reviews take too long to be picked up.", notes, 5).ok).toBe(true);
  });

  it("flags a rare word or a four-word sequence from fewer than k notes", () => {
    const g = checkStatement("Herding squirrels while waiting.", notes, 5);
    expect(g.ok).toBe(false);
    expect(g.words).toEqual(expect.arrayContaining(["herding", "squirrels"]));
    const p = checkStatement("Reviews sat for two days before anyone looked.", notes, 5);
    expect(p.phrases.length).toBeGreaterThan(0);
  });

  it("allows a domain word several notes share, but holds names to k notes", () => {
    const store = ["The app store review took days.", "Waiting on store approval again.", "Store review delays hurt.", "Release slipped.", "Fine."];
    expect(checkStatement("Store review held up releases.", store, 5).ok).toBe(true);
    const named = ["Since Marta left nobody owns releases.", "We miss Marta on reviews.", "Reviews are slow.", "Fine.", "Ok."];
    expect(checkStatement("Work slowed after Marta left.", named, 5).words).toContain("marta");
    // A capital at the start of a sentence is not a name.
    expect(checkStatement("Reviews wait too long.", ["Reviews are slow. Reviews pile up.", "Reviews again.", "x", "y", "z"], 5).ok).toBe(true);
  });

  it("flags placeholders left by scrubbing", () => {
    expect(checkStatement("People asked about [ticket].", notes, 5).placeholders).toBe(true);
  });

  it("scrubs identifiers and stems consistently", () => {
    expect(scrub("mail a.b@c.io, @dana, JIRA-42, 1234 and https://e.f")).toBe("mail [email], [someone], [ticket], [number] and [link]");
    expect(new Set(["deploy", "deploys", "deployed", "deploying"].map(stem)).size).toBe(1);
    expect(new Set(["release", "releases", "released", "releasing"].map(stem)).size).toBe(1);
  });

  it("measures the longest shared word run", () => {
    expect(longestSharedRun("they sat for two days", ["Code reviews sat for two days before anyone"])).toBe(4);
    expect(longestSharedRun("nothing in common", ["Code reviews"])).toBe(0);
  });
});
