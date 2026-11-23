import { checkPost } from "../../../../../server/booking";
import { fail, guard, json } from "../../../../../server/http";
import { getStore } from "../../../../../server/store";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    try { return json(checkPost(await getStore().getPost((await ctx.params).id))); } catch { return fail(404, "Post not found"); }
  });
}
