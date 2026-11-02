import { handle, json } from "@/lib/api";
import { closeSprint, mutate } from "@/lib/store";

/** Close the open check-in and freeze k and the groups for that sprint. */
export async function POST() {
  return handle(async () => json(await mutate((data) => closeSprint(data))));
}
