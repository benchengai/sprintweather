import { body, handle, json } from "@/lib/api";
import { discardNotes, mutate } from "@/lib/store";

export async function POST(request: Request) {
  return handle(async () => {
    const b = await body(request);
    await mutate((data) => discardNotes(data, String(b.sprintId)));
    return json({ ok: true });
  });
}
