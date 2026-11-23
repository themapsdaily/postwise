/**
 * Single-user auth. ADMIN_PASSWORD is the password; the session cookie is
 * `base64url({exp}).base64url(HMAC-SHA256(APP_SECRET))`, valid 30 days.
 * Used by the proxy, so nothing here touches the store.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const COOKIE = "postwise_session";
export const SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (body: string) => createHmac("sha256", process.env.APP_SECRET ?? "").update(body).digest();

/** What is missing from the environment, or null when auth can run. */
export function authProblem(): string | null {
  if (!process.env.ADMIN_PASSWORD) return "ADMIN_PASSWORD is not set. Set it in the environment (.env) and restart Postwise.";
  if ((process.env.APP_SECRET ?? "").length < 32) return "APP_SECRET is not set or shorter than 32 characters. Set it in the environment (.env), for example with: openssl rand -hex 32";
  return null;
}

/** Constant-time string compare: both sides are hashed to the same length first. */
export function safeEqual(a: string, b: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(a), h(b));
}

export const passwordMatches = (given: string) => safeEqual(given, process.env.ADMIN_PASSWORD ?? "");

export function signSession(now = Date.now()): string {
  const body = b64u(JSON.stringify({ exp: now + SESSION_MS }));
  return `${body}.${b64u(mac(body))}`;
}

export function verifySession(token: string | null | undefined, now = Date.now()): boolean {
  if (!token || (process.env.APP_SECRET ?? "").length < 32) return false;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return false;
  const want = mac(body);
  const got = Buffer.from(sig, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { exp?: unknown };
    return typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

const isHttps = (req: Request) =>
  new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";

/** Set-Cookie value for a session; an empty value with Max-Age=0 clears it. */
export function sessionCookie(req: Request, value: string | null): string {
  const parts = [`${COOKIE}=${value ?? ""}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${value ? SESSION_MS / 1000 : 0}`];
  if (isHttps(req)) parts.push("Secure");
  return parts.join("; ");
}

/** Paths that need no session: the login flow, public media, approval links, the webhook (bearer token). */
export function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/login" || pathname === "/api/login" ||
    pathname === "/approve" || pathname === "/api/approve" ||
    pathname === "/api/drafts" || pathname === "/favicon.ico" ||
    pathname.startsWith("/media/") || pathname.startsWith("/_next/")
  );
}
