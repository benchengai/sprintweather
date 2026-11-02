import { connection } from "next/server";

import { CheckinForm } from "@/components/CheckinForm";
import { isDemo, loadDataset } from "@/lib/data";
import { NOTE_MAX_CHARS } from "@/lib/checkin";

export default async function CheckinPage() {
  if (!isDemo) await connection();
  const data = await loadDataset();
  const open = data.sprints.find((s) => s.status === "open");
  return (
    <>
      <h1>Sprint check-in</h1>
      <p className="lede">
        Optional, and about a minute. Your answers are stored without your name, your code or the time, and nobody can see
        them on their own: only team aggregates of at least k = {data.k} responses are ever shown.
      </p>
      <CheckinForm
        demo={isDemo}
        sprintLabel={open?.label ?? null}
        dimensions={data.dimensions.filter((d) => d.values.length > 0)}
        k={data.k}
        noteMax={NOTE_MAX_CHARS}
      />
    </>
  );
}
