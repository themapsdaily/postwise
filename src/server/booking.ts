/** Slot booking and approval, shared by the UI routes, the webhook and the email link. */

import { blocks, runChecks, type CheckResult } from "../core/check";
import type { Settings } from "../core/settings";
import { nextSlots, type Slot, type SlotConfig } from "../core/slots";
import type { Post } from "../core/types";
import { checks } from "../checks";
import type { SqliteStore } from "../store/sqlite";

export const slotConfig = (s: Settings): SlotConfig => ({ tz: s.tz, times: s.slotTimes, minLeadMinutes: s.minLeadMinutes });

/** Slots held by posts that are approved or going out. */
export async function takenSlots(store: SqliteStore): Promise<Set<string>> {
  const posts = await store.listPosts({ status: ["approved", "posting"] });
  return new Set(posts.flatMap((p) => (p.slotAt ? [p.slotAt] : [])));
}

export async function freeSlots(store: SqliteStore, count: number, now = new Date()): Promise<Slot[]> {
  return nextSlots(slotConfig(await store.getSettings()), count, await takenSlots(store), now);
}

export const checkPost = (post: Post): CheckResult[] => runChecks(post, checks);

// Booking reads the taken slots and then writes; one at a time so two requests never take the same slot.
let chain: Promise<unknown> = Promise.resolve();
const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
};

export type ApproveResult =
  | { ok: true; post: Post }
  | { ok: false; status: 404 | 409 | 422; error: string; results?: CheckResult[] };

/**
 * draft or needs_approval -> approved, booked at `slotAt` or the next free slot.
 * `requireFree` rejects a slot another post already holds (the email link needs
 * that; the app lets you stack two posts on one time on purpose).
 */
export function approvePost(store: SqliteStore, id: string, opts: { slotAt?: string; requireFree?: boolean } = {}, now = new Date()): Promise<ApproveResult> {
  return exclusive(async () => {
    let post: Post;
    try { post = await store.getPost(id); } catch { return { ok: false, status: 404, error: "Post not found" }; }
    if (post.status !== "draft" && post.status !== "needs_approval") {
      return { ok: false, status: 409, error: `A ${post.status} post cannot be approved` };
    }
    const results = checkPost(post);
    if (blocks(results)) return { ok: false, status: 422, error: "Checks failed", results };

    const taken = await takenSlots(store);
    let slotAt = opts.slotAt;
    if (slotAt) {
      if (Date.parse(slotAt) < now.getTime()) return { ok: false, status: 422, error: "That slot is in the past" };
      if (opts.requireFree && taken.has(slotAt)) return { ok: false, status: 409, error: "That slot is already taken" };
    } else {
      slotAt = nextSlots(slotConfig(await store.getSettings()), 1, taken, now)[0]?.at;
      if (!slotAt) return { ok: false, status: 409, error: "No free slot in the next 60 days: add slot times in Settings" };
    }
    return { ok: true, post: await store.updatePost(id, { status: "approved", slotAt }) };
  });
}
