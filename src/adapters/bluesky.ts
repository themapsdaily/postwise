/**
 * Bluesky (AT Protocol). Credentials: { service?: "https://bsky.social", identifier, appPassword }.
 * start picks a fixed record key; poll: createSession -> accessJwt, getRecord (already posted?), uploadBlob per image (up to 4, each under 976 KB),
 * then createRecord app.bsky.feed.post with link facets and an images embed.
 * Everything that can be checked locally is checked before the first request.
 */

import type { AccountStore } from "../core/accounts";
import { textFor, type Adapter, type PlannedRequest, type Step } from "../core/adapter";
import type { Post } from "../core/types";
import { credentials, httpStep, readMedia } from "./util";

export const BSKY_MAX = 300;
export const BSKY_IMAGE_MAX_BYTES = 976 * 1024;
const IMAGES_MAX = 4;
const DEFAULT_SERVICE = "https://bsky.social";

// A TID record key: 13 base32-sortable chars of (microseconds << 10 | clock id), top bit 0.
const B32 = "234567abcdefghijklmnopqrstuvwxyz";
export const TID = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;
export function newTid(nowUs = BigInt(Date.now()) * BigInt(1000), clockId = BigInt(Math.floor(Math.random() * 1024))): string {
  let n = (nowUs << BigInt(10)) | clockId;
  let out = "";
  for (let i = 0; i < 13; i++) { out = B32[Number(n & BigInt(31))] + out; n >>= BigInt(5); }
  return out;
}

const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
export const graphemeCount = (s: string) => Array.from(segmenter.segment(s)).length;

export interface LinkFacet {
  index: { byteStart: number; byteEnd: number };
  features: { $type: "app.bsky.richtext.facet#link"; uri: string }[];
}

/** A link facet for every http(s) URL, with UTF-8 byte offsets as the protocol requires. */
export function linkFacets(text: string): LinkFacet[] {
  const enc = new TextEncoder();
  const out: LinkFacet[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s]+/gi)) {
    const url = m[0].replace(/[.,;:!?'")\]]+$/, "");
    if (!url) continue;
    const byteStart = enc.encode(text.slice(0, m.index)).length;
    out.push({ index: { byteStart, byteEnd: byteStart + enc.encode(url).length }, features: [{ $type: "app.bsky.richtext.facet#link", uri: url }] });
  }
  return out;
}

const base = (service?: string) => (service?.trim() || DEFAULT_SERVICE).replace(/\/+$/, "");

function problem(post: Post, text: string): string | null {
  if (post.media.some((m) => m.kind === "video")) return "video not supported on Bluesky adapter yet";
  if (post.media.length > IMAGES_MAX) return `Bluesky takes at most ${IMAGES_MAX} images`;
  if (!text.trim() && !post.media.length) return "no text or media for Bluesky";
  const n = graphemeCount(text);
  if (n > BSKY_MAX) return `the Bluesky text is ${n} characters; the limit is ${BSKY_MAX}`;
  return null;
}

export function createBlueskyAdapter(accounts: AccountStore): Adapter {
  return {
    platform: "bluesky",

    plan(_d, post): PlannedRequest[] {
      const text = textFor(post, "bluesky");
      const bad = problem(post, text);
      const host = DEFAULT_SERVICE;
      if (bad) return [{ method: "POST", url: `${host}/xrpc/com.atproto.repo.createRecord`, body: { refused: bad } }];
      return [
        { method: "POST", url: `${host}/xrpc/com.atproto.server.createSession`, body: { identifier: "<identifier>", password: "<app password>" } },
        ...post.media.map((m): PlannedRequest => ({ method: "POST", url: `${host}/xrpc/com.atproto.repo.uploadBlob`, body: { image: `<bytes of ${m.id}>` } })),
        {
          method: "POST", url: `${host}/xrpc/com.atproto.repo.createRecord`,
          body: { repo: "<did>", collection: "app.bsky.feed.post", text, links: String(linkFacets(text).length), images: String(post.media.length) },
        },
      ];
    },

    // start only checks the post and picks the record key; poll does the posting.
    // A fixed key makes retries safe: if a lost response hid a successful post,
    // the next attempt finds the record instead of posting it twice.
    async start(_d, post): Promise<Step> {
      const text = textFor(post, "bluesky").trim();
      const bad = problem(post, text);
      if (bad) return { status: "failed", error: bad };
      const files = await Promise.all(post.media.map((m) => readMedia(m)));
      const big = files.findIndex((f) => f.byteLength > BSKY_IMAGE_MAX_BYTES);
      if (big >= 0) return { status: "failed", error: `image ${big + 1} is ${Math.round(files[big].byteLength / 1024)} KB; Bluesky takes at most 976 KB` };
      return { status: "working", containerId: newTid(), retryInS: 0 };
    },

    async poll(d, post): Promise<Step> {
      const rkey = d.containerId;
      if (!rkey || !TID.test(rkey)) return { status: "retry", containerId: null, error: "no Bluesky record key; starting over" };
      const text = textFor(post, "bluesky").trim();
      const files = await Promise.all(post.media.map((m) => readMedia(m)));
      const { c, step } = await credentials(accounts, "bluesky", ["identifier", "appPassword"]);
      if (!c) return step;

      const host = base(c.service);
      const fail = async (res: Response, what: string): Promise<Step> => {
        const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        return httpStep(res.status, `bluesky ${what} ${res.status}: ${j.message ?? j.error ?? "no message"}`.replaceAll(c.appPassword, "[password]"));
      };

      const sres = await fetch(`${host}/xrpc/com.atproto.server.createSession`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier: c.identifier, password: c.appPassword }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!sres.ok) return fail(sres, "login");
      const session = (await sres.json().catch(() => ({}))) as { accessJwt?: string; did?: string; handle?: string };
      if (!session.accessJwt || !session.did) return { status: "retry", error: "Bluesky login returned no session" };
      const auth = { Authorization: `Bearer ${session.accessJwt}` };
      const posted = (uri: string): Step => ({ status: "posted", remoteId: uri, url: `https://bsky.app/profile/${session.handle ?? c.identifier}/post/${rkey}` });

      // Already posted by an earlier attempt whose response was lost?
      const q = new URLSearchParams({ repo: session.did, collection: "app.bsky.feed.post", rkey });
      const gres = await fetch(`${host}/xrpc/com.atproto.repo.getRecord?${q}`, { headers: auth, signal: AbortSignal.timeout(20_000) });
      if (gres.ok) {
        const g = (await gres.json().catch(() => ({}))) as { uri?: string };
        if (g.uri) return posted(g.uri);
      }

      const images: { alt: string; image: unknown }[] = [];
      for (const [i, m] of post.media.entries()) {
        const ures = await fetch(`${host}/xrpc/com.atproto.repo.uploadBlob`, {
          method: "POST", headers: { ...auth, "content-type": m.mime }, body: new Uint8Array(files[i]),
          signal: AbortSignal.timeout(60_000),
        });
        if (!ures.ok) return fail(ures, "upload");
        const u = (await ures.json().catch(() => ({}))) as { blob?: unknown };
        if (!u.blob) return { status: "retry", error: "Bluesky upload returned no blob" };
        images.push({ alt: m.alt ?? "", image: u.blob });
      }

      const facets = linkFacets(text);
      const record = {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        ...(facets.length ? { facets } : {}),
        ...(images.length ? { embed: { $type: "app.bsky.embed.images", images } } : {}),
      };
      const rres = await fetch(`${host}/xrpc/com.atproto.repo.createRecord`, {
        method: "POST", headers: { ...auth, "content-type": "application/json" },
        body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", rkey, record }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!rres.ok) return fail(rres, "post");
      const r = (await rres.json().catch(() => ({}))) as { uri?: string };
      return posted(r.uri ?? `at://${session.did}/app.bsky.feed.post/${rkey}`);
    },
  };
}
