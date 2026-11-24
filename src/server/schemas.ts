/** Request-body schemas and the media validation the post routes share. */

import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PLATFORMS, type Media, type Platform } from "../core/types";
import { EXT_MIME } from "../store/media";
import { dataDir } from "./store";

export const platformSchema = z.enum(PLATFORMS);
export const isoSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "Not a date").transform((s) => new Date(s).toISOString());

const MEDIA_PATH = /^media\/([0-9a-f-]{36})\.(jpg|png|gif|webp|mp4|mov|webm)$/;

/** What the client sends back for a media item it got from POST /api/media. */
export const mediaSchema = z.object({
  id: z.string(),
  path: z.string(),
  alt: z.string().max(1500).optional(),
}).loose();

/** Check each item names a file we stored, and rebuild it from the file name rather than trusting the client's kind/mime. */
export function resolveMedia(items: z.infer<typeof mediaSchema>[]): { ok: true; media: Media[] } | { ok: false; error: string } {
  const out: Media[] = [];
  for (const m of items) {
    const hit = MEDIA_PATH.exec(m.path);
    if (!hit || hit[1] !== m.id) return { ok: false, error: `Bad media reference: ${m.id}` };
    if (!fs.existsSync(path.join(dataDir(), m.path))) return { ok: false, error: `Media file not found: ${m.id}` };
    const mime = EXT_MIME[hit[2]];
    out.push({ id: m.id, kind: mime.startsWith("image/") ? "image" : "video", path: m.path, mime, ...(m.alt ? { alt: m.alt } : {}) });
  }
  return { ok: true, media: out };
}

const perPlatform = z.partialRecord(platformSchema, z.string().max(10000));

export const createPostSchema = z.object({
  caption: z.string().max(10000).default(""),
  platforms: z.array(platformSchema).default([]).transform((a) => [...new Set(a)]),
  perPlatform: perPlatform.default({}),
  slotAt: isoSchema.nullable().optional(),
  media: z.array(mediaSchema).max(20).default([]),
});

export const patchPostSchema = z.object({
  caption: z.string().max(10000),
  platforms: z.array(platformSchema).transform((a) => [...new Set(a)]),
  perPlatform,
  slotAt: isoSchema.nullable(),
  media: z.array(mediaSchema).max(20),
}).partial().strict();

export const approveBodySchema = z.object({ slotAt: isoSchema.optional() }).strict();

export const draftInputSchema = z.object({
  caption: z.string().max(10000),
  platforms: z.array(platformSchema).optional(),
  perPlatform: perPlatform.optional(),
  media: z.array(z.object({ src: z.string().min(1).max(2000), alt: z.string().max(1500).optional() })).max(20).optional(),
  at: isoSchema.optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  key: z.string().min(1).max(200).optional(),
});
export const draftsBodySchema = z.union([draftInputSchema, z.array(draftInputSchema).min(1).max(50)]);

const secret = z.string().trim().min(1).max(4000);
const optSecret = z.string().trim().max(4000).optional().transform((v) => v || undefined);
const expires = isoSchema.optional();

/** The credentials each adapter reads (see the header of src/adapters/<platform>.ts). */
export const credentialSchemas: Record<Platform, z.ZodType<Record<string, string | undefined>>> = {
  instagram: z.strictObject({ accessToken: secret, igUserId: secret, expiresAt: expires }),
  threads: z.strictObject({ accessToken: secret, userId: optSecret, expiresAt: expires }),
  x: z.strictObject({ consumerKey: secret, consumerSecret: secret, accessToken: secret, accessTokenSecret: secret }),
  bluesky: z.strictObject({ identifier: secret, appPassword: secret, service: optSecret }),
  mastodon: z.strictObject({ instance: secret, accessToken: secret }),
};
