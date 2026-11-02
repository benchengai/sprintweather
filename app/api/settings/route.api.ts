import { body, handle, json } from "@/lib/api";
import { mutate, updateSettings } from "@/lib/store";

/** k and groups apply to sprints closed from now on. */
export async function POST(request: Request) {
  return handle(async () => {
    const b = await body(request);
    await mutate((data) => updateSettings(data, b));
    return json({ ok: true });
  });
}
