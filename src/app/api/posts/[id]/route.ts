import { fail, guard, json, readJson } from "../../../../server/http";
import { patchPostSchema, resolveMedia } from "../../../../server/schemas";
import { getStore } from "../../../../server/store";
import type { Post } from "../../../../core/types";

type Ctx = { params: Promise<{ id: string }> };

async function find(id: string): Promise<Post | null> {
  try { return await getStore().getPost(id); } catch { return null; }
}

export async function GET(_req: Request, ctx: Ctx) {
  return guard(async () => {
    const post = await find((await ctx.params).id);
    return post ? json(post) : fail(404, "Post not found");
  });
}

/**
 * Editing text, platforms or media of an approved post sends it back to draft
 * (slot cleared) so the checks run again when it is re-approved. A slot-only
 * change keeps it approved.
 */
export async function PATCH(req: Request, ctx: Ctx) {
  return guard(async () => {
    const post = await find((await ctx.params).id);
    if (!post) return fail(404, "Post not found");
    if (post.status === "posting" || post.status === "posted") return fail(409, `A ${post.status} post cannot be edited`);
    const body = await readJson(req, patchPostSchema);
    if (!body.ok) return body.res;
    const { media: rawMedia, slotAt, ...rest } = body.data;
    const patch: Partial<Post> = { ...rest };
    if (rawMedia) {
      const m = resolveMedia(rawMedia);
      if (!m.ok) return fail(400, m.error);
      patch.media = m.media;
    }
    if (slotAt !== undefined) patch.slotAt = slotAt;
    if (post.status === "approved" && (rawMedia || rest.caption !== undefined || rest.platforms || rest.perPlatform)) {
      patch.status = "draft";
      patch.slotAt = null;
    }
    return json(await getStore().updatePost(post.id, patch));
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return guard(async () => {
    const post = await find((await ctx.params).id);
    if (!post) return fail(404, "Post not found");
    if (post.status === "posting") return fail(409, "A post that is going out cannot be deleted");
    await getStore().deletePost(post.id);
    return json({ ok: true });
  });
}
