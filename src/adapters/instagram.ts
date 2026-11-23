/**
 * Instagram through the Graph API content publishing flow.
 * Credentials: { accessToken, igUserId }.
 *   start: image -> POST /{ig-user}/media (image_url, caption, alt_text)
 *          video -> media_type=REELS with video_url
 *          2-10 images -> one child container each (is_carousel_item), then a CAROUSEL parent
 *   poll:  GET /{container}?fields=status_code; FINISHED -> POST /{ig-user}/media_publish
 *          -> media id -> GET /{media}?fields=permalink
 * Instagram fetches media from PUBLIC_URL/media/<id>.<ext>. A Reel takes a minute or
 * more to process, so its container is checked on later ticks.
 */

import type { AccountStore } from "../core/accounts";
import { textFor, type Adapter, type PlannedRequest, type Step } from "../core/adapter";
import { mediaUrl } from "../core/media";
import type { Delivery, Media, Post } from "../core/types";
import { graph, META_GRAPH } from "./graph";
import { credentials } from "./util";

export const IG_CAPTION_MAX = 2200;
const ALT_MAX = 1000;
const CAROUSEL_MAX = 10;

const alt = (m: Media) => m.alt?.trim().slice(0, ALT_MAX);

/** What is wrong with this post for Instagram, or null. */
function problem(post: Post, text: string): string | null {
  if (!post.media.length) return "Instagram needs an image or a video";
  if (post.media.length > CAROUSEL_MAX) return `Instagram takes at most ${CAROUSEL_MAX} media in a carousel`;
  if (post.media.length > 1 && post.media.some((m) => m.kind === "video")) return "carousels with a video are not supported on the Instagram adapter yet";
  if (Array.from(text).length > IG_CAPTION_MAX) return `the Instagram caption is over ${IG_CAPTION_MAX} characters`;
  return null;
}

function single(m: Media, caption: string): Record<string, string> {
  if (m.kind === "video") return { media_type: "REELS", video_url: mediaUrl(m), caption, share_to_feed: "true" };
  const body: Record<string, string> = { image_url: mediaUrl(m), caption };
  if (alt(m)) body.alt_text = alt(m)!;
  return body;
}
const item = (m: Media): Record<string, string> => ({ image_url: mediaUrl(m), is_carousel_item: "true", ...(alt(m) ? { alt_text: alt(m)! } : {}) });
const parent = (children: string[], caption: string) => ({ media_type: "CAROUSEL", children: children.join(","), caption });

const isReel = (post: Post) => post.media.length === 1 && post.media[0].kind === "video";

export function createInstagramAdapter(accounts: AccountStore): Adapter {
  const creds = () => credentials(accounts, "instagram", ["accessToken", "igUserId"]);

  return {
    platform: "instagram",

    plan(_d: Delivery, post: Post): PlannedRequest[] {
      const text = textFor(post, "instagram");
      const bad = problem(post, text);
      if (bad) return [{ method: "POST", url: `${META_GRAPH}/<ig user id>/media`, body: { refused: bad } }];
      const url = `${META_GRAPH}/<ig user id>/media`;
      const first: PlannedRequest[] = post.media.length > 1
        ? [
            ...post.media.map((m): PlannedRequest => ({ method: "POST", url, body: item(m) })),
            { method: "POST", url, body: parent(post.media.map((_, i) => `<item ${i + 1} id>`), text) },
          ]
        : [{ method: "POST", url, body: single(post.media[0], text) }];
      return [
        ...first,
        { method: "GET", url: `${META_GRAPH}/<container id>?fields=status_code,status` },
        { method: "POST", url: `${META_GRAPH}/<ig user id>/media_publish`, body: { creation_id: "<container id>" } },
        { method: "GET", url: `${META_GRAPH}/<media id>?fields=permalink` },
      ];
    },

    async start(_d, post): Promise<Step> {
      const text = textFor(post, "instagram").trim();
      const bad = problem(post, text);
      if (bad) return { status: "failed", error: bad };
      const { c, step } = await creds();
      if (!c) return step;
      const call = <T>(path: string, body: Record<string, string>) => graph<T>("instagram", META_GRAPH, "POST", path, c.accessToken, body);
      const media = `/${c.igUserId}/media`;

      if (post.media.length === 1) {
        const r = await call<{ id?: string }>(media, single(post.media[0], text));
        if (!r.ok) return r.step;
        if (!r.json.id) return { status: "retry", error: "Instagram returned no container id" };
        return { status: "working", containerId: r.json.id, retryInS: isReel(post) ? 60 : 5 };
      }
      // Child containers first (an image child is ready almost at once), then the parent,
      // which poll() follows like a single image. A failure part way leaves orphan children,
      // which Meta drops after 24 hours.
      const children: string[] = [];
      for (const m of post.media) {
        const r = await call<{ id?: string }>(media, item(m));
        if (!r.ok) return r.step;
        if (!r.json.id) return { status: "retry", error: `Instagram returned no id for carousel item ${children.length + 1}` };
        children.push(r.json.id);
      }
      const p = await call<{ id?: string }>(media, parent(children, text));
      if (!p.ok) return p.step;
      if (!p.json.id) return { status: "retry", error: "Instagram returned no carousel container id" };
      return { status: "working", containerId: p.json.id, retryInS: 10 };
    },

    async poll(d, post): Promise<Step> {
      const container = d.containerId;
      if (!container) return { status: "retry", containerId: null, error: "no container to check" };
      const { c, step } = await creds();
      if (!c) return step;
      const get = <T>(path: string) => graph<T>("instagram", META_GRAPH, "GET", path, c.accessToken);

      const s = await get<{ status_code?: string; status?: string }>(`/${encodeURIComponent(container)}?fields=status_code,status`);
      if (!s.ok) return s.step;
      switch (s.json.status_code) {
        case "IN_PROGRESS":
          return { status: "working", retryInS: isReel(post) ? 60 : 10 };
        case "ERROR":
        case "EXPIRED":
          // Start over with a new container next time.
          return { status: "retry", containerId: null, error: `container ${s.json.status_code}: ${s.json.status ?? ""}`.trim() };
        case "PUBLISHED":
          // Published by an earlier attempt whose answer was lost: never publish it twice.
          return { status: "posted", error: "Instagram shows it published; the post id was not recorded" };
        case "FINISHED": {
          const p = await graph<{ id?: string }>("instagram", META_GRAPH, "POST", `/${c.igUserId}/media_publish`, c.accessToken, { creation_id: container });
          if (!p.ok) return p.step;
          if (!p.json.id) return { status: "retry", error: "media_publish returned no id" };
          const link = await get<{ permalink?: string }>(`/${encodeURIComponent(p.json.id)}?fields=permalink`).catch(() => null);
          return { status: "posted", remoteId: p.json.id, url: (link?.ok && link.json.permalink) || null };
        }
        default:
          return { status: "working", retryInS: 30 };
      }
    },
  };
}
