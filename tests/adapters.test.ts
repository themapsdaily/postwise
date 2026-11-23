import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { memoryAccounts } from "../src/core/accounts";
import { mediaUrl } from "../src/core/media";
import type { Delivery, Media, Post } from "../src/core/types";
import { PLATFORMS } from "../src/core/types";
import { allAdapters, buildAdapters } from "../src/adapters";
import { linkFacets } from "../src/adapters/bluesky";
import { xLength } from "../src/adapters/xText";
import { GET } from "../src/app/media/[file]/route";

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, "../fixtures/post.json"), "utf8")) as Post;
const delivery = (platform: Delivery["platform"], over: Partial<Delivery> = {}): Delivery => ({
  id: "d1", postId: "p1", platform, status: "queued", attempts: 0, containerId: null, remoteId: null, url: null,
  error: null, retryAt: null, publishedAt: null, updatedAt: "", ...over,
});

const SECRETS = {
  instagram: { accessToken: "SECRET-IG-TOKEN", igUserId: "SECRET-IG-USER" },
  threads: { accessToken: "SECRET-THREADS-TOKEN", userId: "SECRET-THREADS-USER" },
  x: { consumerKey: "SECRET-CK", consumerSecret: "SECRET-CS", accessToken: "SECRET-AT", accessTokenSecret: "SECRET-ATS" },
  bluesky: { identifier: "secret-id.example.com", appPassword: "SECRET-APP-PASSWORD" },
  mastodon: { instance: "secret-instance.example", accessToken: "SECRET-MASTODON-TOKEN" },
};

/** Run `fn` with env vars set, then put them back. */
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T> | T): Promise<T> {
  const old: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) { old[k] = process.env[k]; if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; }
  try { return await fn(); } finally {
    for (const k of Object.keys(env)) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; }
  }
}

async function withFetch<T>(stub: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = stub;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test("plan() for every adapter never contains a credential", async () => {
  await withEnv({ PUBLIC_URL: "https://pw.example" }, () => {
    const adapters = allAdapters(memoryAccounts(SECRETS));
    for (const p of PLATFORMS) {
      const plan = JSON.stringify(adapters[p].plan(delivery(p), fixture));
      assert.ok(plan.length > 50, `${p} plan is empty`);
      for (const v of Object.values(SECRETS).flatMap((c) => Object.values(c))) assert.ok(!plan.includes(v), `${p} plan leaks ${v}`);
    }
  });
});

test("buildAdapters returns only platforms with an account", async () => {
  const a = await buildAdapters(memoryAccounts({ bluesky: SECRETS.bluesky, x: SECRETS.x }));
  assert.deepEqual(Object.keys(a).sort(), ["bluesky", "x"]);
});

test("bluesky link facets use UTF-8 byte offsets, not string indexes", () => {
  const text = "chart 📊 é https://example.com/a, ok";
  const [f] = linkFacets(text);
  const bytes = Buffer.from(text, "utf8");
  assert.equal(bytes.subarray(f.index.byteStart, f.index.byteEnd).toString("utf8"), "https://example.com/a");
  assert.equal(f.features[0].uri, "https://example.com/a");
  assert.equal(f.index.byteStart, Buffer.byteLength("chart 📊 é ", "utf8"));
  assert.notEqual(f.index.byteStart, text.indexOf("https"));
});

test("x counts a link as 23 and an emoji as 2", () => {
  assert.equal(xLength("hi https://example.com/very/long/path/that/goes/on"), 3 + 23);
  assert.equal(xLength("📊"), 2);
});

test("bluesky: 301 graphemes fails before any network call", async () => {
  const adapters = allAdapters(memoryAccounts(SECRETS));
  const post: Post = { ...fixture, media: [], caption: "a".repeat(301) };
  const step = await withFetch((async () => { throw new Error("network used"); }) as unknown as typeof fetch, () => adapters.bluesky.start(delivery("bluesky"), post));
  assert.equal(step.status, "failed");
  assert.match(step.error!, /301/);
  // 300 graphemes made of multi-codepoint emoji is allowed by the length check.
  const ok: Post = { ...fixture, media: [], caption: "👨‍👩‍👧".repeat(300) };
  const okStep = await withFetch((async () => { throw new Error("network used"); }) as unknown as typeof fetch, () => adapters.bluesky.start(delivery("bluesky"), ok));
  assert.equal(okStep.status, "working"); // start never touches the network; poll posts
});

test("mastodon: 202 upload -> working, poll until url -> posted with the delivery id as Idempotency-Key", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postwise-"));
  fs.mkdirSync(path.join(dir, "media"));
  const m: Media = fixture.media[0];
  fs.writeFileSync(path.join(dir, m.path), Buffer.from("fake-jpeg"));
  const calls: { url: string; method: string; key?: string | null }[] = [];
  let mediaChecks = 0;
  const stub = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    calls.push({ url, method, key: new Headers(init.headers).get("idempotency-key") });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    if (url.endsWith("/api/v2/media")) return json({ id: "m1", url: null }, 202);
    if (url.endsWith("/api/v1/media/m1")) return ++mediaChecks === 1 ? json({ id: "m1", url: null }, 206) : json({ id: "m1", url: "https://cdn/x.jpg" });
    if (url.endsWith("/api/v1/statuses")) return json({ id: "s1", url: "https://masto.example/@me/s1" });
    throw new Error(`unexpected ${url}`);
  }) as unknown as typeof fetch;

  await withEnv({ DATA_DIR: dir }, async () => withFetch(stub, async () => {
    const a = allAdapters(memoryAccounts({ mastodon: { instance: "masto.example/", accessToken: "t" } })).mastodon;
    const post: Post = { ...fixture, caption: "hello" };
    const s1 = await a.start(delivery("mastodon"), post);
    assert.equal(s1.status, "working");
    assert.equal(s1.containerId, "m1");
    assert.ok(calls[0].url.startsWith("https://masto.example/api/v2/media"));
    const s2 = await a.poll(delivery("mastodon", { status: "working", containerId: "m1" }), post);
    assert.equal(s2.status, "working");
    const s3 = await a.poll(delivery("mastodon", { status: "working", containerId: "m1" }), post);
    assert.equal(s3.status, "posted");
    assert.equal(s3.url, "https://masto.example/@me/s1");
    assert.equal(calls.at(-1)!.key, "d1");
  }));
});

test("mastodon: 429 retries, 422 fails", async () => {
  const a = allAdapters(memoryAccounts({ mastodon: { instance: "masto.example", accessToken: "t" } })).mastodon;
  const post: Post = { ...fixture, media: [], caption: "hello" };
  for (const [status, want] of [[429, "retry"], [503, "retry"], [422, "failed"], [401, "failed"]] as const) {
    const stub = (async () => new Response(JSON.stringify({ error: "nope" }), { status })) as unknown as typeof fetch;
    const s = await withFetch(stub, () => a.start(delivery("mastodon"), post));
    assert.equal(s.status, want, `status ${status}`);
  }
});

test("mediaUrl needs PUBLIC_URL", async () => {
  const m = fixture.media[0];
  await withEnv({ PUBLIC_URL: undefined }, () => {
    assert.throws(() => mediaUrl(m), { message: "PUBLIC_URL needed: Instagram and Threads fetch media from a public URL" });
  });
  await withEnv({ PUBLIC_URL: "https://pw.example/" }, () => {
    assert.equal(mediaUrl(m), `https://pw.example/media/${m.id}.jpg`);
  });
});

test("media route: rejects traversal, serves a stored file", async () => {
  const ask = (file: string) => GET(new Request("http://x/media/" + file), { params: Promise.resolve({ file }) });
  assert.equal((await ask("../x.png")).status, 404);
  assert.equal((await ask("..%2Fx.png")).status, 404);
  assert.equal((await ask("not-a-uuid.png")).status, 404);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postwise-"));
  fs.mkdirSync(path.join(dir, "media"));
  const name = fixture.media[0].id + ".png";
  fs.writeFileSync(path.join(dir, "media", name), "png");
  await withEnv({ DATA_DIR: dir }, async () => {
    const r = await ask(name);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "image/png");
    assert.match(r.headers.get("cache-control")!, /immutable/);
  });
  assert.equal((await ask(fixture.media[0].id + ".jpg")).status, 404);
});

test("sqlite store keeps accounts", async () => {
  const { openStore } = await import("../src/store/sqlite");
  const s = openStore(":memory:");
  assert.equal(await s.getAccount("x"), null);
  await s.setAccount("x", { a: "1" }, "2027-01-01T00:00:00Z");
  await s.setAccount("x", { a: "2" });
  const a = await s.getAccount("x");
  assert.deepEqual(a?.credentials, { a: "2" });
  assert.equal((await s.listAccounts()).length, 1);
  s.close();
});

test("bluesky: TID shape; a lost-response retry finds the record instead of posting twice", async () => {
  const { newTid, TID, createBlueskyAdapter } = await import("../src/adapters/bluesky");
  const tid = newTid();
  assert.match(tid, TID);
  assert.ok(newTid(BigInt(2e15)) > newTid(BigInt(1e15)), "TIDs sort by time");
  const { memoryAccounts } = await import("../src/core/accounts");
  const accounts = memoryAccounts({ bluesky: { identifier: "me.test", appPassword: "pw-secret" } });
  const a = createBlueskyAdapter(accounts);
  const post = { id: "p", status: "posting", caption: "hello", perPlatform: {}, platforms: ["bluesky"], media: [], slotAt: null, source: "manual", meta: {}, createdAt: "", updatedAt: "" } as never;
  const s = await a.start({} as never, post);
  assert.equal(s.status, "working");
  const calls: string[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url).split("/xrpc/")[1].split("?")[0]);
    if (String(url).includes("createSession")) return new Response(JSON.stringify({ accessJwt: "j", did: "did:plc:x", handle: "me.test" }));
    if (String(url).includes("getRecord")) return new Response(JSON.stringify({ uri: `at://did:plc:x/app.bsky.feed.post/${s.containerId}` }));
    throw new Error("must not post again");
  }) as typeof fetch;
  try {
    const r = await a.poll({ containerId: s.containerId } as never, post);
    assert.equal(r.status, "posted");
    assert.deepEqual(calls, ["com.atproto.server.createSession", "com.atproto.repo.getRecord"]);
  } finally {
    globalThis.fetch = realFetch;
  }
});
