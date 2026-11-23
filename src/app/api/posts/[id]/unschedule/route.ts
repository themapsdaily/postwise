import { fail, guard, json } from "../../../../../server/http";
import { getStore } from "../../../../../server/store";

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const store = getStore();
    const id = (await ctx.params).id;
    let post;
    try { post = await store.getPost(id); } catch { return fail(404, "Post not found"); }
    if (post.status !== "approved") return fail(409, "Only an approved post can be unscheduled");
    return json(await store.updatePost(id, { status: "draft", slotAt: null }));
  });
}
