import Link from "next/link";

export default function Home() {
  return (
    <>
      <h1>A team pulse that cannot point at anyone</h1>
      <p className="lede">
        SprintWeather is a short, opt-in check-in that feeds the team&apos;s retrospective. Each sprint, members who want to
        answer three 1–5 questions and one yes/no question, with an optional note. The team sees aggregates, trends and
        themes, never an individual&apos;s answers.
      </p>
      <p>
        <Link href="/retro/" className="btn btn-primary" style={{ display: "inline-block", textDecoration: "none" }}>
          Open the retro view
        </Link>
      </p>

      <div className="grid-2 section">
        <div className="card">
          <h3>1. Check in</h3>
          <p className="small">
            Energy, workload and goal clarity on a 1–5 scale, whether you were blocked, and an optional note. Role and sub-team
            are optional too. Each sprint has single-use codes, and an answer is stored without the code, a name or a time.
          </p>
        </div>
        <div className="card">
          <h3>2. Close and release</h3>
          <p className="small">
            Nothing is shown while check-in is open. After it closes, a figure appears only if it covers at least k responses
            (default 5, never below 3), including anything that could be worked out by subtracting one figure from another.
          </p>
        </div>
        <div className="card">
          <h3>3. Themes, never quotes</h3>
          <p className="small">
            An LLM turns the notes into short paraphrased themes. Each theme must be backed by at least k notes, confirmed by
            a second call, and may not reuse wording only one note used. Then the notes are deleted.
          </p>
        </div>
        <div className="card">
          <h3>4. Retro</h3>
          <p className="small">
            Trends by sprint with 95% intervals, the themes, suggested questions for the retro, and whether a metric moved
            after an action item the team agreed on.
          </p>
        </div>
      </div>

      <section className="section card">
        <h2>Why self-report, and why so strict</h2>
        <p>
          The EU AI Act prohibits AI systems that infer the emotions of people at work (Article 5(1)(f)). SprintWeather
          infers nothing about anyone: people say how their sprint went, in numbers they choose, and only aggregates are
          shown. The theme step summarises what the notes say about the work, at team level. See the{" "}
          <Link href="/privacy/">privacy model</Link> for the exact rules, what the Act says, and what this does not claim.
        </p>
        <p className="small muted">
          No per-person scores, no per-person trends, no manager view of individuals. If a tool like this ever starts to
          feel like monitoring, it has failed.
        </p>
      </section>
    </>
  );
}
