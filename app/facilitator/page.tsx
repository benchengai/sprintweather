import { connection } from "next/server";

import { FacilitatorPanel } from "@/components/FacilitatorPanel";
import { facilitatorStatus } from "@/lib/api";
import { isDemo } from "@/lib/data";
import { readStore } from "@/lib/store";

export default async function FacilitatorPage() {
  if (isDemo) {
    return (
      <>
        <h1>Facilitator</h1>
        <p className="lede">In local mode, this page runs the sprint cycle. The static demo has no server, so it is read-only.</p>
        <div className="card">
          <ol>
            <li>Open a check-in for the sprint and hand out one single-use code per team member.</li>
            <li>Close check-in when the sprint ends. k and the groups are frozen for that sprint.</li>
            <li>Generate themes (one LLM pipeline run); the notes are deleted afterwards.</li>
            <li>Generate retro questions from the released figures and themes.</li>
            <li>After the retro, record any action item and the metric it should move.</li>
          </ol>
          <p className="small muted">
            Run <code>npm run dev</code> to try it locally; see the README. The facilitator never sees a response count while
            check-in is open, only whether k has been reached.
          </p>
        </div>
      </>
    );
  }
  await connection();
  const status = facilitatorStatus(await readStore());
  return (
    <>
      <h1>Facilitator</h1>
      <p className="lede">Run the sprint cycle. You see the same release as everyone else, plus yes/no flags; never single answers or notes.</p>
      <FacilitatorPanel initial={status} />
    </>
  );
}
