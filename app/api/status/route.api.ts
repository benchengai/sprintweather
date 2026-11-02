import { facilitatorStatus, handle, json } from "@/lib/api";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export async function GET() {
  return handle(async () => json(facilitatorStatus(await readStore())));
}
