import { test } from "node:test";
import assert from "node:assert/strict";
import { zonedToUtc, localParts, nextSlots, parseTypedSlot, isDue } from "../src/core/slots";
import { runTick, RETRY_MINUTES } from "../src/core/engine";
import type { Adapter, Step } from "../src/core/adapter";
import type { EngineStore } from "../src/core/store";
import type { Delivery, Post } from "../src/core/types";
import { signApproval, verifyApproval } from "../src/core/approveLink";

test("IST 09:00 is 03:30 UTC", () => {
  assert.equal(zonedToUtc("2026-11-24", "09:00", "Asia/Kolkata"), "2026-11-24T03:30:00.000Z");
});

test("London across the DST change", () => {
  assert.equal(zonedToUtc("2026-03-28", "09:00", "Europe/London"), "2026-03-28T09:00:00.000Z"); // GMT
  assert.equal(zonedToUtc("2026-03-29", "09:00", "Europe/London"), "2026-03-29T08:00:00.000Z"); // BST
  assert.equal(localParts("2026-03-29T08:00:00.000Z", "Europe/London").time, "09:00");
  // Skipped hour lands after the jump; repeated hour takes the first.
  assert.equal(localParts(zonedToUtc("2026-03-29", "01:30", "Europe/London"), "Europe/London").time, "02:30");
  assert.equal(zonedToUtc("2026-10-25", "01:30", "Europe/London"), "2026-10-25T00:30:00.000Z");
});

test("nextSlots skips taken and too-near slots", () => {
  const cfg = { tz: "Asia/Kolkata", times: ["09:00", "18:00"], minLeadMinutes: 20 };
  const now = new Date("2026-11-24T03:15:00Z"); // 08:45 IST, 09:00 is 15 min out
  const taken = new Set(["2026-11-24T12:30:00.000Z"]); // 18:00 IST today
  const s = nextSlots(cfg, 2, taken, now);
  assert.deepEqual(s.map((x) => `${x.date} ${x.time}`), ["2026-11-25 09:00", "2026-11-25 18:00"]);
});

test("parseTypedSlot rolls a past time to tomorrow", () => {
  const now = new Date("2026-11-24T12:00:00Z"); // 17:30 IST
  assert.equal(parseTypedSlot("9am", "Asia/Kolkata", now), "2026-11-25T03:30:00.000Z");
  assert.equal(parseTypedSlot("6pm", "Asia/Kolkata", now), "2026-11-24T12:30:00.000Z");
  assert.equal(parseTypedSlot("8", "Asia/Kolkata", now), null);
  assert.equal(isDue({ slotAt: "2026-11-24T11:00:00Z" }, now), true);
  assert.equal(isDue({ slotAt: null }, now), false);
});

test("approval link round trip, tamper and expiry", () => {
  const secret = "x".repeat(32);
  const t = signApproval("p1", "2026-11-25T03:30:00.000Z", 0, secret);
  const ok = verifyApproval(t, 1000, secret);
  assert.ok(ok.ok && ok.approval.postId === "p1");
  assert.equal(verifyApproval(t.slice(0, -2) + "AA", 1000, secret).ok, false);
  assert.deepEqual(verifyApproval(t, 73 * 3600e3, secret), { ok: false, reason: "expired" });
});

// ---- engine with an in-memory store ----
function memStore(posts: Post[]) {
  const P = new Map(posts.map((p) => [p.id, p]));
  const D = new Map<string, Delivery>();
  let n = 0;
  const store: EngineStore = {
    async duePosts(now) { return [...P.values()].filter((p) => p.status === "approved" && isDue(p, now)); },
    async claim(now) {
      const due = [...P.values()].filter((p) => p.status === "approved" && isDue(p, now));
      due.forEach((p) => (p.status = "posting"));
      return due;
    },
    async getPost(id) { return P.get(id)!; },
    async updatePost(id, patch) { return Object.assign(P.get(id)!, patch); },
    async deliveriesFor(ids) { return [...D.values()].filter((d) => ids.includes(d.postId)); },
    async openDeliveries() { return [...D.values()].filter((d) => d.status === "queued" || d.status === "working"); },
    async createDeliveries(rows) {
      return rows.map((r) => {
        const d: Delivery = { id: `d${++n}`, ...r, status: "queued", attempts: 0, containerId: null, remoteId: null, url: null, error: null, retryAt: null, publishedAt: null, updatedAt: "" };
        D.set(d.id, d);
        return { ...d };
      });
    },
    async updateDelivery(id, patch) { return Object.assign(D.get(id)!, patch); },
  };
  return { store, P, D };
}

const post = (over: Partial<Post> = {}): Post => ({
  id: "p1", status: "approved", caption: "hi", perPlatform: {}, platforms: ["bluesky", "mastodon"], media: [],
  slotAt: "2026-11-24T00:00:00Z", source: "manual", meta: {}, createdAt: "", updatedAt: "", ...over,
});
const fixed = (step: Step): Adapter => ({ platform: "bluesky", plan: () => [], start: async () => step, poll: async () => step });

test("engine: one platform posts, one fails after retries -> post posted", async () => {
  const { store, P, D } = memStore([post()]);
  const adapters = { bluesky: fixed({ status: "posted", remoteId: "b1", url: "https://b/1" }), mastodon: fixed({ status: "retry", error: "503" }) };
  let now = new Date("2026-11-24T01:00:00Z");
  const r = await runTick(now, { store, adapters, sleep: async () => {} });
  assert.deepEqual(r.claimed, ["p1"]);
  assert.equal(P.get("p1")!.status, "posted");
  for (const m of RETRY_MINUTES) { now = new Date(now.getTime() + m * 60e3); await runTick(now, { store, adapters, sleep: async () => {} }); }
  const rows = [...D.values()];
  assert.equal(rows.find((d) => d.platform === "mastodon")!.status, "failed");
  assert.equal(rows.find((d) => d.platform === "bluesky")!.status, "posted");
});

test("engine: every platform fails -> post failed; unknown platform skipped", async () => {
  const { store, P } = memStore([post({ platforms: ["bluesky", "x"] })]);
  await runTick(new Date("2026-11-24T01:00:00Z"), { store, adapters: { bluesky: fixed({ status: "failed", error: "bad token" }) }, sleep: async () => {} });
  assert.equal(P.get("p1")!.status, "failed");
});

test("engine: dry run writes nothing", async () => {
  const { store, P, D } = memStore([post()]);
  const r = await runTick(new Date("2026-11-24T01:00:00Z"), { store, adapters: {}, dryRun: true });
  assert.equal(P.get("p1")!.status, "approved");
  assert.equal(D.size, 0);
  assert.equal(r.previews!.length, 2);
});
