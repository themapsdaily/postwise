import { POST_STATUSES, type PostStatus } from "../../../core/types";
import { fail, guard, json, parseWith, readJson } from "../../../server/http";
import { createPostSchema, isoSchema, resolveMedia } from "../../../server/schemas";
import { getStore } from "../../../server/store";
import { z } from "zod";

const query = z.object({
  status: z.string().optional().transform((s) => (s ? s.split(",") : undefined)).pipe(z.array(z.enum(POST_STATUSES)).optional()),
  from: isoSchema.optional(),
  to: isoSchema.optional(),
});

export async function GET(req: Request) {
  return guard(async () => {
    const sp = new URL(req.url).searchParams;
    const q = parseWith(query, { status: sp.get("status") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
    if (!q.ok) return q.res;
    return json(await getStore().listPosts({ status: q.data.status as PostStatus[] | undefined, from: q.data.from, to: q.data.to }));
  });
}

export async function POST(req: Request) {
  return guard(async () => {
    const body = await readJson(req, createPostSchema);
    if (!body.ok) return body.res;
    const media = resolveMedia(body.data.media);
    if (!media.ok) return fail(400, media.error);
    const post = await getStore().createPost({
      caption: body.data.caption, platforms: body.data.platforms, perPlatform: body.data.perPlatform,
      at: body.data.slotAt ?? undefined, media: media.media, source: "manual", status: "draft",
    });
    return json(post, 201);
  });
}
