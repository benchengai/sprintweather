import { handle, json } from "@/lib/api";
import { getRelease } from "@/lib/data";

export const dynamic = "force-dynamic";

/** The release: the only read API. There is no endpoint for raw responses. */
export async function GET() {
  return handle(async () => json(await getRelease()));
}
