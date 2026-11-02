"use client";

import { useState } from "react";

import type { FacilitatorStatus } from "@/lib/api";
import { QUESTIONS } from "@/lib/types";

async function post(url: string, data: unknown = {}): Promise<Record<string, unknown>> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(String(out.error ?? res.statusText));
  return out;
}

export function FacilitatorPanel({ initial }: { initial: FacilitatorStatus }) {
  const [status, setStatus] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [label, setLabel] = useState("");
  const [codeCount, setCodeCount] = useState(10);
  const [action, setAction] = useState({ afterSprint: "", text: "", metric: "energy" });
  const [k, setK] = useState(String(initial.k));
  const [dimText, setDimText] = useState(Object.fromEntries(initial.dimensions.map((d) => [d.id, d.values.join(", ")])));

  const refresh = async () => setStatus(await (await fetch("/api/status/", { cache: "no-store" })).json());
  const run = async (name: string, fn: () => Promise<string | void>) => {
    setBusy(name);
    setMessage(null);
    try {
      const m = await fn();
      if (m) setMessage(m);
      await refresh();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const closedReleased = status.closed.filter((s) => s.released);
  return (
    <>
      {message && (
        <p className="notice" role="status">
          {message}
        </p>
      )}

      <section className="card">
        <h2>Check-in</h2>
        {status.open ? (
          <>
            <p>
              <strong>{status.open.label}</strong> is open ({status.open.codesIssued} codes issued).{" "}
              {status.open.ready ? "At least k responses are in." : "Fewer than k responses so far."}
            </p>
            <button className="btn btn-primary" disabled={busy !== null} onClick={() => run("close", async () => { await post("/api/sprints/close/"); setCodes(null); return "Check-in closed."; })}>
              Close check-in
            </button>
          </>
        ) : (
          <div>
            <div className="field">
              <label htmlFor="label">Sprint name</label>
              <input id="label" type="text" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Sprint 27" />
            </div>
            <div className="field">
              <label htmlFor="codes">Codes to issue (one per team member)</label>
              <input id="codes" type="number" min={1} max={200} value={codeCount} onChange={(e) => setCodeCount(Number(e.target.value))} />
            </div>
            <button
              className="btn btn-primary"
              disabled={busy !== null || !label.trim()}
              onClick={() =>
                run("open", async () => {
                  const out = await post("/api/sprints/", { label, codes: codeCount });
                  setCodes(out.codes as string[]);
                  setLabel("");
                  return "Check-in opened. Hand out the codes below; they are shown only once.";
                })
              }
            >
              Open check-in
            </button>
          </div>
        )}
        {codes && (
          <div style={{ marginTop: 12 }}>
            <p className="small muted">Single-use codes, shown once. Give one to each person in any order; the app cannot tell which code was used by whom.</p>
            <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Closed sprints</h2>
        {!status.apiKey && <p className="small muted">Set OPENAI_API_KEY in .env.local to generate themes and retro questions (model: {status.model}).</p>}
        {status.closed.length === 0 ? (
          <p className="muted small">None yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sprint</th>
                  <th>Released</th>
                  <th>Themes</th>
                  <th>Retro questions</th>
                </tr>
              </thead>
              <tbody>
                {status.closed.map((s) => (
                  <tr key={s.id}>
                    <td>{s.label}</td>
                    <td>{s.released ? "yes" : "no (fewer than k)"}</td>
                    <td>
                      {s.hasThemes ? (
                        "done"
                      ) : s.released && s.hasNotes ? (
                        <>
                          <button className="btn" disabled={busy !== null || !status.apiKey} onClick={() => run(`t${s.id}`, async () => { const o = await post("/api/themes/", { sprintId: s.id }); return `${o.themes} themes released; notes deleted.`; })}>
                            {busy === `t${s.id}` ? "Working…" : "Generate"}
                          </button>{" "}
                          <button className="btn" disabled={busy !== null} onClick={() => run(`d${s.id}`, async () => { await post("/api/notes/discard/", { sprintId: s.id }); return "Notes deleted."; })}>
                            Discard notes
                          </button>
                        </>
                      ) : (
                        <span className="muted">no notes</span>
                      )}
                    </td>
                    <td>
                      {s.released ? (
                        <button className="btn" disabled={busy !== null || !status.apiKey} onClick={() => run(`p${s.id}`, async () => { const o = await post("/api/prompts/", { sprintId: s.id }); return `${o.prompts} questions saved.`; })}>
                          {busy === `p${s.id}` ? "Working…" : s.hasPrompts ? "Regenerate" : "Generate"}
                        </button>
                      ) : (
                        <span className="muted">–</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Action items</h2>
        {status.actions.length > 0 && (
          <ul className="small">
            {status.actions.map((a) => (
              <li key={a.id}>
                {a.text} <span className="muted">(after {status.closed.find((s) => s.id === a.afterSprint)?.label ?? a.afterSprint}; metric: {a.metric})</span>
              </li>
            ))}
          </ul>
        )}
        {closedReleased.length === 0 ? (
          <p className="muted small">Record an action item after a released sprint.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="a-text">Action agreed in the retro</label>
              <input id="a-text" type="text" maxLength={200} value={action.text} onChange={(e) => setAction({ ...action, text: e.target.value })} />
            </div>
            <div className="grid">
              <div className="field">
                <label htmlFor="a-after">Agreed after</label>
                <select id="a-after" value={action.afterSprint} onChange={(e) => setAction({ ...action, afterSprint: e.target.value })}>
                  <option value="">Pick a sprint</option>
                  {closedReleased.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="a-metric">Metric it should move</label>
                <select id="a-metric" value={action.metric} onChange={(e) => setAction({ ...action, metric: e.target.value })}>
                  {QUESTIONS.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <button className="btn btn-primary" disabled={busy !== null || !action.text.trim() || !action.afterSprint} onClick={() => run("action", async () => { await post("/api/actions/", action); setAction({ ...action, text: "" }); return "Action item recorded."; })}>
              Record action item
            </button>
          </>
        )}
      </section>

      <section className="card">
        <h2>Settings</h2>
        <p className="small muted">Changes apply to sprints closed from now on, and are locked while a check-in is open.</p>
        <div className="field">
          <label htmlFor="k">k (minimum responses behind any figure; at least 3)</label>
          <input id="k" type="number" min={3} max={50} value={k} onChange={(e) => setK(e.target.value)} style={{ maxWidth: 120 }} />
        </div>
        {status.dimensions.map((d) => (
          <div className="field" key={d.id}>
            <label htmlFor={`dim-${d.id}`}>{d.label} options (comma-separated; leave empty to not ask)</label>
            <input id={`dim-${d.id}`} type="text" value={dimText[d.id] ?? ""} onChange={(e) => setDimText({ ...dimText, [d.id]: e.target.value })} />
          </div>
        ))}
        <button
          className="btn"
          disabled={busy !== null || status.open !== null}
          onClick={() =>
            run("settings", async () => {
              await post("/api/settings/", {
                k: Number(k),
                dimensions: status.dimensions.map((d) => ({ ...d, values: (dimText[d.id] ?? "").split(",") })),
              });
              return "Settings saved.";
            })
          }
        >
          Save settings
        </button>
      </section>
    </>
  );
}
