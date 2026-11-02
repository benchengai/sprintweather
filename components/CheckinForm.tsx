"use client";

import { useState } from "react";

import { BLOCKED_PROMPT, QUESTIONS, type Dimension } from "@/lib/types";

type Answers = Record<string, number | undefined>;

export function CheckinForm({
  demo,
  sprintLabel,
  dimensions,
  k,
  noteMax,
}: {
  demo: boolean;
  sprintLabel: string | null;
  dimensions: Dimension[];
  k: number;
  noteMax: number;
}) {
  const [code, setCode] = useState("");
  const [scores, setScores] = useState<Answers>({});
  const [blocked, setBlocked] = useState<boolean | undefined>();
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ kind: "idle" | "sending" | "done" | "error"; message?: string }>({ kind: "idle" });

  const complete = QUESTIONS.every((q) => scores[q.id] !== undefined) && blocked !== undefined && (demo || code.trim() !== "");

  if (!demo && !sprintLabel) {
    return <p className="notice">There is no open check-in right now. The facilitator opens one at the end of each sprint.</p>;
  }
  if (state.kind === "done") {
    return (
      <div className="card">
        <h2>Thank you</h2>
        <p>{state.message}</p>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complete) return;
    if (demo) {
      setState({ kind: "done", message: "This is the static demo, so nothing was sent or stored. In local mode this answer would join the open sprint's check-in." });
      return;
    }
    setState({ kind: "sending" });
    const res = await fetch("/api/checkin/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, ...scores, blocked, attrs, note: note.trim() || undefined }),
    });
    const out = (await res.json().catch(() => ({}))) as { error?: string };
    if (res.ok) {
      setState({ kind: "done", message: `Your check-in for ${sprintLabel} is in. Results appear after check-in closes, and only if at least ${k} people answered.` });
    } else {
      setState({ kind: "error", message: out.error ?? "Something went wrong." });
    }
  };

  return (
    <form className="card" onSubmit={submit}>
      {demo ? (
        <p className="notice">Static demo: you can try the form, but nothing is sent or stored.</p>
      ) : (
        <p className="small muted">Check-in for {sprintLabel}.</p>
      )}

      {!demo && (
        <div className="field">
          <label htmlFor="code">Your check-in code</label>
          <input id="code" type="text" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH" />
          <div className="small muted">Single use. It is not stored with your answers.</div>
        </div>
      )}

      {QUESTIONS.map((q) => (
        <fieldset key={q.id}>
          <legend>{q.prompt}</legend>
          <div className="scale">
            <span className="small muted">{q.low}</span>
            {[1, 2, 3, 4, 5].map((v) => (
              <label key={v}>
                <input type="radio" name={q.id} value={v} checked={scores[q.id] === v} onChange={() => setScores((s) => ({ ...s, [q.id]: v }))} />
                <span>{v}</span>
              </label>
            ))}
            <span className="small muted">{q.high}</span>
          </div>
        </fieldset>
      ))}

      <fieldset>
        <legend>{BLOCKED_PROMPT}</legend>
        <div className="scale">
          {[
            { v: true, label: "Yes" },
            { v: false, label: "No" },
          ].map((o) => (
            <label key={o.label} style={{ minWidth: 64 }}>
              <input type="radio" name="blocked" value={o.label.toLowerCase()} checked={blocked === o.v} onChange={() => setBlocked(o.v)} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {dimensions.map((d) => (
        <div className="field" key={d.id}>
          <label htmlFor={`attr-${d.id}`}>{d.label} (optional)</label>
          <select id={`attr-${d.id}`} value={attrs[d.id] ?? ""} onChange={(e) => setAttrs((a) => ({ ...a, [d.id]: e.target.value }))}>
            <option value="">Prefer not to say</option>
            {d.values.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </div>
      ))}
      {dimensions.length > 0 && (
        <p className="small muted" style={{ marginTop: -8 }}>
          Groups are only shown when that cannot narrow anything down to fewer than {k} people. A small group is never shown on its own.
        </p>
      )}

      <div className="field">
        <label htmlFor="note">Anything the team should talk about? (optional)</label>
        <textarea id="note" maxLength={noteMax} value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="small muted">
          Never shown as written. It only counts towards a paraphrased theme if at least {k} notes make the same point, and it
          is deleted once themes are made. Please leave out names.
        </div>
      </div>

      {state.kind === "error" && (
        <p className="notice" role="alert">
          {state.message}
        </p>
      )}
      <button type="submit" className="btn btn-primary" disabled={!complete || state.kind === "sending"}>
        {state.kind === "sending" ? "Sending…" : "Send check-in"}
      </button>
    </form>
  );
}
