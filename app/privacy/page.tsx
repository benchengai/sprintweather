import { DEFAULT_K, MIN_K } from "@/lib/config";
import { planSprint } from "@/lib/release";
import { AI_ACT } from "@/lib/research";
import type { CheckinResponse, Dimension } from "@/lib/types";

const DIMS: Dimension[] = [
  { id: "subteam", label: "Sub-team", values: ["Payments", "Platform"] },
  { id: "role", label: "Role", values: ["Developer", "QA"] },
];

/** A worked example, computed by the same function the app uses. */
function example() {
  const r = (subteam: string, role: string): CheckinResponse => ({ sprint: "x", energy: 3, workload: 3, clarity: 3, blocked: false, attrs: { subteam, role } });
  const rows = [
    ...Array.from({ length: 5 }, () => r("Payments", "QA")),
    r("Payments", "Developer"),
    ...Array.from({ length: 6 }, () => r("Platform", "Developer")),
  ];
  const both = planSprint(rows, DIMS, 5);
  const roleOnly = planSprint(rows, [DIMS[1]], 5);
  return { both, roleOnly, n: rows.length };
}

export default function PrivacyPage() {
  const ex = example();
  const shown = (plan: ReturnType<typeof planSprint>, dim: string, value: string) => (plan.shown.get(dim)?.has(value) ? "shown" : "hidden");
  return (
    <>
      <h1>Privacy model</h1>
      <p className="lede">
        What SprintWeather stores, what it shows, and the rules in between. The full write-up, with the evaluation, is in{" "}
        <code>docs/privacy-model.md</code>.
      </p>

      <section className="card">
        <h2>Self-report, not emotion inference</h2>
        <p>The EU AI Act, Article 5(1)(f), prohibits:</p>
        <blockquote>{AI_ACT.art5_1_f}</blockquote>
        <p>Article 3(39) defines the related term used elsewhere in the Act:</p>
        <blockquote>{AI_ACT.art3_39}</blockquote>
        <p>
          SprintWeather is built so that no AI system infers anyone&apos;s emotions. People report their own energy, workload
          and goal clarity on a scale they choose; the app adds them up. The one model step summarises what the notes say about
          the work into team-level themes; its instructions forbid adding feelings the writers did not state or describing any
          one person, and it never sees who wrote what. No biometric data is collected.
        </p>
        <p className="small muted">
          This describes the design. It is not legal advice and makes no claim about whether a particular deployment complies
          with the AI Act or the GDPR; a team using it at work still has to assess that, for example whether participation is
          really voluntary.
        </p>
      </section>

      <section className="card">
        <h2>What is stored</h2>
        <ul>
          <li>Per response: sprint, three 1–5 scores, blocked yes/no, optional role and sub-team, optional note.</li>
          <li>No name, member id, code or timestamp on a response, and responses are kept in random order.</li>
          <li>Check-in codes only as hashes, in a separate list, so a stored response cannot be matched to its code.</li>
          <li>Notes only until themes are made for their sprint (or the facilitator discards them).</li>
        </ul>
        <p className="small muted">Because no response carries an identity, per-person trends cannot be computed, by anyone.</p>
      </section>

      <section className="card">
        <h2>The release rules</h2>
        <ol>
          <li>
            <strong>Nothing while check-in is open.</strong> Otherwise you could compare the figures before and after one more
            person answers.
          </li>
          <li>
            <strong>At least k responses</strong> behind every figure. k defaults to {DEFAULT_K}; it can be raised, but values
            below {MIN_K} are refused, not rounded up.
          </li>
          <li>
            <strong>No differencing.</strong> Showing &ldquo;Payments&rdquo; next to the team total also reveals
            &ldquo;everyone not in Payments&rdquo; by subtraction. So a group is shown only if every <em>atom</em> stays at 0 or at
            least k responses. An atom is a set of responses that are in exactly the same shown groups. Any figure that can be
            worked out by adding and subtracting shown figures, across groups, across role and sub-team, with the team total,
            or across sprints, is a combination of atoms, so none covers fewer than k responses. People who chose &ldquo;prefer
            not to say&rdquo; form an atom too.
          </li>
          <li>
            <strong>Multi-sprint figures pool whole released sprints only</strong> (the before/after comparison for action
            items), so they never split an atom.
          </li>
          <li>
            <strong>k and the groups are frozen when a sprint closes.</strong> Re-computing a published sprint with a different k
            could produce a second version that differs from the first by a small group.
          </li>
          <li>
            <strong>Hidden means no numbers</strong>, not even a response count, and the label is the same whatever the reason.
          </li>
        </ol>
      </section>

      <section className="card">
        <h2>Worked example (computed by the app&apos;s own code)</h2>
        <p className="small">
          {ex.n} responses at k = 5: five QA people and one developer in Payments, six developers in Platform.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Group</th>
                <th>Size</th>
                <th>Role breakdown alone</th>
                <th>Sub-team, then role</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Payments</td>
                <td className="num">6</td>
                <td>–</td>
                <td>{shown(ex.both, "subteam", "Payments")}</td>
              </tr>
              <tr>
                <td>Platform</td>
                <td className="num">6</td>
                <td>–</td>
                <td>{shown(ex.both, "subteam", "Platform")}</td>
              </tr>
              <tr>
                <td>Developer</td>
                <td className="num">7</td>
                <td>{shown(ex.roleOnly, "role", "Developer")}</td>
                <td>{shown(ex.both, "role", "Developer")}</td>
              </tr>
              <tr>
                <td>QA</td>
                <td className="num">5</td>
                <td>{shown(ex.roleOnly, "role", "QA")}</td>
                <td>{shown(ex.both, "role", "QA")}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="small" style={{ marginTop: 8 }}>
          Every group has at least 5 responses. With roles alone, both can be shown. But once both sub-teams are shown,
          Payments minus QA is one person, and Developer splits into one Payments developer and six Platform developers. So no
          role is shown. A simple &ldquo;at least k per group&rdquo; rule would have exposed that one developer.
        </p>
      </section>

      <section className="card">
        <h2>Themes without anyone&apos;s wording</h2>
        <ol>
          <li>Links, emails, @handles, ticket ids and numbers are removed; notes are shuffled and given throwaway ids. The model never sees roles, sub-teams or scores.</li>
          <li>The model proposes themes and must cite the notes behind each one. The output schema only accepts ids that were in the prompt.</li>
          <li>A second call checks, theme by theme, which cited notes really make that point. Only confirmed notes count, and a theme needs at least k of them. The checker can remove citations, never add them.</li>
          <li>
            A deterministic check rejects any statement that reuses a word or a four-word phrase that only one note used (beyond
            everyday words), or a name fewer than k notes used. Rejected statements get up to two rewrites; if they still fail,
            the theme is withheld.
          </li>
          <li>Only the statement, its topic, its polarity and its count are kept. Then the notes are deleted.</li>
        </ol>
        <p className="small muted">
          So a theme can only say what at least k people said, in words that are not traceable to one of them. Themes are made
          for the whole team only, never per group, and the retro-question step sees only what this page would show.
        </p>
      </section>

      <section className="card">
        <h2>What this does not protect against</h2>
        <ul>
          <li>Homogeneity: if everyone in a shown group gives the same answer, the aggregate reveals what each of them said.</li>
          <li>Outside knowledge: who was away, who joined, who usually writes about what.</li>
          <li>A dishonest operator: whoever runs the server can read the store, or use unused codes to add fake responses until a small group reaches k.</li>
          <li>Inference from trends: if only one person joined between two sprints, a change in the average hints at their answer, though it never equals it.</li>
        </ul>
      </section>
    </>
  );
}
