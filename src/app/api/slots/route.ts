import { freeSlots } from "../../../server/booking";
import { guard, json } from "../../../server/http";
import { getStore } from "../../../server/store";

export async function GET(req: Request) {
  return guard(async () => {
    const n = Number(new URL(req.url).searchParams.get("count") ?? 8);
    const count = Number.isInteger(n) ? Math.min(Math.max(n, 1), 60) : 8;
    return json(await freeSlots(getStore(), count));
  });
}
