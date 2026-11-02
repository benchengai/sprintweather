import { connection } from "next/server";

import { RetroView } from "@/components/RetroView";
import { getRelease, isDemo } from "@/lib/data";

export default async function RetroPage() {
  if (!isDemo) await connection();
  // The page receives the release and nothing else: no responses, no notes.
  const release = await getRelease();
  return (
    <>
      <h1>Retro view</h1>
      <p className="lede">
        Team-level results for each closed sprint. Every figure covers at least k = {release.k} responses
        {isDemo ? " (fixed at close for each sprint)" : ""}; groups that could expose a smaller set are not shown.
      </p>
      <RetroView release={release} />
    </>
  );
}
