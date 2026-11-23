/**
 * X on the v2 API. Credentials: { consumerKey, consumerSecret, accessToken, accessTokenSecret }
 * (OAuth 1.0a user context, signed here).
 *   start: no media -> POST /2/tweets at once.
 *          images (up to 4) -> POST /2/media/upload each (multipart, tweet_image); the ids are
 *          kept as the delivery's containerId so a retry reuses them
 *   poll:  POST /2/tweets { text, media: { media_ids } } -> post id
 * Multipart and JSON bodies are not part of the OAuth signature.
 */

import { createHmac, randomBytes } from "node:crypto";
import type { AccountStore } from "../core/accounts";
import { textFor, type Adapter, type PlannedRequest, type Step } from "../core/adapter";
import type { Post } from "../core/types";
import { credentials, httpStep, readMedia, trim } from "./util";
import { X_MAX, xLength } from "./xText";

export const X_API = "https://api.x.com/2";
const UPLOAD = `${X_API}/media/upload`;
const TWEETS = `${X_API}/tweets`;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGES_MAX = 4;

export interface XKeys { apiKey: string; apiSecret: string; token: string; tokenSecret: string }

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** OAuth 1.0a header for a request whose body is not form-encoded (only the query is signed). */
export function oauthHeader(method: string, url: string, k: XKeys, nonce = randomBytes(16).toString("hex"), ts = Math.floor(Date.now() / 1000).toString()): string {
  const u = new URL(url);
  const oauth: Record<string, string> = {
    oauth_consumer_key: k.apiKey,
    oauth_nonce: nonce,
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: ts,
    oauth_token: k.token,
    oauth_version: "1.0",
  };
  const params: [string, string][] = [...Object.entries(oauth), ...u.searchParams.entries()].map(([a, b]) => [enc(a), enc(b)]);
  params.sort(([a, x], [b, y]) => (a === b ? (x < y ? -1 : 1) : a < b ? -1 : 1));
  const base = [method.toUpperCase(), enc(`${u.origin}${u.pathname}`), enc(params.map(([a, b]) => `${a}=${b}`).join("&"))].join("&");
  const sig = createHmac("sha1", `${enc(k.apiSecret)}&${enc(k.tokenSecret)}`).update(base).digest("base64");
  return "OAuth " + Object.entries({ ...oauth, oauth_signature: sig }).map(([a, b]) => `${enc(a)}="${enc(b)}"`).join(", ");
}

interface XProblem { title?: string; detail?: string; message?: string; errors?: { message?: string; detail?: string }[] }

async function xMessage(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as XProblem;
  return trim(`x ${res.status}: ${j.detail || j.errors?.[0]?.message || j.errors?.[0]?.detail || j.title || j.message || "no message"}`, 400);
}

function problem(post: Post, text: string): string | null {
  if (post.media.some((m) => m.kind === "video")) return "video not supported on X adapter yet";
  if (post.media.length > IMAGES_MAX) return `X takes at most ${IMAGES_MAX} images`;
  if (!text.trim() && !post.media.length) return "no text or media for X";
  if (xLength(text) > X_MAX) return `the X text is over ${X_MAX} characters`;
  return null;
}

export function createXAdapter(accounts: AccountStore): Adapter {
  const creds = async () => {
    const r = await credentials(accounts, "x", ["consumerKey", "consumerSecret", "accessToken", "accessTokenSecret"]);
    if (!r.c) return { step: r.step };
    return { k: { apiKey: r.c.consumerKey, apiSecret: r.c.consumerSecret, token: r.c.accessToken, tokenSecret: r.c.accessTokenSecret } as XKeys };
  };

  async function tweet(k: XKeys, text: string, mediaIds: string[]): Promise<Step> {
    const res = await fetch(TWEETS, {
      method: "POST",
      headers: { Authorization: oauthHeader("POST", TWEETS, k), "content-type": "application/json" },
      body: JSON.stringify({ text, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const e = await xMessage(res);
      // An expired or unknown media id: upload again on the next attempt.
      if (mediaIds.length && res.status === 400 && /media/i.test(e)) return { status: "retry", containerId: null, error: e };
      return httpStep(res.status, e);
    }
    const j = (await res.json().catch(() => ({}))) as { data?: { id?: string } };
    const id = j.data?.id;
    if (!id) return { status: "failed", error: "X accepted the post but returned no id; check the account before retrying" };
    return { status: "posted", remoteId: id, url: `https://x.com/i/status/${id}` };
  }

  return {
    platform: "x",

    plan(_d, post): PlannedRequest[] {
      const text = textFor(post, "x");
      const bad = problem(post, text);
      if (bad) return [{ method: "POST", url: TWEETS, body: { refused: bad } }];
      return [
        ...post.media.map((m): PlannedRequest => ({ method: "POST", url: UPLOAD, body: { media: `<bytes of ${m.id}>`, media_category: "tweet_image" } })),
        { method: "POST", url: TWEETS, body: { text, ...(post.media.length ? { media_ids: post.media.map((_, i) => `<media id ${i + 1}>`).join(",") } : {}) } },
      ];
    },

    async start(_d, post): Promise<Step> {
      const text = textFor(post, "x").trim();
      const bad = problem(post, text);
      if (bad) return { status: "failed", error: bad };
      const files = await Promise.all(post.media.map((m) => readMedia(m)));
      const big = files.findIndex((f) => f.byteLength > IMAGE_MAX_BYTES);
      if (big >= 0) return { status: "failed", error: `image ${big + 1} is ${(files[big].byteLength / 1048576).toFixed(1)} MB; X takes 5 MB` };
      const { k, step } = await creds();
      if (!k) return step!;
      if (!post.media.length) return tweet(k, text, []);

      const ids: string[] = [];
      for (const [i, m] of post.media.entries()) {
        const form = new FormData();
        form.append("media", new Blob([new Uint8Array(files[i])], { type: m.mime }), `${m.id}`);
        form.append("media_category", "tweet_image");
        const res = await fetch(UPLOAD, {
          method: "POST",
          headers: { Authorization: oauthHeader("POST", UPLOAD, k) },
          body: form,
          cache: "no-store",
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) return httpStep(res.status, `upload: ${await xMessage(res)}`);
        const j = (await res.json().catch(() => ({}))) as { data?: { id?: string; processing_info?: { state?: string } } };
        if (!j.data?.id) return { status: "retry", error: "X upload returned no media id" };
        if (j.data.processing_info?.state === "failed") return { status: "retry", containerId: null, error: "X could not process the image" };
        ids.push(j.data.id);
      }
      return { status: "working", containerId: ids.join(","), retryInS: 1 };
    },

    async poll(d, post): Promise<Step> {
      if (!d.containerId) return { status: "retry", containerId: null, error: "no uploaded image to post" };
      const text = textFor(post, "x").trim();
      const bad = problem(post, text);
      if (bad) return { status: "failed", error: bad };
      const { k, step } = await creds();
      if (!k) return step!;
      return tweet(k, text, d.containerId.split(","));
    },
  };
}
