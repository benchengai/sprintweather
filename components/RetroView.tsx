"use client";

import { useState } from "react";

import type { ActionEffect, Release, SprintRelease } from "@/lib/release";
import { wilsonInterval } from "@/lib/stats";
import { QUESTIONS, type QuestionId } from "@/lib/types";
import { TrendChart, type Marker, type TrendPoint } from "./TrendChart";

const one = (x: number) => x.toFixed(1);
const signed = (x: number) => (x > 0 ? `+${x.toFixed(2)}` : x.toFixed(2));
const pct = (x: number) => `${Math.round(x * 100)}%`;

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="card">
      <div className="tile-label">{label}</div>
      <div className="tile-value">{value}</div>
      <div className="tile-sub">{sub}</div>
    </div>
  );
}

function delta(now: number, before: number | undefined, prevLabel: string | undefined) {
  if (before === undefined) return "first released sprint";
  const d = now - before;
  if (Math.abs(d) < 0.05) return `same as ${prevLabel}`;
  return `${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} vs ${prevLabel}`;
}

function Bands({ sprint }: { sprint: SprintRelease }) {
  const team = sprint.team!;
  return (
    <div className="card">
      <h3>How answers spread this sprint</h3>
      <div className="legend" aria-hidden="true">
        <span>
          <span className="swatch" style={{ background: "var(--low)" }} />
          1–2
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--mid)" }} />3
        </span>
        <span>
          <span className="swatch" style={{ background: "var(--high)" }} />
          4–5
        </span>
      </div>
      {QUESTIONS.map((q) => {
        const b = team.bands[q.id];
        return (
          <div key={q.id} style={{ marginTop: 10 }}>
            <div className="small">
              {q.label}{" "}
              <span className="muted">
                ({b.low} answered 1–2, {b.mid} answered 3, {b.high} answered 4–5)
              </span>
            </div>
            <div className="bands" role="img" aria-label={`${q.label}: ${b.low} low, ${b.mid} middle, ${b.high} high`}>
              {b.low > 0 && <div style={{ flex: b.low, background: "var(--low)" }} />}
              {b.mid > 0 && <div style={{ flex: b.mid, background: "var(--mid)" }} />}
              {b.high > 0 && <div style={{ flex: b.high, background: "var(--high)" }} />}
            </div>
            <div className="small muted">
              1 = {q.low}, 5 = {q.high}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Breakdown({ sprint }: { sprint: SprintRelease }) {
  const [dim, setDim] = useState(0);
  if (sprint.breakdowns.length === 0) return null;
  const b = sprint.breakdowns[Math.min(dim, sprint.breakdowns.length - 1)];
  return (
    <div className="card">
      <h3>By group</h3>
      <p className="small muted">
        Groups are self-reported and optional. A group is shown only if it has at least k = {sprint.k} responses <em>and</em>{" "}
        showing it would not let anyone work out a smaller set by subtraction, from the team total or from another group
        (including another dimension). Hidden groups show no numbers at all, not even a count.
      </p>
      <div className="segmented" role="group" aria-label="Group by">
        {sprint.breakdowns.map((d, i) => (
          <button key={d.dimension} type="button" aria-pressed={i === dim} onClick={() => setDim(i)}>
            {d.label}
          </button>
        ))}
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{b.label}</th>
              <th className="num">Responses</th>
              {QUESTIONS.map((q) => (
                <th key={q.id} className="num">
                  {q.label}
                </th>
              ))}
              <th className="num">Blocked</th>
            </tr>
          </thead>
          <tbody>
            {b.cells.map((c) =>
              c.shown ? (
                <tr key={c.value}>
                  <td>{c.value}</td>
                  <td className="num">{c.stats.n}</td>
                  {QUESTIONS.map((q) => (
                    <td key={q.id} className="num">
                      {one(c.stats.means[q.id])}
                    </td>
                  ))}
                  <td className="num">{pct(c.stats.blocked / c.stats.n)}</td>
                </tr>
              ) : (
                <tr key={c.value}>
                  <td>{c.value}</td>
                  <td colSpan={QUESTIONS.length + 2} className="hidden-cell">
                    Not shown
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Themes({ sprint }: { sprint: SprintRelease }) {
  const t = sprint.themes;
  return (
    <div className="card">
      <h3>Themes from the notes</h3>
      {!t ? (
        <p className="muted small">No themes were generated for this sprint.</p>
      ) : (
        <>
          {t.themes.length === 0 ? (
            <p className="muted small">No point was shared by at least k notes, so no theme is shown.</p>
          ) : (
            <ul className="theme-list">
              {t.themes.map((th) => (
                <li key={th.statement}>
                  <div className="theme-statement">{th.statement}</div>
                  <div className="small muted">
                    {th.support} notes · <span className="tag">{th.polarity}</span> <span className="tag">{th.topic}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted" style={{ marginTop: 8 }}>
            Paraphrased by <code>{t.model}</code>, each backed by at least k = {sprint.k} notes that a second model call
            confirmed. Notes are never shown and were deleted after this step.
            {t.source && (
              <>
                {" "}
                Saved run: <code>{t.source}</code>.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

const EVIDENCE_LABELS: Record<string, string> = {
  "metric:energy": "energy",
  "metric:workload": "workload",
  "metric:clarity": "goal clarity",
  blocked: "blocked",
};

function Prompts({ sprint }: { sprint: SprintRelease }) {
  const p = sprint.prompts;
  return (
    <div className="card">
      <h3>Questions for the retro</h3>
      {!p || p.prompts.length === 0 ? (
        <p className="muted small">No retro prompts were generated for this sprint.</p>
      ) : (
        <>
          <ul className="prompt-list">
            {p.prompts.map((q) => (
              <li key={q.question}>
                <div className="theme-statement">{q.question}</div>
                <div className="small muted">{q.why}</div>
                <div className="small" style={{ marginTop: 4 }}>
                  {q.basedOn.map((id) => (
                    <span key={id} className="tag" style={{ marginRight: 4 }}>
                      {EVIDENCE_LABELS[id] ?? id.replace("theme:", "theme ").replace("action:", "action ")}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginTop: 8 }}>
            Suggested by <code>{p.model}</code> from the team-level figures and themes on this page only.
            {p.source && (
              <>
                {" "}
                Saved run: <code>{p.source}</code>.
              </>
            )}
          </p>
        </>
      )}
    </div>
  );
}

function EffectBar({ effect }: { effect: ActionEffect }) {
  const d = effect.diff!;
  const span = 2;
  const pos = (v: number) => `${((Math.max(-span, Math.min(span, v)) + span) / (2 * span)) * 100}%`;
  return (
    <div aria-hidden="true" style={{ position: "relative", height: 34, margin: "6px 0 2px", maxWidth: 420 }}>
      <div style={{ position: "absolute", left: 0, right: 0, top: 12, height: 1, background: "var(--grid)" }} />
      <div style={{ position: "absolute", left: "50%", top: 2, bottom: 2, width: 1, background: "var(--axis)" }} />
      <div
        style={{
          position: "absolute",
          left: pos(d.lo),
          width: `calc(${pos(d.hi)} - ${pos(d.lo)})`,
          top: 11,
          height: 3,
          background: "var(--series)",
          borderRadius: 2,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: pos(d.estimate),
          top: 7,
          width: 12,
          height: 12,
          marginLeft: -6,
          borderRadius: "50%",
          background: "var(--series)",
          border: "2px solid var(--surface)",
        }}
      />
      {[
        { at: "0%", label: "−2", shift: "0" },
        { at: "50%", label: "0", shift: "-50%" },
        { at: "100%", label: "+2", shift: "-100%" },
      ].map((t) => (
        <span key={t.label} className="muted" style={{ position: "absolute", left: t.at, top: 21, fontSize: 10, transform: `translateX(${t.shift})` }}>
          {t.label}
        </span>
      ))}
    </div>
  );
}

function Actions({ release }: { release: Release }) {
  if (release.actions.length === 0) return null;
  const label = (id: string) => release.sprints.find((s) => s.id === id)?.label ?? id;
  return (
    <div className="card">
      <h3>Did a metric move after an action item?</h3>
      <p className="small muted">
        Team mean in up to two released sprints before the action against up to two after, with a 95% interval for the
        difference (Welch). A before/after comparison, not a controlled experiment.
      </p>
      {release.actions.map((a, i) => {
        const q = QUESTIONS.find((x) => x.id === a.metric)!;
        return (
          <div key={a.id} className="effect-row">
            <div>
              <strong>A{i + 1}</strong> {a.text} <span className="muted small">(agreed after {label(a.afterSprint)})</span>
            </div>
            {a.status === "measured" ? (
              <>
                <EffectBar effect={a} />
                <div className="small">
                  {q.label}: {one(a.before!.mean)} → {one(a.after!.mean)}, change {signed(a.diff!.estimate)} (95% CI{" "}
                  {signed(a.diff!.lo)} to {signed(a.diff!.hi)}).{" "}
                  <strong>
                    {a.verdict === "up" ? "Moved up" : a.verdict === "down" ? "Moved down" : "No clear change"}
                  </strong>
                  {a.verdict === "unclear" ? " (the interval includes zero)." : " (the interval excludes zero)."}
                </div>
                <div className="small muted">
                  Before: {a.before!.sprints.map(label).join(", ")} (n = {a.before!.n}). After: {a.after!.sprints.map(label).join(", ")} (n ={" "}
                  {a.after!.n}).
                </div>
              </>
            ) : (
              <div className="small muted">
                {a.status === "too-early" ? "Too early: no released sprint after it yet." : "No released sprint before it to compare with."}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function RetroView({ release }: { release: Release }) {
  const released = release.sprints.filter((s) => s.status === "released");
  const [selectedId, setSelectedId] = useState(released[released.length - 1]?.id ?? release.sprints[0]?.id);
  if (release.sprints.length === 0) {
    return <p className="muted">No sprints yet. Start one on the facilitator page.</p>;
  }
  const selected = release.sprints.find((s) => s.id === selectedId)!;
  const selIndex = release.sprints.indexOf(selected);
  const prev = released.filter((s) => s.index < selected.index).pop();

  const markers: Marker[] = release.actions
    .map((a, i) => ({ after: release.sprints.findIndex((s) => s.id === a.afterSprint), label: `A${i + 1}` }))
    .filter((m) => m.after >= 0 && m.after < release.sprints.length - 1);
  const metricPoints = (q: QuestionId): TrendPoint[] =>
    release.sprints.map((s) =>
      s.team
        ? { label: s.label, shown: true, mean: s.team.means[q], lo: s.team.intervals[q].lo, hi: s.team.intervals[q].hi, detail: `${s.team.n} responses` }
        : { label: s.label, shown: false },
    );
  const blockedPoints: TrendPoint[] = release.sprints.map((s) => {
    if (!s.team) return { label: s.label, shown: false };
    const ci = wilsonInterval(s.team.blocked, s.team.n);
    return { label: s.label, shown: true, mean: ci.estimate, lo: ci.lo, hi: ci.hi, detail: `${s.team.blocked} of ${s.team.n} responses` };
  });

  return (
    <>
      <div className="segmented" role="group" aria-label="Sprint">
        {release.sprints.map((s) => (
          <button key={s.id} type="button" aria-pressed={s.id === selectedId} onClick={() => setSelectedId(s.id)}>
            {s.label}
          </button>
        ))}
      </div>

      {selected.status === "open" && (
        <p className="notice">Check-in for {selected.label} is still open. Nothing is shown until it closes, so that results cannot be compared before and after one more person answers.</p>
      )}
      {selected.status === "below-k" && (
        <p className="notice">{selected.label} had fewer than k = {selected.k} responses, so nothing from it is shown, and it is left out of trends and before/after comparisons.</p>
      )}

      {selected.team && (
        <>
          <div className="tiles">
            {QUESTIONS.map((q) => (
              <Tile
                key={q.id}
                label={`${q.label} (1–5)`}
                value={one(selected.team!.means[q.id])}
                sub={`95% CI ${one(selected.team!.intervals[q.id].lo)}–${one(selected.team!.intervals[q.id].hi)} · ${delta(selected.team!.means[q.id], prev?.team?.means[q.id], prev?.label)}`}
              />
            ))}
            <Tile
              label="Blocked a day or more"
              value={pct(selected.team.blocked / selected.team.n)}
              sub={`${selected.team.blocked} of ${selected.team.n} responses · k = ${selected.k}`}
            />
          </div>
          <div className="grid-2">
            <Bands sprint={selected} />
            <Themes sprint={selected} />
          </div>
          <Prompts sprint={selected} />
          <Breakdown sprint={selected} />
        </>
      )}

      <section className="section">
        <h2>Trends by sprint</h2>
        <p className="small muted">
          Team mean with its 95% interval (shaded). Hidden sprints break the line. A1, A2 mark when an action item was agreed.
        </p>
        <div className="multiples">
          {QUESTIONS.map((q) => (
            <div className="card" key={q.id}>
              <TrendChart title={q.label} subtitle={`Team mean, 1 = ${q.low}, 5 = ${q.high}`} points={metricPoints(q.id)} domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} format={one} markers={markers} selected={selIndex} />
            </div>
          ))}
          <div className="card">
            <TrendChart title="Blocked" subtitle="Share blocked a day or more" points={blockedPoints} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} format={pct} markers={markers} selected={selIndex} />
          </div>
        </div>
        <details className="panel">
          <summary>Trends as a table</summary>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th className="num">Responses</th>
                  {QUESTIONS.map((q) => (
                    <th key={q.id} className="num">
                      {q.label} (95% CI)
                    </th>
                  ))}
                  <th className="num">Blocked</th>
                </tr>
              </thead>
              <tbody>
                {release.sprints.map((s) =>
                  s.team ? (
                    <tr key={s.id}>
                      <td>{s.label}</td>
                      <td className="num">{s.team.n}</td>
                      {QUESTIONS.map((q) => (
                        <td key={q.id} className="num">
                          {one(s.team!.means[q.id])} ({one(s.team!.intervals[q.id].lo)}–{one(s.team!.intervals[q.id].hi)})
                        </td>
                      ))}
                      <td className="num">
                        {s.team.blocked} of {s.team.n}
                      </td>
                    </tr>
                  ) : (
                    <tr key={s.id}>
                      <td>{s.label}</td>
                      <td colSpan={QUESTIONS.length + 2} className="hidden-cell">
                        {s.status === "open" ? "Check-in open" : "Not shown: fewer than k responses"}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        </details>
      </section>

      <section className="section">
        <Actions release={release} />
      </section>
    </>
  );
}
