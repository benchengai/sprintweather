import { AI_ACT, PAPER, REFERENCES, TEAM_HEALTH_ROW } from "@/lib/research";

export function ResearchBasis() {
  return (
    <details className="panel">
      <summary>Research basis</summary>
      <p>
        SprintWeather is grounded in the systematic mapping study <em>{PAPER}</em> (57 studies, classified by five emotion
        categories and five SDLC phases). Its Team Health &amp; Well-being category has 16 studies, and none of them is about
        maintenance:
      </p>
      <div className="table-scroll">
        <table aria-label="Team Health and Well-being studies by SDLC phase">
          <thead>
            <tr>
              {TEAM_HEALTH_ROW.map((c) => (
                <th key={c.phase} className="num">
                  {c.phase}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              {TEAM_HEALTH_ROW.map((c) => (
                <td key={c.phase} className="num">
                  {c.studies}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <ul className="small">
        <li>
          The study finds the field has become good at <em>detecting</em> emotional strain but has made little progress in
          designing and evaluating interventions: only two team-health studies evaluate a concrete tool aimed at improving
          well-being. SprintWeather is a small intervention for the maintenance phase: a recurring check-in that feeds
          the team&apos;s own retrospective.
        </li>
        <li>
          The study&apos;s discussion of the EU AI Act names what remains open: aggregate and anonymised team-level signals,
          and strictly opt-in tools. SprintWeather stays inside that space by using voluntary self-report only.
        </li>
        <li>
          Closest prior work: Grassi et al. (2023) support emotion awareness in retrospectives with biometric wristbands;
          SprintWeather asks instead. Kuutila et al. (2018) show that repeated self-report (experience sampling) can track
          well-being over months.
        </li>
        <li>
          The privacy rules build on k-anonymity (Sweeney, 2002), on the classic differencing (&ldquo;tracker&rdquo;)
          attacks on query-size restrictions (Denning et al., 1979), and on the known homogeneity limit of k-anonymity
          (Machanavajjhala et al., 2007).
        </li>
      </ul>
      <p className="small">
        <a href="https://eur-lex.europa.eu/eli/reg/2024/1689/oj">{AI_ACT.citation}</a>.
      </p>
      <ol className="small muted">
        {REFERENCES.map((r) => (
          <li key={r.key}>{r.text}</li>
        ))}
      </ol>
    </details>
  );
}

export function Limitations() {
  return (
    <details className="panel">
      <summary>Limitations</summary>
      <ul className="small">
        <li>
          Tested on synthetic data only: no real team has used SprintWeather, and the theme evaluation uses hand-written
          notes with planted themes. The numbers say how the pipeline behaves on that data, not how useful it is to a team.
        </li>
        <li>
          Self-report has known biases: people who are struggling may not check in, and answers can be shaded towards what
          feels safe to say.
        </li>
        <li>
          k-anonymity hides who said what, not what a whole group said: if every member of a shown group gives the same
          answer, the aggregate reveals it. Someone with outside knowledge (who was on holiday, who joined) can still narrow
          things down.
        </li>
        <li>
          Before/after comparisons for action items are observational. Responses cannot be linked across sprints (by
          design), so the interval treats them as independent, and other changes in the same sprints are not controlled for.
        </li>
        <li>
          LLM themes can miss points, merge them, or be withheld by the support and wording checks; a withheld theme is lost
          signal. The wording check relies on a hand-made list of everyday words.
        </li>
        <li>
          Whoever runs the server can read the raw store and could submit fake responses with unused codes to lift a small
          group over k. The guarantees are about what the app shows, not about a dishonest operator. Local mode has no login.
        </li>
        <li>This is not legal advice; whether a deployment complies with the AI Act or the GDPR is for its operator to assess.</li>
      </ul>
    </details>
  );
}
