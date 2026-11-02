import { body, handle, json } from "@/lib/api";
import { addAction, mutate } from "@/lib/store";

export async function POST(request: Request) {
  return handle(async () => {
    const b = await body(request);
    return json(await mutate((data) => addAction(data, b)), 201);
  });
}
