import { body, handle, json } from "@/lib/api";
import { createSprint, mutate } from "@/lib/store";

/** Open a check-in and issue single-use codes. The codes are returned once and
 * stored only as hashes. */
export async function POST(request: Request) {
  return handle(async () => {
    const b = await body(request);
    const created = await mutate((data) => createSprint(data, String(b.label ?? ""), Number(b.codes)));
    return json(created, 201);
  });
}
