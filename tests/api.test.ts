import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { dir } from "./apiEnv"; // first: sets the env the route modules read
import { NextRequest } from "next/server";
import { proxy } from "../src/proxy";
import { COOKIE } from "../src/server/auth";
import { signApproval } from "../src/core/approveLink";
import { getStore } from "../src/server/store";
import * as login from "../src/app/api/login/route";
import * as posts from "../src/app/api/posts/route";
import * as postId from "../src/app/api/posts/[id]/route";
import * as approve from "../src/app/api/posts/[id]/approve/route";
import * as unschedule from "../src/app/api/posts/[id]/unschedule/route";
import * as checksRoute from "../src/app/api/posts/[id]/checks/route";
import * as slots from "../src/app/api/slots/route";
import * as media from "../src/app/api/media/route";
import * as settings from "../src/app/api/settings/route";
import * as accounts from "../src/app/api/accounts/route";
import * as account from "../src/app/api/accounts/[platform]/route";
import * as drafts from "../src/app/api/drafts/route";
import * as approveApi from "../src/app/api/approve/route";
import * as mediaFile from "../src/app/media/[file]/route";
import approvePage from "../src/app/approve/page";

const URL0 = "http://localhost/";
const req = (p: string, init: RequestInit & { json?: unknown } = {}) => {
  const { json, ...rest } = init;
  return new Request(URL0 + p, json === undefined ? rest : { ...rest, method: rest.method ?? "POST", headers: { "content-type": "application/json", ...rest.headers }, body: JSON.stringify(json) });
};
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const store = getStore();
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

async function makePost(body: object) {
  const r = await posts.POST(req("api/posts", { json: body }));
  assert.equal(r.status, 201);
  return (await r.json()) as { id: string; status: string; slotAt: string | null };
}
const pngFile = () => { const f = new FormData(); f.set("file", new File([PNG], "a.png", { type: "image/png" })); return f; };

test("login: wrong password 401, right password sets a hardened cookie", async () => {
  const bad = await login.POST(req("api/login", { json: { password: "nope" } }));
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
  const ok = await login.POST(req("api/login", { json: { password: "correct horse" } }));
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get("set-cookie")!;
  assert.match(cookie, new RegExp(`^${COOKIE}=`));
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.doesNotMatch(cookie, /Secure/);
  const https = await login.POST(new Request("https://x.test/api/login", { method: "POST", body: JSON.stringify({ password: "correct horse" }) }));
  assert.match(https.headers.get("set-cookie")!, /Secure/);
});

test("proxy: protected API 401, page redirects, public paths pass, cookie passes", async () => {
  const n = (p: string, headers: Record<string, string> = {}) => new NextRequest(URL0 + p, { headers });
  const api = proxy(n("api/posts"));
  assert.equal(api.status, 401);
  const page = proxy(n(""));
  assert.equal(page.status, 307);
  assert.match(page.headers.get("location")!, /\/login$/);
  for (const p of ["login", "api/login", "media/x.png", "approve", "api/approve", "api/drafts", "favicon.ico", "_next/static/a.js"]) {
    assert.equal(proxy(n(p)).headers.get("x-middleware-next"), "1", p);
  }
  const ok = await login.POST(req("api/login", { json: { password: "correct horse" } }));
  const cookie = ok.headers.get("set-cookie")!.split(";")[0];
  assert.equal(proxy(n("api/posts", { cookie })).headers.get("x-middleware-next"), "1");
  assert.equal(proxy(n("api/posts", { cookie: cookie.slice(0, -3) + "abc" })).status, 401);

  const secret = process.env.APP_SECRET;
  process.env.APP_SECRET = "short";
  const r = proxy(n("api/posts", { cookie }));
  assert.equal(r.status, 500);
  assert.match(((await r.json()) as { error: string }).error, /APP_SECRET/);
  process.env.APP_SECRET = secret;
});

test("approve: too-long X text is 422; then slots book in order", async () => {
  const long = await makePost({ caption: "x".repeat(281), platforms: ["x"] });
  const r = await approve.POST(req(`api/posts/${long.id}/approve`, { json: {} }), ctx(long.id));
  assert.equal(r.status, 422);
  const body = (await r.json()) as { results: { checkId: string; platform: string }[] };
  assert.ok(body.results.some((c) => c.checkId === "length" && c.platform === "x"));
  const c = await checksRoute.GET(req(`api/posts/${long.id}/checks`), ctx(long.id));
  assert.equal(((await c.json()) as unknown[]).length, 1);

  const free = (await (await slots.GET(req("api/slots?count=3"))).json()) as { at: string }[];
  const a = await makePost({ caption: "first", platforms: ["bluesky"] });
  const b = await makePost({ caption: "second", platforms: ["bluesky"] });
  const ra = (await (await approve.POST(req(`api/posts/${a.id}/approve`, { json: {} }), ctx(a.id))).json()) as { status: string; slotAt: string };
  const rb = (await (await approve.POST(req(`api/posts/${b.id}/approve`, { json: {} }), ctx(b.id))).json()) as { slotAt: string };
  assert.equal(ra.status, "approved");
  assert.equal(ra.slotAt, free[0].at);
  assert.equal(rb.slotAt, free[1].at);

  const again = await approve.POST(req(`api/posts/${a.id}/approve`, { json: {} }), ctx(a.id));
  assert.equal(again.status, 409);
  const un = await unschedule.POST(req(`api/posts/${a.id}/unschedule`), ctx(a.id));
  assert.deepEqual(((await un.json()) as { status: string; slotAt: null }), { ...(await store.getPost(a.id)), status: "draft", slotAt: null });
  assert.equal((await unschedule.POST(req("x"), ctx(a.id))).status, 409);
});

test("editing: posting posts are 409, approved text edit returns to draft", async () => {
  const p = await makePost({ caption: "hello", platforms: ["bluesky"] });
  await store.updatePost(p.id, { status: "posting" });
  const r = await postId.PATCH(req(`api/posts/${p.id}`, { method: "PATCH", json: { caption: "x" } }), ctx(p.id));
  assert.equal(r.status, 409);
  await store.updatePost(p.id, { status: "approved", slotAt: "2030-01-01T00:00:00.000Z" });
  const e = (await (await postId.PATCH(req(`api/posts/${p.id}`, { method: "PATCH", json: { caption: "y" } }), ctx(p.id))).json()) as { status: string; slotAt: null };
  assert.equal(e.status, "draft");
  assert.equal(e.slotAt, null);
  assert.equal((await postId.GET(req("x"), ctx("nope"))).status, 404);
});

test("webhook: token required, creates needs_approval, rejects local media", async () => {
  const draft = { caption: "from a script", platforms: ["bluesky"] };
  const hook = (headers: Record<string, string>, body: unknown) => drafts.POST(req("api/drafts", { json: body, headers }));
  assert.equal((await hook({}, draft)).status, 401);
  assert.equal((await hook({ authorization: "Bearer wrong" }, draft)).status, 401);
  const ok = await hook({ authorization: "Bearer hook-token" }, draft);
  assert.equal(ok.status, 201);
  const made = (await ok.json()) as { status: string; source: string };
  assert.equal(made.status, "needs_approval");
  assert.equal(made.source, "webhook");
  const many = await hook({ authorization: "Bearer hook-token" }, [draft, draft]);
  assert.equal(((await many.json()) as unknown[]).length, 2);

  const before = (await store.listPosts()).length;
  const local = await hook({ authorization: "Bearer hook-token" }, { ...draft, media: [{ src: "/etc/hosts" }] });
  assert.equal(local.status, 400);
  assert.equal((await store.listPosts()).length, before);

  delete process.env.WEBHOOK_TOKEN;
  assert.equal((await hook({ authorization: "Bearer hook-token" }, draft)).status, 503);
  process.env.WEBHOOK_TOKEN = "hook-token";
});

test("accounts: GET never contains a credential value", async () => {
  const put = await account.PUT(req("api/accounts/mastodon", { method: "PUT", json: { instance: "mastodon.example", accessToken: "SECRET-TOKEN-123" } }), { params: Promise.resolve({ platform: "mastodon" }) });
  assert.equal(put.status, 200);
  assert.doesNotMatch(await put.text(), /SECRET-TOKEN-123/);
  const list = await (await accounts.GET()).text();
  assert.doesNotMatch(list, /SECRET-TOKEN-123|mastodon\.example/);
  assert.equal((JSON.parse(list) as { platform: string; connected: boolean }[]).find((a) => a.platform === "mastodon")!.connected, true);
  const bad = await account.PUT(req("api/accounts/x", { method: "PUT", json: { accessToken: "a" } }), { params: Promise.resolve({ platform: "x" }) });
  assert.equal(bad.status, 400);
  await account.DELETE(req("x"), { params: Promise.resolve({ platform: "mastodon" }) });
  assert.equal((JSON.parse(await (await accounts.GET()).text()) as { platform: string; connected: boolean }[]).find((a) => a.platform === "mastodon")!.connected, false);
});

test("media: upload accepts a real image, rejects non-images; /media serves only stored names", async () => {
  const f = new FormData();
  f.set("file", new File(["just text"], "a.txt", { type: "text/plain" }));
  assert.equal((await media.POST(new Request(URL0 + "api/media", { method: "POST", body: f }))).status, 415);
  const fake = new FormData();
  fake.set("file", new File(["this is not a png at all"], "a.png", { type: "image/png" }));
  assert.equal((await media.POST(new Request(URL0 + "api/media", { method: "POST", body: fake }))).status, 415);

  const ok = await media.POST(new Request(URL0 + "api/media", { method: "POST", body: pngFile() }));
  assert.equal(ok.status, 201);
  const m = (await ok.json()) as { id: string; path: string; kind: string };
  assert.match(m.path, /^media\/[0-9a-f-]{36}\.png$/);
  assert.ok(fs.existsSync(path.join(dir, m.path)));

  const served = await mediaFile.GET(req("x"), { params: Promise.resolve({ file: `${m.id}.png` }) });
  assert.equal(served.status, 200);
  assert.equal((await mediaFile.GET(req("x"), { params: Promise.resolve({ file: "a.txt" }) })).status, 404);

  const withMedia = await makePost({ caption: "pic", platforms: ["instagram"], media: [m] });
  assert.ok(withMedia.id);
  const forged = await posts.POST(req("api/posts", { json: { caption: "x", media: [{ id: m.id, path: "../../etc/passwd" }] } }));
  assert.equal(forged.status, 400);
  const missing = await posts.POST(req("api/posts", { json: { caption: "x", media: [{ id: "00000000-0000-0000-0000-000000000000", path: "media/00000000-0000-0000-0000-000000000000.png" }] } }));
  assert.equal(missing.status, 400);
});

test("/approve: GET writes nothing, the POST books the slot", async () => {
  const p = await makePost({ caption: "email me", platforms: ["bluesky"] });
  await store.updatePost(p.id, { status: "needs_approval" });
  const slot = ((await (await slots.GET(req("api/slots?count=1"))).json()) as { at: string }[])[0].at;
  const t = signApproval(p.id, slot);

  const stamp = (await store.getPost(p.id)).updatedAt;
  await approvePage({ searchParams: Promise.resolve({ t }) });
  const after = await store.getPost(p.id);
  assert.equal(after.status, "needs_approval");
  assert.equal(after.updatedAt, stamp);

  const form = () => { const f = new FormData(); f.set("t", t); return new Request(URL0 + "api/approve", { method: "POST", body: f }); };
  const r = await approveApi.POST(form());
  assert.equal(r.status, 303);
  assert.equal(r.headers.get("location"), "https://example.test/approve?done=1");
  const done = await store.getPost(p.id);
  assert.equal(done.status, "approved");
  assert.equal(done.slotAt, slot);

  const twice = await approveApi.POST(form());
  assert.match(twice.headers.get("location")!, /error=handled/);
  const f = new FormData(); f.set("t", "garbage");
  assert.match((await approveApi.POST(new Request(URL0 + "api/approve", { method: "POST", body: f }))).headers.get("location")!, /error=invalid/);
});

test("settings: defaults, patch, rejects bad tz and times", async () => {
  const d = (await (await settings.GET()).json()) as { tz: string; approval: string };
  assert.equal(d.approval, "ui");
  const bad = await settings.PUT(req("api/settings", { method: "PUT", json: { tz: "Mars/Base" } }));
  assert.equal(bad.status, 400);
  assert.equal((await settings.PUT(req("api/settings", { method: "PUT", json: { slotTimes: ["25:00"] } }))).status, 400);
  const ok = (await (await settings.PUT(req("api/settings", { method: "PUT", json: { tz: "Asia/Kolkata", slotTimes: ["10:00", "08:30"], reviewEmail: "" } }))).json()) as { tz: string; slotTimes: string[]; reviewEmail: null };
  assert.equal(ok.tz, "Asia/Kolkata");
  assert.deepEqual(ok.slotTimes, ["08:30", "10:00"]);
  assert.equal(ok.reviewEmail, null);
  await settings.PUT(req("api/settings", { method: "PUT", json: { tz: "UTC", slotTimes: ["09:00", "13:00", "18:00", "21:00"] } }));
});
