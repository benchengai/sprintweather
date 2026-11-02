import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import OpenAI from "openai";
import { describe, expect, it } from "vitest";

import { LLMError } from "@/lib/llm/client";
import { cached, pool, stopsBenchmark } from "../scripts/common";

describe("benchmark resume", () => {
  it("stops on quota, auth, server, network and budget errors, not on model failures", () => {
    const api = (status: number | undefined) => new OpenAI.APIError(status, undefined, "x", undefined);
    for (const s of [429, 401, 403, 500, 503, undefined]) expect(stopsBenchmark(api(s))).toBe(true);
    expect(stopsBenchmark(api(400))).toBe(false);
    expect(stopsBenchmark(new LLMError("budget reached: $1.90"))).toBe(true);
    expect(stopsBenchmark(new LLMError("response incomplete: max_output_tokens"))).toBe(false);
    expect(stopsBenchmark(new SyntaxError("Unexpected end of JSON input"))).toBe(false);
  });

  it("treats a cached transient failure as not run, and keeps real results and model failures", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "sw-cache-"));
    const file = (name: string, data: unknown) => {
      const f = path.join(dir, name);
      writeFileSync(f, JSON.stringify(data));
      return f;
    };
    expect(cached(file("a.json", { ok: false, error: "Error: 429 You have no credits remaining." }))).toBeNull();
    expect(cached(file("b.json", { ok: false, error: "Error: response incomplete: 512 tokens" }))).not.toBeNull();
    expect(cached(file("c.json", { ok: true }))).toEqual({ ok: true });
    expect(cached(path.join(dir, "missing.json"))).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts no new job after a failure, lets running ones finish, then rethrows", async () => {
    const started: number[] = [];
    const run = pool([1, 2, 3, 4, 5, 6], 2, async (i) => {
      started.push(i);
      await new Promise((r) => setTimeout(r, i === 1 ? 5 : 20));
      if (i === 1) throw new Error("quota");
      return i;
    });
    await expect(run).rejects.toThrow("quota");
    expect(started).toEqual([1, 2]);
  });
});
