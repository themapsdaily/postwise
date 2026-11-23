import { fail, guard, json } from "../../../server/http";
import { dataDir } from "../../../server/store";
import { MIME_EXT, saveMediaBuffer } from "../../../store/media";

const MAX_BYTES = 50 * 1024 * 1024;

/** The file's real type from its first bytes; the browser's claimed type is not trusted. */
function sniff(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 3).toString("latin1") === "GIF") return "image/gif";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp") return b.subarray(8, 12).toString("latin1").startsWith("qt") ? "video/quicktime" : "video/mp4";
  if (b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return "video/webm";
  return null;
}

export async function POST(req: Request) {
  return guard(async () => {
    if (Number(req.headers.get("content-length") ?? 0) > MAX_BYTES + 1024 * 1024) return fail(413, "Files are limited to 50 MB");
    let form: FormData;
    try { form = await req.formData(); } catch { return fail(400, "Send multipart form data with a `file` field"); }
    const file = form.get("file");
    if (!(file instanceof File)) return fail(400, "Missing `file` field");
    if (file.size > MAX_BYTES) return fail(413, "Files are limited to 50 MB");
    if (!/^(image|video)\//.test(file.type) || !(file.type in MIME_EXT)) return fail(415, "Only JPEG, PNG, GIF, WebP images and MP4, MOV, WebM video");
    const buf = Buffer.from(await file.arrayBuffer());
    const real = sniff(buf);
    if (!real || real.split("/")[0] !== file.type.split("/")[0]) return fail(415, "That file is not a supported image or video");
    return json(await saveMediaBuffer(buf, real, dataDir()), 201);
  });
}
