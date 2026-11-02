# SprintWeather privacy model

SprintWeather is an opt-in, self-reported team pulse. This document says what it
stores, what it shows, the rules in between, how each rule is tested, and what
the design does not protect against. The code it describes is
[`lib/release.ts`](../lib/release.ts) (aggregates),
[`lib/themes/`](../lib/themes) (free text), [`lib/store.ts`](../lib/store.ts)
and [`lib/checkin.ts`](../lib/checkin.ts) (storage and check-in).

## 1. Self-report, not emotion inference

The EU AI Act ([Regulation (EU) 2024/1689](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)),
Article 5(1)(f), prohibits:

> the placing on the market, the putting into service for this specific purpose,
> or the use of AI systems to infer emotions of a natural person in the areas of
> workplace and education institutions, except where the use of the AI system is
> intended to be put in place or into the market for medical or safety reasons;

Article 3(39) defines a related term the Act uses elsewhere:

> ‘emotion recognition system’ means an AI system for the purpose of identifying
> or inferring emotions or intentions of natural persons on the basis of their
> biometric data;

What SprintWeather does, stated so it can be checked against that text:

- **No inference about a person.** Members report their own energy, workload and
  goal clarity on 1–5 scales and say whether they were blocked. The app counts
  and averages those answers. No model scores, classifies or predicts anyone's
  emotional state.
- **One model step, over text, at team level.** Optional notes are summarised into
  themes about the work. The model never sees who wrote a note, their role,
  sub-team or scores; its instructions forbid adding feelings the writers did not
  state and describing any one person; a theme must be shared by at least k notes.
- **No biometric data** of any kind.
- **Retro prompts** are generated from the release only (team-level figures and
  themes), never from responses or notes.

What this document does **not** claim: that a given deployment complies with the
AI Act or the GDPR. That depends on facts outside the code, such as whether
participation is really voluntary where it is used, who runs the server, and
how the results are used. This is a description of the design, not legal advice.

The research motivation is in the mapping study this app is grounded in: its
discussion of the Act names aggregate, anonymised team-level signals and strictly
opt-in tools as the design space that remains open, and SprintWeather is built
to stay inside it.

## 2. What is stored

| Stored | Not stored |
|---|---|
| Per response: sprint id, three 1–5 scores, blocked yes/no, optional self-reported role and sub-team, optional note | Name, member id, email, IP address, timestamp, the code used |
| Per sprint: hashes of the issued codes, hashes of the used codes (each list sorted) | Which code produced which response |
| Per closed sprint: the k and group lists frozen at close | |
| Themes (statement, topic, polarity, support count), retro prompts, action items | Notes, once themes have been made (or the facilitator discards them) |

Responses are inserted at a random position, so the order of the store does not
reveal who answered when. Because no response carries an identity, there is no
way, for anyone, to compute a per-person trend.

## 3. The release

Everything a page or an API response can show comes from one function,
`buildRelease(dataset)`. There is no endpoint for raw responses, and the pages
receive the release object and nothing else.

### Rules

1. **Nothing while check-in is open.** Otherwise a viewer could compare the figures
   before and after one more person answers. The facilitator sees only whether k
   has been reached (yes/no), never a running count, and cannot change k during a
   check-in (toggling k and watching "ready" would count responses).
2. **At least k responses** behind every figure. k defaults to 5. Values below 3, and
   non-integers, are refused with an error rather than rounded (`parseK`).
3. **No differencing (atom rule).** Showing a group next to the team total also
   reveals its complement by subtraction; showing two overlapping groups from
   different dimensions reveals their difference; and so on (the "tracker"
   attacks of Denning et al., 1979). So the release is built greedily (team total,
   then each dimension in its configured order, larger groups first) and a group
   is added only if every **atom** stays at 0 or at least k responses. An atom is
   the set of responses that belong to exactly the same released sets.

   *Why atoms are enough.* Every released figure (count, mean, number in a band,
   blocked count, and the variance behind an interval) is a sum over its set.
   Anything derivable by adding and subtracting released figures is a weighted sum
   of the released sets' indicator vectors, which is constant on each atom. Its
   support is therefore a union of atoms, each with at least k responses, so the
   finest thing an observer can compute is a total over k or more responses.
   People who chose "prefer not to say" end up in an atom of their own and are
   covered by the same rule.
4. **Multi-sprint figures pool whole released sprints only.** The before/after
   comparison for an action item uses up to two released sprints on each side.
   Every response in a released sprint is already inside that sprint's released
   total, so pooling whole sprints never splits an atom. Sprints below k are
   skipped.
5. **Settings are frozen per sprint at close.** A closed sprint's release is a pure
   function of its responses and its frozen k and group lists. Otherwise a later
   change of k could produce a second, differently suppressed version of the same
   sprint, and the two versions together could differ by a small group.
6. **Hidden means no numbers**, not even a count, and one label ("Not shown") for
   every reason, since "hidden for differencing" would itself say something about
   group sizes.
7. **Themes** are released only for a released sprint, each with at least k
   (frozen) supporting notes, and only for the whole team, never per group. The
   release re-checks the count, independently of the pipeline.

The rule is conservative: it sometimes hides a group that a cleverer audit could
show. In the synthetic demo team, releasing both sub-teams leaves no role group
safe to show in any sprint, and when anyone skips the sub-team question, only
one sub-team can be shown. The worked example on the app's privacy page (computed
by the same code) shows a case where a plain "at least k per group" rule would
have exposed one person.

### Single-use codes

Each sprint's check-in issues one code per member. A code can be used once;
unknown and used codes get the same error message, so the reply does not reveal
which. Codes stop the trivial version of a "sybil" attack: someone submitting
k − 1 fake answers to a small group to lift it over k and then subtracting their
own answers. They do not stop the person holding unused codes (see section 6).

## 4. Free text: themes without anyone's wording

Goal: notes are never shown, and a theme cannot be traced to one person's wording.

| Step | What happens | Why |
|---|---|---|
| Scrub | Links, emails, @handles, ticket ids (`ABC-123`) and numbers of 2+ digits become placeholders | Identifiers never reach the model |
| Shuffle and relabel | Notes are shuffled and get throwaway ids (`n01`…) for one run | Order and ids carry nothing |
| Extract | The model proposes up to 6 themes as one-point statements of at most 14 words, citing note ids. The JSON schema only accepts ids present in the prompt | Strict output, no invented ids |
| Claimed support | Themes citing fewer than k distinct notes are dropped | k rule, before any further call |
| Verify | A second call sees each statement with its cited notes and lists the ones that make that point. Support = cited ∩ confirmed | The extractor's own count is not trusted; the checker can remove citations, never add them |
| Verified support | Themes with fewer than k confirmed notes are withheld | k rule on checked support |
| Wording guard (deterministic) | A statement is refused if it reuses a word only one note uses (outside a hand-made list of about 1,100 everyday words), a four-word sequence only one note uses, a capitalised name fewer than k notes use, or a scrub placeholder | A single person's distinctive wording cannot pass |
| Rewrite | Refused statements get up to two rewrite calls, with a cumulative list of words and phrases to avoid, and are checked again; failures are withheld | Keep the theme if it can be said generically |
| Store | Statement, topic, polarity, support count. Notes are then deleted | Data minimisation |

Why this stops reconstruction: a released statement can only contain the
model's own words, everyday words, and wording at least two notes share; a name
must appear in at least k notes; and the whole point must be confirmed in at
least k notes by a separate check. A distinctive turn of phrase from one note
("herding caffeinated squirrels"), a colleague's name mentioned once, or a
verbatim sentence fails at least one of these deterministically, whatever the
model does.

What it does not stop: a theme can still be *about* something only k people
experienced, which is the point of a theme. Wording shared by exactly two notes
can appear; the threshold of two matches the goal (no single person's wording)
and is a deliberate trade against losing themes to false alarms. The everyday-word
list is hand-made: a missing ordinary word causes a false alarm (a rewrite or a
withheld theme), never a leak.

## 5. How the rules are tested

All in `npm test` ([`tests/`](../tests)); no test reaches the network.

- **Property tests on the release** (fast-check, `tests/release.test.ts`): random
  teams of 0–28 responses per sprint over 1–4 sprints, k from 3 to 7, two
  dimensions with skewed group sizes and missing answers, and random action items.
  An observer written independently of the release code (`tests/attacker.ts`)
  rebuilds every released set from the raw data, including before/after windows,
  and checks that:
  - every released figure covers at least k responses (400 random cases);
  - every atom across all released sets has at least k responses and lies in one
    sprint, and no signed difference of up to three released sets yields a set of
    1 to k − 1 responses (300 cases);
  - no single response is in the row space of the released sets, that is, no
    linear combination of released totals isolates one person's answer (150
    cases);
  - hidden cells, open sprints and below-k sprints carry no numbers;
  - the release does not depend on storage order, and later changes to k or the
    groups do not change a closed sprint;
  - themes backed by fewer than k notes are never released.
- **Mutation check**: with the atom check disabled (only "n ≥ k per group"), five
  of these tests fail with concrete counterexamples, so they test the rule rather
  than pass vacuously.
- **API tests** (`tests/api.test.ts`) drive the real route handlers against a
  temporary store: nothing released while open; no counts for the facilitator; k
  locked during check-in and refused below 3; used and unknown codes get the same
  answer; no code, time or name stored; the API returns exactly the audited
  release and no raw field; plus a property test over random sequences of
  check-ins and closes through the API.
- **Theme step** (`tests/themes.test.ts`) with a stub model: no call below k notes;
  claimed and verified support; the judge cannot add notes; the guard flags rare
  words, names and one-note phrases; rewrite and withhold; identifiers never sent.
- **Static demo** (`scripts/check-export.ts`, run by `npm run build:demo`): scans
  every built file for the text of all 173 synthetic notes, every planted
  distinctive phrase, raw-response fields (`"attrs"`, `"note"`, `"responses"`,
  `"codes"`) and key-like strings.

## 6. Threats this does not address

- **Homogeneity.** If everyone in a shown group gives the same answer, the
  aggregate reveals what each of them said (Machanavajjhala et al., 2007). k-anonymity
  hides who, not what a whole group said. Answer bands are shown for the team
  only, and groups show means only, which narrows but does not remove this.
- **Outside knowledge.** Knowing who was on holiday, who joined, or who usually
  writes about what can narrow things down. If exactly one person joined between
  two sprints, the change in the average hints at their answer, though it never
  equals it.
- **The operator.** Whoever runs the server can read the store (including notes
  until themes are made) and can submit fake responses with unused codes until a
  small group reaches k. The guarantees are about what the app shows, not about a
  dishonest operator. A team that does not trust its facilitator should have
  someone neutral run it.
- **No authentication in local mode.** It is meant for one trusted machine.
- **Free-text content.** A note may describe something only one person could know.
  The k-support and verification steps keep such a point out of the themes, but
  the note itself sits in the store until themes are made.

## References

- Denning, D. E., Denning, P. J., Schwartz, M. D. The Tracker: A Threat to Statistical Database Security. *ACM TODS* 4(1), 1979, pp. 76–96.
- Machanavajjhala, A., Kifer, D., Gehrke, J., Venkitasubramaniam, M. ℓ-Diversity: Privacy Beyond k-Anonymity. *ACM TKDD* 1(1), 2007. doi:10.1145/1217299.1217302
- Sweeney, L. k-Anonymity: A Model for Protecting Privacy. *International Journal of Uncertainty, Fuzziness and Knowledge-Based Systems* 10(5), 2002, pp. 557–570.
- Regulation (EU) 2024/1689 (Artificial Intelligence Act), Articles 3(39) and 5(1)(f). https://eur-lex.europa.eu/eli/reg/2024/1689/oj
