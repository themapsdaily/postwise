/** Public URLs for stored media: Instagram and Threads fetch images and video from them. */

import path from "node:path";
import type { Media } from "./types";

/** The file extension of a stored media file, without the dot. */
export const mediaExt = (m: Pick<Media, "path">) => path.extname(m.path).slice(1).toLowerCase();

/** `${PUBLIC_URL}/media/<id>.<ext>`; served by src/app/media/[file]/route.ts. */
export function mediaUrl(m: Media): string {
  const base = process.env.PUBLIC_URL?.trim().replace(/\/+$/, "");
  if (!base) throw new Error("PUBLIC_URL needed: Instagram and Threads fetch media from a public URL");
  return `${base}/media/${m.id}.${mediaExt(m)}`;
}
