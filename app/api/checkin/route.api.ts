import { body, handle, json } from "@/lib/api";
import { mutate, submitCheckin } from "@/lib/store";

/** Submit a check-in. The reply never echoes the answers. */
export async function POST(request: Request) {
  return handle(async () => {
    const b = await body(request);
    await mutate((data) => submitCheckin(data, b));
    return json({ ok: true }, 201);
  });
}
