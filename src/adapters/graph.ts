/** One call to a Meta Graph API host (Instagram and Threads share it). */

import type { Step } from "../core/adapter";
import { httpStep } from "./util";

/** The one place the Graph API version lives. Bump it only after reading Meta's changelog. */
export const META_GRAPH_VERSION = "v25.0";
export const META_GRAPH = `https://graph.facebook.com/${META_GRAPH_VERSION}`;
/** Threads has its own host and versioning. */
export const THREADS_GRAPH = "https://graph.threads.com/v1.0";

interface GraphError { message?: string; code?: number; is_transient?: boolean }

/** Meta error codes that mean "try later": unknown, service, rate limits, temporary block. */
const TRANSIENT_CODES = new Set([1, 2, 4, 17, 32, 341, 613]);

export type GraphResult<T> = { ok: true; json: T } | { ok: false; step: Step };

export async function graph<T>(
  name: string, base: string, method: "GET" | "POST", path: string, token: string, body?: Record<string, string>,
): Promise<GraphResult<T>> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: body ? new URLSearchParams(body).toString() : undefined,
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as T & { error?: GraphError };
  if (res.ok && !j.error) return { ok: true, json: j };
  const e = j.error ?? {};
  const message = `${name} ${res.status}${e.code ? ` (${e.code})` : ""}: ${e.message ?? "no message"}`.replaceAll(token, "[token]");
  const transient = e.is_transient || (e.code !== undefined && TRANSIENT_CODES.has(e.code));
  return { ok: false, step: transient ? { status: "retry", error: message.slice(0, 300) } : httpStep(res.status, message) };
}
