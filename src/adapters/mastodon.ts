/**
 * Mastodon. Credentials: { instance: "mastodon.social", accessToken }.
 *   start: POST /api/v2/media (multipart, description = alt) for each of up to 4 images or 1 video.
 *          All ready (200) -> post at once. Any 202 -> working, containerId = the media ids.
 *   poll:  GET /api/v1/media/:id until every url is set, then POST /api/v1/statuses with
 *          media_ids[] and Idempotency-Key = the delivery id, so a retry never posts twice.
 */

import type { AccountStore } from "../core/accounts";
import { textFor, type Adapter, type PlannedRequest, type Step } from "../core/adapter";
import type { Post } from "../core/types";
import { credentials, httpStep, readMedia, trim } from "./util";

export const MASTODON_MAX = 500;
/** Mastodon counts every link as 23 characters. */
const LINK_LENGTH = 23;
const IMAGES_MAX = 4;

export function mastodonLength(text: string): number {
  let n = 0;
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/[^\s]+/gi)) {
    n += Array.from(text.slice(last, m.index)).length + LINK_LENGTH;
    last = m.index + m[0].length;
  }
  return n + Array.from(text.slice(last)).length;
}

const host = (instance: string) => {
  const s = instance.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
};

function problem(post: Post, text: string): string | null {
  const videos = post.media.filter((m) => m.kind === "video").length;
  if (videos > 1 || (videos === 1 && post.media.length > 1)) return "Mastodon takes up to 4 images or 1 video, not both";
  if (post.media.length > IMAGES_MAX) return `Mastodon takes at most ${IMAGES_MAX} images`;
  if (!text.trim() && !post.media.length) return "no text or media for Mastodon";
  const n = mastodonLength(text);
  if (n > MASTODON_MAX) return `the Mastodon text is ${n} characters; the limit is ${MASTODON_MAX}`;
  return null;
}

export function createMastodonAdapter(accounts: AccountStore): Adapter {
  const creds = () => credentials(accounts, "mastodon", ["instance", "accessToken"]);

  async function message(res: Response, what: string): Promise<Step> {
    const j = (await res.json().catch(() => ({}))) as { error?: string };
    return httpStep(res.status, `mastodon ${what} ${res.status}: ${j.error ?? "no message"}`);
  }

  async function status(h: string, token: string, id: string, text: string, mediaIds: string[]): Promise<Step> {
    const res = await fetch(`${h}/api/v1/statuses`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "Idempotency-Key": id },
      body: JSON.stringify({ status: text, ...(mediaIds.length ? { media_ids: mediaIds } : {}) }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return message(res, "post");
    const j = (await res.json().catch(() => ({}))) as { id?: string; url?: string };
    if (!j.id) return { status: "failed", error: trim("Mastodon accepted the post but returned no id; check the account before retrying") };
    return { status: "posted", remoteId: j.id, url: j.url ?? null };
  }

  return {
    platform: "mastodon",

    plan(d, post): PlannedRequest[] {
      const text = textFor(post, "mastodon");
      const bad = problem(post, text);
      const h = "https://<instance>";
      if (bad) return [{ method: "POST", url: `${h}/api/v1/statuses`, body: { refused: bad } }];
      return [
        ...post.media.map((m): PlannedRequest => ({ method: "POST", url: `${h}/api/v2/media`, body: { file: `<bytes of ${m.id}>`, description: m.alt ?? "" } })),
        ...(post.media.length ? [{ method: "GET", url: `${h}/api/v1/media/<media id>` } as PlannedRequest] : []),
        { method: "POST", url: `${h}/api/v1/statuses`, body: { status: text, ...(post.media.length ? { media_ids: post.media.map((_, i) => `<media id ${i + 1}>`).join(",") } : {}), "Idempotency-Key": d.id } },
      ];
    },

    async start(d, post): Promise<Step> {
      const text = textFor(post, "mastodon").trim();
      const bad = problem(post, text);
      if (bad) return { status: "failed", error: bad };
      const files = await Promise.all(post.media.map((m) => readMedia(m)));
      const { c, step } = await creds();
      if (!c) return step;
      const h = host(c.instance);
      if (!post.media.length) return status(h, c.accessToken, d.id, text, []);

      const ids: string[] = [];
      let processing = false;
      for (const [i, m] of post.media.entries()) {
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(files[i])], { type: m.mime }), `${m.id}`);
        if (m.alt) form.append("description", m.alt);
        const res = await fetch(`${h}/api/v2/media`, {
          method: "POST", headers: { Authorization: `Bearer ${c.accessToken}` }, body: form,
          signal: AbortSignal.timeout(60_000),
        });
        if (res.status !== 200 && res.status !== 202) return message(res, "upload");
        const j = (await res.json().catch(() => ({}))) as { id?: string };
        if (!j.id) return { status: "retry", error: "Mastodon upload returned no media id" };
        ids.push(j.id);
        if (res.status === 202) processing = true;
      }
      if (processing) return { status: "working", containerId: ids.join(","), retryInS: 5 };
      return status(h, c.accessToken, d.id, text, ids);
    },

    async poll(d, post): Promise<Step> {
      if (!d.containerId) return { status: "retry", containerId: null, error: "no uploaded media to post" };
      const text = textFor(post, "mastodon").trim();
      const bad = problem(post, text);
      if (bad) return { status: "failed", error: bad };
      const { c, step } = await creds();
      if (!c) return step;
      const h = host(c.instance);
      const ids = d.containerId.split(",");
      for (const id of ids) {
        const res = await fetch(`${h}/api/v1/media/${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${c.accessToken}` }, signal: AbortSignal.timeout(20_000),
        });
        // 206 while it is still processing; an unknown id means upload again.
        if (res.status === 404) return { status: "retry", containerId: null, error: "mastodon media expired; uploading again" };
        if (!res.ok && res.status !== 206) return message(res, "media check");
        const j = (await res.json().catch(() => ({}))) as { url?: string | null };
        if (!j.url) return { status: "working", retryInS: 5 };
      }
      return status(h, c.accessToken, d.id, text, ids);
    },
  };
}
