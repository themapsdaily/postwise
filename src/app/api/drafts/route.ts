import { notifyNeedsApproval } from "../../../server/review";
import { approvePost, checkPost } from "../../../server/booking";
import { safeEqual } from "../../../server/auth";
import { blocks } from "../../../core/check";
import type { Media } from "../../../core/types";
import { fail, guard, json, readJson } from "../../../server/http";
import { draftsBodySchema } from "../../../server/schemas";
import { dataDir, getStore } from "../../../server/store";
import { importMedia } from "../../../store/media";

/** Webhook: POST one DraftInput or an array, with `Authorization: Bearer ${WEBHOOK_TOKEN}`. */
export async function POST(req: Request) {
  return guard(async () => {
    const token = process.env.WEBHOOK_TOKEN;
    if (!token) return fail(503, "WEBHOOK_TOKEN is not set: set it in the environment to enable this endpoint");
    const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
    if (!safeEqual(given, token)) return fail(401, "Bad or missing bearer token");

    const body = await readJson(req, draftsBodySchema);
    if (!body.ok) return body.res;
    const drafts = Array.isArray(body.data) ? body.data : [body.data];
    const store = getStore();
    const settings = await store.getSettings();

    // Fetch every draft's media first, so a bad URL rejects the request before any post exists. Never allowLocal: this is reachable from HTTP.
    const imported: Media[][] = [];
    for (const [i, d] of drafts.entries()) {
      const media: Media[] = [];
      for (const m of d.media ?? []) {
        try { media.push({ ...(await importMedia(m.src, dataDir())), ...(m.alt ? { alt: m.alt } : {}) }); }
        catch (e) { return fail(400, `Draft ${i}: ${e instanceof Error ? e.message : "media failed"}`); }
      }
      imported.push(media);
    }

    const created = [];
    for (const [i, d] of drafts.entries()) {
      let post = await store.createPost({
        caption: d.caption, perPlatform: d.perPlatform, at: d.at, meta: d.meta, source: "webhook",
        platforms: d.platforms ?? settings.defaultPlatforms, media: imported[i], status: "needs_approval",
      });
      if (settings.approval === "auto" && !blocks(checkPost(post))) {
        const r = await approvePost(store, post.id, { slotAt: d.at && Date.parse(d.at) > Date.now() ? d.at : undefined });
        if (r.ok) post = r.post;
      }
      await notifyNeedsApproval(post, store);
      created.push(post);
    }
    return json(Array.isArray(body.data) ? created : created[0], 201);
  });
}
