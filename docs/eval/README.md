# SprintWeather evaluation report

What this measures:

- that no API or UI path reveals fewer than k responses, including through
  differencing across groups, dimensions and sprints;
- how well the theme step recovers planted themes without releasing a theme
  backed by fewer than k notes or leaking one person's wording;
- what the LLM steps cost.

Every number below comes from `npm test`, `npm run build:demo` or
`scripts/eval-themes.ts`. Theme runs are cached under [`runs/`](../../runs), and
the tables are generated from them.

## Status

| Part | State |
|---|---|
| Privacy property tests, API tests, export scan | Done; all pass |
| Theme step on the development set, `gpt-6-luna` and `gpt-6.1-terra` | Done; one complete run per model (`runs/smoke3`) |
| Full benchmark: 3 runs each of `gpt-6-luna` and `gpt-6.1-terra` | **Not done: OpenAI credits ran out.** The account behind the key returned `429 You have no credits remaining` partway through the fourth development run. The key is shared with sibling projects; SprintWeather itself had spent $0.063 |
| Held-out scoring | **Not done: OpenAI credits ran out.** No model has seen the held-out set, so it is still blind |
| Retro prompts | Implemented and unit-tested through the API path; **not run against a model: OpenAI credits ran out.** The demo shows none |

No number in this report estimates or extrapolates the missing runs. Everything
below is from runs that finished.

### Completing the missing runs

The benchmark caches each finished scope under `runs/eval/` and resumes from that
cache. A model's own failure (invalid or truncated output, a refusal) is recorded
as a failed run. A quota, rate-limit, auth, server or network error, or the
budget cap, stops the benchmark without caching anything, so the same command
picks up where it stopped. This was checked against the credit-less account: the
command below exited with the 429, cached nothing, and billed nothing. Once the
account has credits, from the repository root:

```bash
npx tsx scripts/eval-themes.ts --env-file .env --models gpt-6-luna,gpt-6.1-terra --runs 3
```

It writes `runs/eval/results.json` and `docs/eval/results.md`, with the
development and held-out sets and retro prompts for all six runs. To show that
benchmark's outputs in the demo (no API call), then rebuild:

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
| Held out: two teams ([heldout.json](../../data/eval/heldout.json)) | 2 | 42 | 6 | 2 | 5 |

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

### Results: development set, one run per model

Generated with `--sets dev --runs 1 --out runs/smoke3 --score-only` from the
cached runs ([dev-runs.md](dev-runs.md)).

| Model | Recall (18 planted) | Below-k themes surfaced | True support < k | Support precision | Markers leaked (raw drafts) | Longest shared run | Guard: flagged / rewritten / withheld | Cost per run (8 scopes) | Sum of call times |
|---|---|---|---|---|---|---|---|---|---|
| `gpt-6-luna` | 0.94 (17) | 0 | 0 | 1.00 | 0 (0) | 3 words | 4 / 4 / 0 | $0.0041 | 87 s |
| `gpt-6.1-terra` | 0.78 (14) | 0 | 0 | 1.00 | 0 (0) | 3 words | 3 / 2 / 1 | $0.0331 | 86 s |

One run per model is a single sample. Section 3 explains what that does and does
not support.

Recall by planted theme:

| Notes behind the planted theme | Planted | `gpt-6-luna` found | `gpt-6.1-terra` found |
|---|---|---|---|
| 6–7 (above k) | 10 | 10 | 9 |
| 5 (exactly k) | 8 | 7 | 5 |

### Findings

1. **No privacy failure in any run.** No theme planted below k surfaced, every
   released theme's confirmed notes truly carried it (support precision 1.00), and
   no distinctive marker appeared, before or after the guard.
2. **Verification at k is what limits recall.** Every theme with 6 or more notes
   was found, apart from one withheld by the wording guard (finding 4). Every other
   miss is a theme with exactly k = 5 notes where the judge confirmed only 3 or 4
   (the knowledge-sharing theme of the data team was confirmed for 3 of its 5 notes
   by both models). This
   is the intended trade: a point made by exactly k people is released only if a
   second call agrees that all k make it. A team of 15 with k = 5 should expect
   one or two themes per sprint.
3. **The cheaper model did better here, at an eighth of the cost.** `gpt-6-luna`
   found 17 of 18 at $0.0041 per eight scopes; `gpt-6.1-terra` 14 of 18 at $0.0331.
   `gpt-6.1-terra` writes shorter, more generic statements ("App review caused
   delays.") and its judge confirmed fewer notes for themes at exactly k. With one
   run each this is a direction to test, not a result.
4. **The guard caught real echoes, plus false alarms.** In the two runs' first
   drafts, three statements repeated 4–5 consecutive words from a single note
   ("Work was added after the sprint began" from "…work was added after the sprint
   started"; "Dependencies on other teams…"; "Knowledge-sharing sessions help…").
   Two of them reached the guard and were caught; the third had already been
   withheld for support. The other five flags were ordinary words that one note
   happened to use ("automated", "interactive", "unreliable", "post-incident"). The flagged statements were
   rewritten, except one (`gpt-6.1-terra`, Sprint 22 scope creep) whose rewrite
   used "grew", which the stemmer did not map to the listed word "grow". Irregular
   verb forms were added to the everyday list afterwards; the run that would have
   tested that fix was cut off by the credit limit, so it is untested on that theme.
5. **Distinctive phrases were never echoed, even before the guard.** Both models
   kept "Klingon", "rubber duck", "Marta", "Calvinball" and the rest out of their
   first drafts. The guard is the deterministic backstop; in these runs it caught
   plain verbatim phrasing, not the planted phrases.
6. **Cost is small either way.** About $0.0005 per sprint with `gpt-6-luna` and
   $0.004 with `gpt-6.1-terra` (extract, verify, and a rewrite when needed).
   `gpt-6-luna` used more reasoning tokens (4,756 against 3,228 for the run), but
   at a tenth of the price per token.

### How the pipeline got here (development history)

Changes were made on development data only. The held-out teams were written
after the first smoke test and have not been run.

| Run | Data | What it showed | Change made |
|---|---|---|---|
| `runs/smoke` (`gpt-6-luna`) | s1 and one team of the first "held-out" pair | The extractor wrote compound statements ("flaky tests… require repeated reruns…"); the judge rightly rejected them. A word rule at the full k threshold flagged "store" (used by 3 of 6 notes) | Extractor asks for one point per theme. Word and phrase rule set to "only one note uses it", names held to k. The two teams moved to the development set; two new held-out teams written |
| `runs/smoke2` (`gpt-6-luna`) | development (8 scopes) | Judge too literal about two-part statements; ordinary words ("action", "arrive") flagged | Verifier judges the statement's main point; everyday-word list grown to about 1,100 words |
| `runs/smoke3` (both models) | development | Results above | Irregular verb forms added; avoid-list kept across rewrite rounds |
| `runs/smoke4` (both models) | development | 4 of 18 calls succeeded before the credits ran out | – |

## 3. Limits of this evaluation

- **Single run per model** on the development set, which the prompts were tuned on.
  The planned three runs and the blind held-out set are not done (see Status).
  Nothing here estimates run-to-run variance.
- **Synthetic notes written by the same author as the labels and the prompts.**
  Real notes are messier, longer, and mix several points per note. Planted themes
  are cleanly separable by design.
- **Matching by confirmed notes, not by statement text.** A released theme counts
  as recovering a planted theme if its confirmed notes carry that label, whatever
  the statement says. Statement quality was read by hand (examples in the run
  files), not scored.
- **Markers test known phrases only.** A leak of wording that was not planted as a
  marker is measured only through the longest-shared-run figure (3 words at most
  in released statements).
- **Demo provenance.** The demo's themes are the `gpt-6-luna` outputs of
  `runs/smoke3/gpt-6-luna/run1`, unedited. That run used the pipeline before the
  last two development changes (irregular verbs, cumulative avoid-list), which
  only affect rewrites.

## 4. API spend

From [`runs/ledger.jsonl`](../../runs/ledger.jsonl), which records every
successful call with its token counts and cost at published prices (as of
2026-11-01, [pricing.ts](../../lib/llm/pricing.ts)). Calls refused with a 429
were not billed.

| Model | Calls | Cost (USD) |
|---|---|---|
| `gpt-6-luna` | 55 | 0.0133 |
| `gpt-6.1-terra` | 28 | 0.0501 |
| **Total** | 83 | **0.0634** |

Budget cap set in the runner: $1.90 of the $2.00 allowed.
