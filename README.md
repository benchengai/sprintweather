# SprintWeather

**Live demo:** [benchengai.github.io/demos/sprintweather](https://benchengai.github.io/demos/sprintweather/) (static, synthetic team; themes are saved outputs of a real pipeline run)

An opt-in, self-reported, k-anonymous team pulse that feeds sprint
retrospectives. Members answer three 1–5 questions and one yes/no question each
sprint, with an optional note. The team sees aggregates, trends, paraphrased
themes and suggested retro questions. It never sees an individual's answers.

Portfolio app 5 of 5 built from the systematic mapping study *Emotions in
Software Engineering* (57 studies). Next.js, TypeScript, OpenAI structured
outputs. All data in this repository is synthetic.

## Problem

Retrospectives depend on people saying how the sprint really went, and the
people who are struggling are often the least likely to say it out loud.
Anonymous surveys help, but in a small team a naive survey tool leaks: a
"QA: 2.1" row is one or two people, a sub-team next to the team total reveals
the rest by subtraction, and a quoted comment is recognisable by its wording.
Meanwhile, AI that *infers* how workers feel is prohibited in the EU workplace.

## Research basis

- **An empty cell.** In the study's map, Team Health & Well-being has 16
  studies: 4 in requirements, 7 in design/implementation, 5 cross-phase, and
  **0 in maintenance** (and 0 in testing).
- **An intervention gap.** The study finds the field has become good at
  *detecting* emotional strain but has made little progress in designing and
  evaluating interventions: only two team-health studies evaluate a concrete
  tool aimed at improving well-being, and few propose practical interventions.
  SprintWeather is a small, recurring intervention for the maintenance phase:
  the team's own check-in, feeding the team's own retro.
- **A regulatory constraint.** The study's discussion of the EU AI Act notes that
  Article 5(1)(f) prohibits AI systems that infer the emotions of people at work,
  and names aggregate, anonymised team-level signals and strictly opt-in tools as
  the space that remains open. SprintWeather is self-report only.
- **Related work.** Grassi et al. (ICSE-NIER 2023) support emotion awareness in
  retrospectives with biometric wristbands; SprintWeather asks instead. Kuutila
  et al. (ESEM 2018) used repeated self-report (experience sampling) to track
  well-being. The privacy design builds on k-anonymity (Sweeney, 2002), the
  differencing "tracker" attacks on query-size limits (Denning et al., 1979) and
  the homogeneity limit of k-anonymity (Machanavajjhala et al., 2007).

SprintWeather is *grounded in* this research; it has not been validated with a
real team.

## What it does

- **Check-in**: energy, workload manageability and goal clarity (1–5), blocked a day
  or more (yes/no), optional role and sub-team, optional note. Single-use codes
  per sprint; the answer is stored without the code, a name or a time.
- **Retro view**: per-sprint team means with 95% intervals, the spread of answers,
  a by-group table where only safe groups are shown, small-multiple trends across
  sprints, themes from the notes, suggested retro questions, and for each action
  item the team agreed on, whether the target metric moved (before/after
  difference with a Welch 95% interval).
- **Facilitator page** (local mode): open and close check-ins, issue codes, run the
  theme and prompt steps, record action items, set k and the groups.
- **Two builds**: local mode with route handlers and a JSON store; a static demo
  (`output: 'export'`) over a synthetic 20-person team and six sprints, with no
  server and no API key.

## Privacy model

Full write-up: [docs/privacy-model.md](docs/privacy-model.md). In short:

- **k** defaults to 5, can be raised, and values below 3 are refused.
- **Nothing is shown while check-in is open**, so figures cannot be compared before
  and after one more answer.
- **Differencing is blocked by an atom rule.** A group is shown only if every
  *atom*, meaning the responses that fall in exactly the same shown groups, keeps
  0 or at least k responses. Every figure anyone can derive by adding and
  subtracting shown figures is a combination of atoms. That covers groups,
  role × sub-team overlaps, the team total, "prefer not to say", and the
  multi-sprint before/after windows.
- **Settings are frozen per sprint when it closes**, so no second, differently
  suppressed version of a published sprint can exist. Hidden groups show no
  numbers, not even a count.
- **No identities are stored**, so per-person trends are impossible by construction.
- **Free text is never shown.** An LLM proposes themes citing note ids, a second
  call confirms which notes really make each point (at least k needed), and a
  deterministic guard refuses any statement that reuses a word or four-word
  phrase only one note used, or a name fewer than k notes used. Then the notes
  are deleted.
- **Self-report, not inference.** No model scores anyone's emotional state. The
  privacy doc quotes what Article 5(1)(f) covers and makes no legal claim beyond it.

## Quick start

Requires Node 24 and npm 11.

```bash
npm install
```

**Static demo** (synthetic data, no API key, builds in about 10 seconds):

```bash
npm run build:demo
```

```bash
npm run serve:demo
```

Then open http://localhost:4173. `build:demo` also scans the built site for any
note text, distinctive phrase, raw-response field or key-like string, and fails
if it finds one. To serve the demo from a sub-path, set the same base path for
both steps, e.g. `DEMO_BASE_PATH=/demos/sprintweather npm run build:demo`, then
`DEMO_BASE_PATH=/demos/sprintweather npm run serve:demo`. To deploy on Vercel, set the environment variable
`SW_MODE=demo` (or use `npm run build:demo` as the build command and `out` as the
output directory). The public demo at https://benchengai.github.io/demos/sprintweather/ is built with the
sub-path command above.

**Local mode** (real check-ins, stored in `.data/store.json`):

```bash
npm run dev
```

Open http://localhost:3000/facilitator/, set the sub-team options, open a
check-in and hand out the codes. To generate themes and retro questions, put
`OPENAI_API_KEY=...` in `.env.local` (git-ignored); the default model is
`gpt-6-luna`, override with `SW_MODEL`. Local mode has no login: run it on a
machine you trust.

**Tests** (no network):

```bash
npm test
```

**Theme evaluation** (calls the API; caches each finished scope under `runs/eval/`
and resumes from it; writes `docs/eval/results.md`). `--env-file` points at a file
with `OPENAI_API_KEY`; it is only read, and existing variables win:

```bash
npx tsx scripts/eval-themes.ts --env-file .env --models gpt-6-luna,gpt-6.1-terra --runs 3
```

## Results

Details and method: [docs/eval/README.md](docs/eval/README.md).

- **Privacy tests: all pass** (about 1,400 random cases). In 490 of them an
  independent attacker rebuilds every released set and finds no atom below k, no
  difference of up to three released sets that isolates 1 to k − 1 responses, and
  no single response in the row space of the released aggregates. With the differencing check disabled,
  five tests fail with concrete counterexamples. The same holds through the real
  API route handlers.
- **Theme step, 3 runs per model** over a development set (8 scopes, 131 notes,
  18 planted themes at or above k) and a held-out set first run in this
  benchmark (2 teams, 42 notes, 6 planted themes):

  | | `gpt-6-luna` | `gpt-6.1-terra` |
  |---|---|---|
  | Planted themes recovered, dev (per run) | 16, 14, 16 of 18 | 17, 16, 17 of 18 |
  | Planted themes recovered, held out (per run) | 5, 5, 6 of 6 | 6, 6, 6 of 6 |
  | Themes below k released | 0 | 0 |
  | Released themes truly backed by fewer than k notes | 0 | 0 |
  | Distinctive phrases leaked (also in raw drafts) | 0 | 0 |
  | Cost per run (10 scopes + retro prompts for 6 sprints) | $0.008 | $0.058 |

  Every miss was a theme the extractor proposed but the second call confirmed for
  fewer than k notes; most were themes with exactly k = 5 notes. `gpt-6.1-terra`
  recovered more themes than `gpt-6-luna` at about 7 times the cost, which
  reverses a single earlier development run (17 against 14). The wording guard
  flagged 29 drafts in the six runs, 7 of them repeating 4–6 words from a single
  note; all 29 were rewritten and none withheld.
- **Retro prompts**: 143 questions over 3 runs per model, none naming a sub-group
  or role, none echoing a distinctive phrase. Every question that cites an action
  item describes a change after it, not one caused by it.
- **API spend: $0.26** in total ($0.20 for the 3-run benchmark, $0.06 for
  development smoke tests).

The demo shows the themes and retro prompts of one benchmark run
(`runs/eval/gpt-6-luna/run1`), unedited.

## Limitations

- Synthetic data only, written by the same author as the labels and the prompts;
  no real team has used it, so nothing here measures usefulness.
- Self-report biases: non-response from the people who are struggling, and answers
  shaded towards what feels safe.
- k-anonymity hides who, not what a whole group said (homogeneity), and does not
  stop inference from outside knowledge.
- Before/after effects are observational; unlinkable responses mean the interval
  assumes independence.
- Whoever runs the server can read the store and could forge responses with unused
  codes. Local mode has no authentication.
- Three runs per model on 24 synthetic planted themes is a small sample; the gap
  between the two models is a direction, not a settled ranking.
- Not legal advice.

## Layout

```
app/                 pages, and route handlers (route.api.ts, local mode only)
components/          retro view, trend chart, check-in form, facilitator panel
lib/release.ts       the release: k, atom rule, freezing, effects
lib/themes/          theme pipeline and wording guard
lib/retro.ts         retro prompts from the release only
lib/llm/             OpenAI strict JSON calls, published prices
lib/store.ts         local JSON store, single-use codes
data/                synthetic notes, eval sets, demo dataset and saved outputs
scripts/             synthetic data, evaluation, demo export, export scan
tests/               property, API, theme and statistics tests
docs/                privacy model and evaluation report
runs/                cached model runs and the spend ledger
```
