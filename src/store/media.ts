/** Copy media into the data dir so it can be served at /media/<id> and read by adapters. */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Media } from "../core/types";

const MAX_BYTES = 50 * 1024 * 1024;
const TIMEOUT_MS = 30_000;

export const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};
export const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
  "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
};

/**
 * `allowLocal` lets `src` be a file path. Only trusted callers (the worker
 * running your own scripts) pass it; anything reachable from HTTP, such as the
 * webhook, must not, or a caller could read files off the server.
 */
export async function importMedia(src: string, dataDir: string, opts: { allowLocal?: boolean } = {}): Promise<Media> {
  if (!/^https?:\/\//i.test(src) && !opts.allowLocal) throw new Error(`Media must be an http(s) URL: ${src}`);
  let buf: Buffer;
  let mime: string | undefined;
  const ext = path.extname(src.split(/[?#]/)[0]).slice(1).toLowerCase();

  if (/^https?:\/\//i.test(src)) {
    const res = await fetch(src, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`Fetching ${src} failed: ${res.status}`);
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > MAX_BYTES) throw new Error(`Media is larger than 50 MB: ${src}`);
    // Stream with a running cap: content-length can be missing or wrong.
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = res.body?.getReader();
    if (!reader) throw new Error(`No body from ${src}`);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) { await reader.cancel(); throw new Error(`Media is larger than 50 MB: ${src}`); }
      chunks.push(value);
    }
    buf = Buffer.concat(chunks);
    mime = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  } else {
    const stat = await fs.promises.stat(src);
    if (stat.size > MAX_BYTES) throw new Error(`Media is larger than 50 MB: ${src}`);
    buf = await fs.promises.readFile(src);
  }

  if (!mime || !/^(image|video)\//.test(mime)) mime = EXT_MIME[ext];
  if (!mime || !/^(image|video)\//.test(mime)) throw new Error(`Not an image or video: ${src}`);

  return saveMediaBuffer(buf, mime, dataDir, ext);
}

/** Write bytes to `<dataDir>/media/<uuid>.<ext>` and describe them. `mime` must be image/* or video/*. */
export async function saveMediaBuffer(buf: Buffer, mime: string, dataDir: string, extHint = ""): Promise<Media> {
  if (!/^(image|video)\//.test(mime)) throw new Error("Not an image or video");
  const ext = MIME_EXT[mime] ?? (extHint || mime.split("/")[1]);
  const id = randomUUID();
  const rel = path.join("media", `${id}.${ext}`);
  await fs.promises.mkdir(path.join(dataDir, "media"), { recursive: true });
  await fs.promises.writeFile(path.join(dataDir, rel), buf);
  return { id, kind: mime.startsWith("image/") ? "image" : "video", path: rel, mime };
}
