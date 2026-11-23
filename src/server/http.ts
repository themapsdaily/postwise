/** Small helpers the route handlers share: JSON in, JSON out, errors as `{error}`. */

import type { z } from "zod";

export const json = (data: unknown, status = 200) => Response.json(data, { status });

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  Response.json({ error, ...extra }, { status });

const describe = (e: z.ZodError) =>
  e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message)).join("; ");

export type Parsed<T> = { ok: true; data: T } | { ok: false; res: Response };

export async function readJson<T>(req: Request, schema: z.ZodType<T>): Promise<Parsed<T>> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { ok: false, res: fail(400, "Body must be JSON") }; }
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, res: fail(400, describe(r.error)) };
}

export function parseWith<T>(schema: z.ZodType<T>, raw: unknown): Parsed<T> {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, data: r.data } : { ok: false, res: fail(400, describe(r.error)) };
}

/** Wrap a handler so an unexpected throw is a logged 500, not a stack trace to the client. */
export async function guard(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    console.error("route error:", e);
    return fail(500, "Internal error");
  }
}
