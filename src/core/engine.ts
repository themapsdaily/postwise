/**
 * The publish engine. Server-only. The worker calls `runTick` every minute.
 *
 * One tick:
 *   1. claims every post whose slot has arrived (approved -> posting);
 *   2. gives each one Delivery row per platform;
 *   3. moves every queued or working row one step through its platform adapter.
 *
 * Slow platform processing never holds the tick: a row still processing waits
 * for the next tick. A failed step is retried on its own row 2, 10 and 30
 * minutes later, then the row is `failed`; the other platforms carry on.
 *
 * A post becomes `posted` when its first platform publishes, and `failed`
 * when every row has ended without one publishing.
 *
 * dryRun: claims nothing and writes nothing; returns the requests each adapter
 * would send for every post that is due.
 */

import type { Adapter, PlannedRequest, Step } from "./adapter";
import type { EngineStore } from "./store";
import type { Delivery, Platform, Post } from "./types";

export interface TickDeps {
  store: EngineStore;
  adapters: Partial<Record<Platform, Adapter>>;
  dryRun?: boolean;
  /** Waits between inline polls; tests pass a no-op. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TickChange {
  post: string;
  platform: Platform;
  from: string;
  to: string;
  attempts?: number;
  error?: string;
  url?: string | null;
}

export interface TickReport {
  dryRun: boolean;
  /** Another tick was still running in this process; nothing was done. */
  busy?: boolean;
  claimed: string[];
  changes: TickChange[];
  /** Rows left alone this tick, and why. */
  waiting: { post: string; platform: Platform; reason: string }[];
  /** Dry run only: what each adapter would send. */
  previews?: { post: string; platform: Platform; requests?: PlannedRequest[]; reason?: string }[];
  /** Errors outside any one row (claim failed, store down). */
  errors: string[];
}

/** Minutes to wait after the 1st, 2nd and 3rd failed attempt; the 4th failure is final. */
export const RETRY_MINUTES = [2, 10, 30] as const;
/** An image container is usually ready in seconds: poll it inside the tick this many times. */
const INLINE_POLLS = 3;
const INLINE_POLL_MAX_S = 15;

const at = (now: Date, s: number) => new Date(now.getTime() + s * 1000).toISOString();
const due = (iso: string | null, now: Date) => !iso || Date.parse(iso) <= now.getTime();
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 500);
const OPEN = new Set(["queued", "working"]);

// One tick at a time per process: two overlapping ticks could both see a
// finished container and publish it twice. Across processes, `claim` is atomic.
let running: Promise<TickReport> | null = null;

export async function runTick(now: Date, deps: TickDeps): Promise<TickReport> {
  if (running) return { dryRun: !!deps.dryRun, busy: true, claimed: [], changes: [], waiting: [], errors: [] };
  running = (deps.dryRun ? dryTick(now, deps) : realTick(now, deps)).finally(() => { running = null; });
  return running;
}

async function dryTick(now: Date, { store, adapters }: TickDeps): Promise<TickReport> {
  const report: TickReport = { dryRun: true, claimed: [], changes: [], waiting: [], previews: [], errors: [] };
  for (const p of await store.duePosts(now)) {
    for (const platform of p.platforms) {
      const a = adapters[platform];
      if (!a) { report.previews!.push({ post: p.id, platform, reason: "no adapter for this platform" }); continue; }
      try {
        report.previews!.push({ post: p.id, platform, requests: a.plan(draftRow(p, platform), p) });
      } catch (e) {
        report.previews!.push({ post: p.id, platform, reason: errText(e) });
      }
    }
  }
  return report;
}

/** An unsaved row, as ensureDeliveries would create it. */
function draftRow(p: Post, platform: Platform): Delivery {
  return {
    id: "(dry run)", postId: p.id, platform, status: "queued", attempts: 0,
    containerId: null, remoteId: null, url: null, error: null, retryAt: null, publishedAt: null,
    updatedAt: p.updatedAt,
  };
}

async function realTick(now: Date, deps: TickDeps): Promise<TickReport> {
  const { store } = deps;
  const report: TickReport = { dryRun: false, claimed: [], changes: [], waiting: [], errors: [] };

  try {
    for (const p of await store.claim(now)) {
      report.claimed.push(p.id);
      await ensureDeliveries(p, store);
    }
  } catch (e) {
    report.errors.push(`claim: ${errText(e)}`);
  }

  let open: Delivery[];
  try {
    open = await store.openDeliveries();
  } catch (e) {
    report.errors.push(`deliveries: ${errText(e)}`);
    return report;
  }
  if (!open.length) return report;

  const postIds = [...new Set(open.map((d) => d.postId))];
  const posts = new Map<string, Post>();
  for (const id of postIds) {
    try { posts.set(id, await store.getPost(id)); } catch (e) { report.errors.push(`post ${id}: ${errText(e)}`); }
  }

  for (const d of open) {
    const p = posts.get(d.postId);
    if (!p) continue;
    try {
      await advance(d, p, now, deps, report);
    } catch (e) {
      report.errors.push(`${d.platform} ${d.postId}: ${errText(e)}`);
    }
  }

  // A post whose rows have all ended without one publishing has failed.
  for (const p of posts.values()) {
    if (p.status !== "posting") continue;
    try {
      const rows = await store.deliveriesFor([p.id]);
      if (rows.length && rows.every((r) => !OPEN.has(r.status)) && !rows.some((r) => r.status === "posted")) {
        await store.updatePost(p.id, { status: "failed" });
        p.status = "failed";
      }
    } catch (e) {
      report.errors.push(`settle ${p.id}: ${errText(e)}`);
    }
  }
  return report;
}

/** One row per platform for a claimed post; rows that already exist are kept. */
export async function ensureDeliveries(p: Post, store: EngineStore): Promise<Delivery[]> {
  const have = new Set((await store.deliveriesFor([p.id])).map((d) => d.platform));
  const rows = p.platforms.filter((platform) => !have.has(platform)).map((platform) => ({ postId: p.id, platform }));
  return rows.length ? store.createDeliveries(rows) : [];
}

async function advance(d: Delivery, p: Post, now: Date, deps: TickDeps, report: TickReport) {
  const { store, adapters } = deps;
  const wait = (reason: string) => report.waiting.push({ post: p.id, platform: d.platform, reason });

  // A post taken back out of the queue (unscheduled, deleted) is left alone.
  if (p.status !== "posting" && p.status !== "posted") return wait(`post is ${p.status}`);
  if (!due(d.retryAt, now)) return wait(`next try at ${d.retryAt}`);

  const a = adapters[d.platform];
  if (!a) {
    await store.updateDelivery(d.id, { status: "skipped", error: "no adapter for this platform", retryAt: null });
    report.changes.push({ post: p.id, platform: d.platform, from: d.status, to: "skipped", error: "no adapter for this platform" });
    d.status = "skipped";
    return;
  }

  let step = await call(() => (d.status === "working" && d.containerId ? a.poll(d, p) : a.start(d, p)));
  for (let i = 0; i < INLINE_POLLS && step.status === "working" && (step.retryInS ?? 0) <= INLINE_POLL_MAX_S; i++) {
    await (deps.sleep ?? sleep)((step.retryInS ?? 5) * 1000);
    const polled: Delivery = { ...d, status: "working", containerId: step.containerId ?? d.containerId };
    step = await call(() => a.poll(polled, p));
    if (step.containerId === undefined) step.containerId = polled.containerId;
  }
  await apply(d, p, step, now, store, report);
}

async function call(fn: () => Promise<Step>): Promise<Step> {
  try {
    return await fn();
  } catch (e) {
    // A thrown error (network, timeout) keeps the container: the next attempt polls it again.
    return { status: "retry", error: errText(e) };
  }
}

async function apply(d: Delivery, p: Post, s: Step, now: Date, store: EngineStore, report: TickReport) {
  const from = d.status;
  const change = (to: string, extra: Partial<TickChange> = {}) =>
    report.changes.push({ post: p.id, platform: d.platform, from, to, ...extra });

  if (s.status === "working") {
    const containerId = s.containerId === undefined ? d.containerId : s.containerId;
    await store.updateDelivery(d.id, { status: "working", containerId, error: null, retryAt: at(now, s.retryInS ?? 60) });
    Object.assign(d, { status: "working", containerId });
    if (from !== "working") change("working");
    return;
  }

  if (s.status === "posted") {
    const publishedAt = now.toISOString();
    await store.updateDelivery(d.id, {
      status: "posted", remoteId: s.remoteId ?? null, url: s.url ?? null,
      publishedAt, error: s.error ?? null, retryAt: null,
    });
    Object.assign(d, { status: "posted", remoteId: s.remoteId ?? null });
    change("posted", { url: s.url ?? null, error: s.error });
    if (p.status !== "posted") {
      await store.updatePost(p.id, { status: "posted" });
      p.status = "posted";
    }
    return;
  }

  // retry or failed
  const attempts = d.attempts + 1;
  const final = s.status === "failed" || attempts > RETRY_MINUTES.length;
  const containerId = s.containerId === undefined ? d.containerId : s.containerId;
  const status = final ? "failed" : containerId ? "working" : "queued";
  const retryAt = final ? null : at(now, RETRY_MINUTES[attempts - 1] * 60);
  await store.updateDelivery(d.id, { status, attempts, containerId, error: s.error ?? "unknown error", retryAt });
  Object.assign(d, { status, attempts, containerId });
  change(final ? "failed" : `${status} (retry ${attempts} of ${RETRY_MINUTES.length})`, { attempts, error: s.error });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
