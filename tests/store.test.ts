import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openStore } from "../src/store/sqlite";
import { zonedToUtc } from "../src/core/slots";
import { runTick } from "../src/core/engine";
import { loadScriptSources } from "../src/sources";
import type { Adapter } from "../src/core/adapter";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "postwise-"));
const approved = { source: "manual", status: "approved" as const, platforms: ["bluesky" as const] };

test("two stores on one file never claim the same post", async () => {
  const f = path.join(tmp(), "db.sqlite");
  const a = openStore(f), b = openStore(f);
  for (let i = 0; i < 5; i++) await a.createPost({ ...approved, caption: `p${i}`, at: "2026-11-24T00:00:00Z" });
  const now = new Date("2026-11-24T01:00:00Z");
  const [x, y] = await Promise.all([a.claim(now), b.claim(now)]);
  const ids = [...x, ...y].map((p) => p.id);
  assert.equal(ids.length, 5);
  assert.equal(new Set(ids).size, 5);
  assert.ok([...x, ...y].every((p) => p.status === "posting"));
  a.close(); b.close();
});

test("Europe/London slot claimed at 08:00Z on the BST day, once", async () => {
  const s = openStore(path.join(tmp(), "db.sqlite"));
  const at = zonedToUtc("2026-03-29", "09:00", "Europe/London");
  await s.createPost({ ...approved, caption: "x", at });
  assert.equal((await s.claim(new Date("2026-03-29T07:59:00Z"))).length, 0);
  assert.equal((await s.claim(new Date("2026-03-29T08:00:00Z"))).length, 1);
  assert.equal((await s.claim(new Date("2026-03-29T08:01:00Z"))).length, 0);
  s.close();
});

test("Asia/Kolkata 09:00 slot claimed at 03:30Z not 03:29Z", async () => {
  const s = openStore(path.join(tmp(), "db.sqlite"));
  await s.createPost({ ...approved, caption: "x", at: zonedToUtc("2026-11-24", "09:00", "Asia/Kolkata") });
  assert.equal((await s.claim(new Date("2026-11-24T03:29:00Z"))).length, 0);
  assert.equal((await s.claim(new Date("2026-11-24T03:30:00Z"))).length, 1);
  s.close();
});

test("create/list/get round trip and delete cascades deliveries", async () => {
  const s = openStore(path.join(tmp(), "db.sqlite"));
  const media = [{ id: "m1", kind: "image" as const, path: "media/m1.png", mime: "image/png", alt: "a" }];
  const p = await s.createPost({ source: "t", caption: "hello", platforms: ["x", "bluesky"], perPlatform: { x: "short" }, media, meta: { k: [1] } });
  assert.equal(p.status, "needs_approval");
  assert.equal(p.slotAt, null);
  assert.deepEqual(await s.getPost(p.id), p);
  assert.deepEqual(p.media, media);
  assert.deepEqual(p.perPlatform, { x: "short" });
  const bare = await s.createPost({ source: "t", caption: "bare" });
  assert.deepEqual([bare.platforms, bare.perPlatform, bare.meta], [[], {}, {}]);
  const late = await s.createPost({ source: "t", caption: "late", at: "2026-12-02T10:00:00+00:00" });
  assert.equal(late.slotAt, "2026-12-02T10:00:00.000Z");
  const list = await s.listPosts();
  assert.equal(list[0].id, late.id); // slotted first, NULLS LAST
  assert.equal((await s.listPosts({ status: ["approved"] })).length, 0);
  assert.equal((await s.listPosts({ from: "2026-12-02T00:00:00Z", to: "2026-12-03T00:00:00Z" })).length, 1);
  assert.equal((await s.listPosts({ limit: 1 })).length, 1);
  await s.createDeliveries([{ postId: p.id, platform: "x" }]);
  assert.equal((await s.deliveriesFor([p.id])).length, 1);
  await s.deletePost(p.id);
  assert.equal((await s.deliveriesFor([p.id])).length, 0);
  s.setSourceRun("src", "2026-11-24T00:00:00.000Z", null);
  assert.equal(s.getSourceRun("src")?.lastRunAt, "2026-11-24T00:00:00.000Z");
  s.close();
});

test("runTick on SQLite posts a due post", async () => {
  const s = openStore(path.join(tmp(), "db.sqlite"));
  const p = await s.createPost({ ...approved, caption: "go", at: "2026-11-24T00:00:00Z" });
  const adapter: Adapter = {
    platform: "bluesky", plan: () => [],
    start: async () => ({ status: "posted", remoteId: "r1", url: "https://b/1" }),
    poll: async () => ({ status: "posted", remoteId: "r1", url: "https://b/1" }),
  };
  await runTick(new Date("2026-11-24T01:00:00Z"), { store: s, adapters: { bluesky: adapter }, sleep: async () => {} });
  assert.equal((await s.getPost(p.id)).status, "posted");
  const [d] = await s.deliveriesFor([p.id]);
  assert.equal(d.status, "posted");
  assert.equal(d.url, "https://b/1");
  s.close();
});

test("loadScriptSources runs commands and rejects bad output", async () => {
  const f = path.join(tmp(), "sources.yaml");
  fs.writeFileSync(f, `
- id: ok
  schedule: "0 8 * * *"
  command: node -e "console.log(JSON.stringify([{caption:'hi'}]))"
- id: bad
  schedule: "0 8 * * *"
  command: echo not json
`);
  const [ok, bad] = loadScriptSources(f);
  const ctx = { now: new Date(), log: () => {}, lastRunAt: null };
  assert.deepEqual(await ok.run(ctx), [{ caption: "hi" }]);
  await assert.rejects(() => bad.run(ctx), /not JSON/);
  assert.deepEqual(loadScriptSources(path.join(tmp(), "none.yaml")), []);
});

test("script env: no app secrets, SINCE passed through", async () => {
  const { scriptEnv } = await import("../src/sources");
  process.env.APP_SECRET = "s".repeat(40); process.env.ADMIN_PASSWORD = "pw"; process.env.WEBHOOK_TOKEN = "t"; process.env.SMTP_URL = "smtps://a:b@c";
  const env = scriptEnv({ SINCE: "2026-11-24T00:00:00.000Z" });
  for (const k of ["APP_SECRET", "ADMIN_PASSWORD", "WEBHOOK_TOKEN", "SMTP_URL"]) assert.equal(env[k], undefined, k);
  assert.equal(env.SINCE, "2026-11-24T00:00:00.000Z");
  assert.ok(env.PATH);
});

test("threads: the check counts emoji the way the adapter does", async () => {
  const { countFor } = await import("../src/checks/length");
  const { threadsLength } = await import("../src/adapters/threads");
  const text = "a".repeat(490) + "😀😀"; // 490 + 2x4 bytes = 498
  assert.equal(countFor("threads", text), threadsLength(text));
  assert.equal(countFor("threads", "a".repeat(495) + "😀😀"), 503);
});
