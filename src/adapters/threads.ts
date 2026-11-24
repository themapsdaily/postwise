/**
 * Threads: text, image, video or carousel. Credentials: { accessToken, userId? }
 * (the user id is looked up with GET /me when not given).
 *   start: POST /{user}/threads (media_type TEXT | IMAGE | VIDEO, or CAROUSEL over
 *          2-20 image children) -> container id
 *   poll:  GET /{container}?fields=status,error_message; FINISHED -> POST /{user}/threads_publish
 *          -> media id -> GET /{media}?fields=permalink
 * Threads fetches media from PUBLIC_URL/media/<id>.<ext>.
 */

import type { AccountStore } from "../core/accounts";
import { textFor, type Adapter, type PlannedRequest, type Step } from "../core/adapter";
import { mediaUrl } from "../core/media";
import type { Delivery, Media, Post } from "../core/types";
import { graph, THREADS_GRAPH } from "./graph";
import { credentials } from "./util";
import { THREADS_MAX, threadsLength } from "./threadsText";

export { THREADS_MAX, threadsLength };

const CAROUSEL_MAX = 20;

function problem(post: Post, text: string): string | null {
  if (!post.media.length && !text.trim()) return "Threads needs text or media";
  if (post.media.length > CAROUSEL_MAX) return `Threads takes at most ${CAROUSEL_MAX} media in a carousel`;
  if (post.media.length > 1 && post.media.some((m) => m.kind === "video")) return "carousels with a video are not supported on the Threads adapter yet";
  if (threadsLength(text) > THREADS_MAX) return `the Threads text is over ${THREADS_MAX} characters`;
  return null;
}

const single = (post: Post, text: string): Record<string, string> => {
  const m: Media | undefined = post.media[0];
  if (!m) return { media_type: "TEXT", text };
  return m.kind === "video"
    ? { media_type: "VIDEO", video_url: mediaUrl(m), text }
    : { media_type: "IMAGE", image_url: mediaUrl(m), text };
};
const item = (m: Media): Record<string, string> => ({ media_type: "IMAGE", image_url: mediaUrl(m), is_carousel_item: "true" });

export function createThreadsAdapter(accounts: AccountStore): Adapter {
  const creds = () => credentials(accounts, "threads", ["accessToken"]);
  const hasVideo = (post: Post) => post.media[0]?.kind === "video";

  async function userId(c: Record<string, string>) {
    if (c.userId) return { id: c.userId };
    const me = await graph<{ id?: string }>("threads", THREADS_GRAPH, "GET", "/me?fields=id", c.accessToken);
    if (!me.ok) return { step: me.step };
    if (!me.json.id) return { step: { status: "retry", error: "Threads did not return the account id" } as Step };
    return { id: me.json.id };
  }

  return {
    platform: "threads",

    plan(_d: Delivery, post: Post): PlannedRequest[] {
      const text = textFor(post, "threads");
      const bad = problem(post, text);
      const url = `${THREADS_GRAPH}/<threads user id>/threads`;
      if (bad) return [{ method: "POST", url, body: { refused: bad } }];
      const first: PlannedRequest[] = post.media.length > 1
        ? [
            ...post.media.map((m): PlannedRequest => ({ method: "POST", url, body: item(m) })),
            { method: "POST", url, body: { media_type: "CAROUSEL", children: post.media.map((_, i) => `<item ${i + 1} id>`).join(","), text } },
          ]
        : [{ method: "POST", url, body: single(post, text) }];
      return [
        ...first,
        { method: "GET", url: `${THREADS_GRAPH}/<container id>?fields=status,error_message` },
        { method: "POST", url: `${THREADS_GRAPH}/<threads user id>/threads_publish`, body: { creation_id: "<container id>" } },
        { method: "GET", url: `${THREADS_GRAPH}/<media id>?fields=permalink` },
      ];
    },

    async start(_d, post): Promise<Step> {
      const text = textFor(post, "threads").trim();
      const bad = problem(post, text);
      if (bad) return { status: "failed", error: bad };
      const { c, step } = await creds();
      if (!c) return step;
      const u = await userId(c);
      if (!u.id) return u.step!;
      const create = (body: Record<string, string>) => graph<{ id?: string }>("threads", THREADS_GRAPH, "POST", `/${u.id}/threads`, c.accessToken, body);

      if (post.media.length <= 1) {
        const r = await create(single(post, text));
        if (!r.ok) return r.step;
        if (!r.json.id) return { status: "retry", error: "Threads returned no container id" };
        // Meta suggests about 30 s before publishing; the status check says when it is ready.
        return { status: "working", containerId: r.json.id, retryInS: hasVideo(post) ? 60 : 8 };
      }
      const children: string[] = [];
      for (const m of post.media) {
        const r = await create(item(m));
        if (!r.ok) return r.step;
        if (!r.json.id) return { status: "retry", error: `Threads returned no id for carousel item ${children.length + 1}` };
        children.push(r.json.id);
      }
      const p = await create({ media_type: "CAROUSEL", children: children.join(","), text });
      if (!p.ok) return p.step;
      if (!p.json.id) return { status: "retry", error: "Threads returned no carousel container id" };
      return { status: "working", containerId: p.json.id, retryInS: 10 };
    },

    async poll(d, post): Promise<Step> {
      const container = d.containerId;
      if (!container) return { status: "retry", containerId: null, error: "no container to check" };
      const { c, step } = await creds();
      if (!c) return step;
      const get = <T>(path: string) => graph<T>("threads", THREADS_GRAPH, "GET", path, c.accessToken);

      const s = await get<{ status?: string; error_message?: string }>(`/${encodeURIComponent(container)}?fields=status,error_message`);
      if (!s.ok) return s.step;
      switch (s.json.status) {
        case "IN_PROGRESS":
          return { status: "working", retryInS: hasVideo(post) ? 60 : 8 };
        case "ERROR":
        case "EXPIRED":
          return { status: "retry", containerId: null, error: `container ${s.json.status}: ${s.json.error_message ?? ""}`.trim() };
        case "PUBLISHED":
          return { status: "posted", error: "Threads shows it published; the post id was not recorded" };
        case "FINISHED": {
          const u = await userId(c);
          if (!u.id) return u.step!;
          const p = await graph<{ id?: string }>("threads", THREADS_GRAPH, "POST", `/${u.id}/threads_publish`, c.accessToken, { creation_id: container });
          if (!p.ok) return p.step;
          if (!p.json.id) return { status: "retry", error: "threads_publish returned no id" };
          const link = await get<{ permalink?: string }>(`/${encodeURIComponent(p.json.id)}?fields=permalink`).catch(() => null);
          return { status: "posted", remoteId: p.json.id, url: (link?.ok && link.json.permalink) || null };
        }
        default:
          return { status: "working", retryInS: 30 };
      }
    },
  };
}
