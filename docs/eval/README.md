# SprintWeather evaluation report

What this measures:

- that no API or UI path reveals fewer than k responses, including through
  differencing across groups, dimensions and sprints;
- how well the theme step recovers planted themes without releasing a theme
  backed by fewer than k notes or leaking one person's wording;
- whether the retro prompts stay at team level;
- what the LLM steps cost.

Every number below comes from `npm test`, `npm run build:demo` or
`scripts/eval-themes.ts`. Theme runs are cached under [`runs/`](../../runs), and
the tables are generated from them.

## Status

| Part | State |
|---|---|
| Privacy property tests, API tests, export scan | Done; all pass |
| Theme step, 3 runs each of `gpt-6-luna` and `gpt-6.1-terra`, development set | Done (`runs/eval`); no scope failed |
| Held-out scoring | Done in the same benchmark. It was the first time any model saw the held-out set, and nothing was changed after |
| Retro prompts, 3 runs per model over the six demo sprints | Done; outputs read by hand and scored for sub-group mentions and leaked phrases |

### Reproducing the benchmark

The benchmark caches each finished scope under `runs/eval/` and resumes from that
cache. A model's own failure (invalid or truncated output, a refusal) is recorded
as a failed run. A quota, rate-limit, auth, server or network error, or the
budget cap, stops the benchmark without caching anything, so the same command
picks up where it stopped. With the cache in place it calls nothing and only
rescores. From the repository root, with `OPENAI_API_KEY` in the env file:

```bash
npx tsx scripts/eval-themes.ts --env-file .env --models gpt-6-luna,gpt-6.1-terra --runs 3
```

It writes `runs/eval/results.json` and [`results.md`](results.md). To start
from scratch, use another `--out` directory. The demo's themes and prompts are
copied from one finished run (no API call), then the demo is rebuilt:

```bash
npx tsx scripts/demo-pipeline.ts --from runs/eval/gpt-6-luna/run1
```

```bash
npm run build:demo
```

The runner keeps its own spending cap (`--budget`, default $1.90, counting
everything already in `runs/ledger.jsonl`).

## 1. Privacy properties

| Check | Cases | Result |
|---|---|---|
| Every released figure covers at least k responses | 400 random datasets | pass |
| Every atom of all released sets (groups, both dimensions, team totals, before/after windows) has at least k responses; no signed difference of up to three released sets isolates 1 to k − 1 responses | 300 | pass |
| No single response lies in the row space of the released sets (rank test per response) | 150 | pass |
| Hidden cells, open and below-k sprints carry no numbers | 200 | pass |
| Release independent of storage order | 150 | pass |
| Changing k or groups later leaves closed sprints unchanged | 100 | pass |
| Themes with fewer than k notes never released | 100 | pass |
| Same properties through the real route handlers, random check-in sequences | 40 | pass |
| Mutation: atom check replaced by "n ≥ k per group" | – | 5 tests fail with counterexamples (the tests have teeth) |
| Static demo build scanned for 173 note texts, 27 distinctive phrases, raw fields, key-like strings | 53 files | pass |

Random datasets: 1–4 sprints of 0–28 responses, k from 3 to 7, two dimensions
(three sub-teams, four roles) skewed so that small groups, missing answers and
near-subset groups are common. The observer in
[`tests/attacker.ts`](../../tests/attacker.ts) is written independently of the
release code and rebuilds every released set from the raw data.

## 2. Theme extraction

### Data

All synthetic and hand-written; no real person wrote or is described by any note.

| Set | Scopes | Notes | Planted themes ≥ k | Planted themes < k | Notes with a distinctive phrase |
|---|---|---|---|---|---|
| Development: six demo sprints ([notes.json](../../data/synthetic/notes.json)) | 6 | 89 | 12 (5–7 notes each) | 6 (2–3 notes) | 7 |
| Development: two teams ([dev-teams.json](../../data/eval/dev-teams.json)) | 2 | 42 | 6 | 2 | 3 |
| Held out: two teams ([heldout.json](../../data/eval/heldout.json)) | 2 | 42 | 6 (4 with 6–7 notes, 2 with exactly 5) | 2 | 5 |

Distinctive phrases are one person's turn of phrase or a name ("my rubber duck
has heard more about the ledger service", "flat-pack furniture with the
instructions in Klingon", "since Marta moved teams", "Calvinball"), each with
marker words that must never appear in output. k = 5 throughout.

### Scoring

A released theme is matched to the planted theme that most of its *confirmed*
notes carry. Its **true support** is the number of its confirmed notes that
carry that planted theme according to the labels; the model's own count is not
trusted.

- **Recall**: planted themes with at least k notes that some released theme
  matches with true support of at least k.
- **Below-k themes surfaced**: a released theme matched to a planted theme with
  fewer than k notes (should be 0).
- **Released themes with true support < k**: should be 0.
- **Support precision**: true support / claimed support, over released themes.
- **Markers leaked**: marker words found (stemmed, as a sequence) in a released
  statement. Also counted in the raw first drafts, before the guard.
- **Longest shared run**: longest sequence of consecutive words a released
  statement shares with any single note.

### Results: 3 runs per model, development and held-out sets

From [`results.md`](results.md), generated by the command above. Mean across
the three runs, range in brackets. One run is ten scopes (8 development, 2
held out) plus retro prompts for the six demo sprints.

| Model | Recall, dev (18 planted) | Recall, held out (6 planted) | Below-k themes surfaced | True support < k | Support precision | Markers leaked (raw drafts) | Longest shared run | Guard: flagged / rewritten / withheld | Cost per run | Sum of call times per run |
|---|---|---|---|---|---|---|---|---|---|---|
| `gpt-6-luna` | 0.85 (0.78–0.89): 16, 14, 16 | 0.89 (0.83–1.00): 5, 5, 6 | 0 | 0 | 1.00 | 0 (0) | 3 words | 4.3 / 4.3 / 0 | $0.0082 | 177 s |
| `gpt-6.1-terra` | 0.93 (0.89–0.94): 17, 16, 17 | 1.00: 6, 6, 6 | 0 | 0 | 1.00 | 0 (0) | 3 words | 5.3 / 5.3 / 0 | $0.0578 | 145 s |

Recall by planted theme, summed over the three runs (found / chances):

| Notes behind the planted theme | Planted (dev + held out) | `gpt-6-luna` dev | `gpt-6-luna` held out | `gpt-6.1-terra` dev | `gpt-6.1-terra` held out |
|---|---|---|---|---|---|
| 6–7 (above k) | 10 + 4 | 29 / 30 | 11 / 12 | 28 / 30 | 12 / 12 |
| 5 (exactly k) | 8 + 2 | 17 / 24 | 5 / 6 | 22 / 24 | 6 / 6 |

Retro prompts, six demo sprints per run:

| Model | Prompts per run | Naming a sub-group or role | Distinctive markers | Prompt cost per run |
|---|---|---|---|---|
| `gpt-6-luna` | 24, 24, 23 | 0 | 0 | $0.0024 |
| `gpt-6.1-terra` | 24, 24, 24 | 0 | 0 | $0.0143 |

### Findings

1. **No privacy failure in any of the six runs**, on the development or the
   held-out set. No theme planted below k surfaced, every released theme's
   confirmed notes truly carried it (support precision 1.00), and no distinctive
   marker appeared, in released statements or in the raw first drafts. No released
   statement shares more than 3 consecutive words with any single note. None of
   the 143 retro prompts names a sub-group or role or contains a marker.
2. **Verification at k is what limits recall.** All 14 misses (10 for
   `gpt-6-luna`, 4 for `gpt-6.1-terra`) were themes the extractor proposed and
   the second call confirmed for fewer than k notes. None was missed by the
   extractor, and the wording guard withheld none. Misses cluster at themes with
   exactly k = 5 notes: over both sets, `gpt-6-luna` recovered 22 of 30 such
   chances against 40 of 42 for themes with 6–7 notes. The one-run result that
   every theme with 6 or more notes was found does not hold over three runs: a
   theme with 6 notes was missed four times (twice per model, each time in one
   of the three runs). Releasing a point made by exactly k people only if a
   second call agrees that all k make it is the intended trade. A team of 15 with
   k = 5 should expect one or two themes per sprint.
3. **`gpt-6.1-terra` recovered more themes than `gpt-6-luna`**, which reverses
   the single development run. Over three runs `gpt-6.1-terra` found 16–17 of 18
   development themes and all 6 held-out themes in every run; `gpt-6-luna` found
   14–16 and 5–6. The earlier single run (17 against 14) was `gpt-6-luna`'s best
   case, and `gpt-6.1-terra`'s run that lost a theme to the "grew" false alarm on
   the older pipeline. `gpt-6.1-terra` costs about 7 times as much: $0.058 against
   $0.008 per run, or about $0.007 against $0.001 per sprint including the retro
   prompts. With three runs on synthetic notes the gap (50 against 46 of 54
   development chances, 18 against 16 of 18 held out) is a direction, not a
   settled ranking. The app's default model is still `gpt-6-luna`
   (`SW_MODEL` overrides it).
4. **The guard caught real echoes, and its false alarms now cost wording, not
   themes.** Across the six runs 29 statements were flagged (13 and 16) and all
   29 were rewritten; none was withheld. Seven drafts repeated 4–6 consecutive
   words from a single note; the longest was `gpt-6.1-terra`'s "Work was added
   after the sprint began", six words from one note. The other 22 flags were single
   words only one note used, mostly ordinary technical words ("automated",
   "unreliable", "monitoring", "automation", "approval"). Avoiding them sometimes
   makes the rewrite stilted ("Tests run by software produced inconsistent
   results" for unreliable automated tests). The "grew" false alarm did not recur:
   `gpt-6.1-terra` found the Sprint 22 scope-creep theme in all three runs.
5. **Distinctive phrases were never echoed, even before the guard.** Both models
   kept "Klingon", "rubber duck", "Marta", "Calvinball" and the rest out of every
   first draft. The guard is the deterministic backstop; in these runs it caught
   plain verbatim phrasing, not the planted phrases.
6. **Retro prompts stayed at team level and cited their evidence.** Each sprint got
   3 or 4 open questions, each tied to the figures, themes or action items it
   builds on. All 18 prompts that cite an action item describe a change after
   the action, never one caused by it; 7 say outright that the evidence does not
   establish cause, 7 quote the 95% interval, and the rest give only the
   direction or the estimate. Read by hand, not scored beyond the table above; some `gpt-6-luna` explanations repeat evidence ids in brackets
   ("[theme:1]"), which the demo shows as written.
7. **Cost is small either way.** A full run (ten scopes and six prompt sets) cost
   $0.008 with `gpt-6-luna` and $0.058 with `gpt-6.1-terra`. `gpt-6-luna` used
   more reasoning tokens (9,676 against 5,187 per run), at a tenth of the price
   per token.

### How the pipeline got here (development history)

Changes were made on development data only. The held-out teams were written
after the first smoke test and were first run in the benchmark above; nothing
was changed after seeing them.

| Run | Data | What it showed | Change made |
|---|---|---|---|
| `runs/smoke` (`gpt-6-luna`) | s1 and one team of the first "held-out" pair | The extractor wrote compound statements ("flaky tests… require repeated reruns…"); the judge rightly rejected them. A word rule at the full k threshold flagged "store" (used by 3 of 6 notes) | Extractor asks for one point per theme. Word and phrase rule set to "only one note uses it", names held to k. The two teams moved to the development set; two new held-out teams written |
| `runs/smoke2` (`gpt-6-luna`) | development (8 scopes) | Judge too literal about two-part statements; ordinary words ("action", "arrive") flagged | Verifier judges the statement's main point; everyday-word list grown to about 1,100 words |
| `runs/smoke3` (both models) | development | One run each ([dev-runs.md](dev-runs.md)): `gpt-6-luna` 17 of 18, `gpt-6.1-terra` 14 of 18; one theme withheld because "grew" was flagged | Irregular verb forms added; avoid-list kept across rewrite rounds |
| `runs/smoke4` (both models) | development | 4 of 18 calls succeeded before the account ran out of credits | – |
| `runs/eval` (both models, 3 runs) | development and held out | Results above | – |

## 3. Limits of this evaluation

- **Three runs per model** on 24 planted themes. The range across runs is shown;
  no significance test is run, and a different shuffle or set of notes could
  narrow or reverse the gap between the models.
- **The development set was used to tune the prompts and the guard.** The
  held-out set is small (two teams, six planted themes at or above k), so it
  checks that the results carry over, not how large the effect is.
- **Synthetic notes written by the same author as the labels and the prompts.**
  Real notes are messier, longer, and mix several points per note. Planted themes
  are cleanly separable by design.
- **Matching by confirmed notes, not by statement text.** A released theme counts
  as recovering a planted theme if its confirmed notes carry that label, whatever
  the statement says. Statement and prompt quality was read by hand (examples in
  the run files), not scored.
- **Markers test known phrases only.** A leak of wording that was not planted as a
  marker is measured only through the longest-shared-run figure (3 words at most
  in released statements).
- **Demo provenance.** The demo's themes and retro prompts are the outputs of
  `runs/eval/gpt-6-luna/run1`, unedited: the app's default model, and a run that
  recovered every planted theme of the six demo sprints.

## 4. API spend

From [`runs/ledger.jsonl`](../../runs/ledger.jsonl), which records every
successful call with its token counts and cost at published prices (as of
2026-11-01, [pricing.ts](../../lib/llm/pricing.ts)). Calls refused with a 429
were not billed.

| Model | Calls | Cost (USD) |
|---|---|---|
| `gpt-6-luna` | 144 | 0.0379 |
| `gpt-6.1-terra` | 120 | 0.2236 |
| **Total** | 264 | **0.2615** |

The 3-run benchmark accounts for 181 of these calls and $0.1981; development
smoke tests account for the rest ($0.0634). Budget cap set in the runner: $1.90.
