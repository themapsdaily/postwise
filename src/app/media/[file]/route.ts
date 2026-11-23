/** GET /media/<uuid>.<ext>: serves a stored media file so Instagram and Threads can fetch it. */

import fs from "node:fs";
import path from "node:path";

const NAME = /^[0-9a-f-]{36}\.(jpg|png|gif|webp|mp4|mov|webm)$/;
const TYPES: Record<string, string> = {
  jpg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!NAME.test(file)) return new Response("Not found", { status: 404 });
  const full = path.join(path.resolve(process.env.DATA_DIR ?? "./data"), "media", file);
  let buf: Buffer;
  try {
    buf = await fs.promises.readFile(full);
  } catch {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": TYPES[file.split(".").pop()!],
      "content-length": String(buf.length),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
