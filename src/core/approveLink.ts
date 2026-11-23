/**
 * Signed one-tap approval links for the review email. Server-only.
 *
 *   token = base64url("<postId>|<slotAt>|<exp>") + "." + base64url(HMAC-SHA256)
 *
 * keyed by APP_SECRET, valid for 72 hours. The link only opens the confirm
 * page (/approve), which writes nothing; the slot is booked by that page's
 * POST, because mail scanners open every link in an email.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const APPROVE_TTL_MS = 72 * 60 * 60 * 1000;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export interface Approval {
  postId: string;
  /** UTC ISO instant of the slot to book. */
  slotAt: string;
  /** Expiry, ms since epoch. */
  exp: number;
}

export type VerifyResult = { ok: true; approval: Approval } | { ok: false; reason: "malformed" | "signature" | "expired" | "unconfigured" };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest();

function secretOf(secret?: string): string {
  const s = secret ?? process.env.APP_SECRET ?? "";
  return s.length >= 32 ? s : "";
}

export const approveConfigured = (secret?: string) => !!secretOf(secret);

/** A token for booking `postId` at `slotAt`, valid 72 h from `now`. */
export function signApproval(postId: string, slotAt: string, now = Date.now(), secret?: string): string {
  const key = secretOf(secret);
  if (!key) throw new Error("APP_SECRET is not set (32+ characters)");
  if (!ID.test(postId) || !ISO.test(slotAt)) throw new Error("bad approval fields");
  const body = b64u(`${postId}|${slotAt}|${now + APPROVE_TTL_MS}`);
  return `${body}.${b64u(mac(key, body))}`;
}

/** Check a token's signature and expiry. Never throws. */
export function verifyApproval(token: string | null | undefined, now = Date.now(), secret?: string): VerifyResult {
  const key = secretOf(secret);
  if (!key) return { ok: false, reason: "unconfigured" };
  const m = /^([A-Za-z0-9_-]{8,400})\.([A-Za-z0-9_-]{43})$/.exec(token ?? "");
  if (!m) return { ok: false, reason: "malformed" };
  const want = mac(key, m[1]);
  const got = Buffer.from(m[2], "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "signature" };
  const [postId, slotAt, expS, extra] = Buffer.from(m[1], "base64url").toString("utf8").split("|");
  const exp = Number(expS);
  if (extra !== undefined || !ID.test(postId ?? "") || !ISO.test(slotAt ?? "") || !Number.isFinite(exp)) {
    return { ok: false, reason: "malformed" };
  }
  if (now > exp) return { ok: false, reason: "expired" };
  return { ok: true, approval: { postId, slotAt, exp } };
}

/** The public link for a token. */
export function approveUrl(token: string, origin = process.env.PUBLIC_URL ?? ""): string {
  if (!origin) throw new Error("PUBLIC_URL is not set");
  return `${origin.replace(/\/$/, "")}/approve?t=${encodeURIComponent(token)}`;
}
