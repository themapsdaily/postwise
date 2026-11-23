/**
 * Print what each adapter would send for a post, with fake credentials and no network.
 * `npm run dry-run -- --post fixtures/post.json`
 */

import fs from "node:fs";
import { memoryAccounts } from "../core/accounts";
import type { Delivery, Post } from "../core/types";
import { PLATFORMS } from "../core/types";
import { allAdapters } from "../adapters";

const i = process.argv.indexOf("--post");
const file = i >= 0 ? process.argv[i + 1] : undefined;
if (!file) {
  console.error("usage: npm run dry-run -- --post <post.json>");
  process.exit(2);
}
const post = JSON.parse(fs.readFileSync(file, "utf8")) as Post;

// Placeholders only: a plan must never need, or show, a real credential.
const accounts = memoryAccounts({
  instagram: { accessToken: "FAKE-IG-TOKEN", igUserId: "FAKE-IG-USER" },
  threads: { accessToken: "FAKE-THREADS-TOKEN", userId: "FAKE-THREADS-USER" },
  x: { consumerKey: "FAKE-CK", consumerSecret: "FAKE-CS", accessToken: "FAKE-AT", accessTokenSecret: "FAKE-ATS" },
  bluesky: { identifier: "fake.example.com", appPassword: "FAKE-APP-PASSWORD" },
  mastodon: { instance: "mastodon.example", accessToken: "FAKE-MASTODON-TOKEN" },
});
const adapters = allAdapters(accounts);

const out: Record<string, unknown> = {};
for (const platform of PLATFORMS) {
  const d: Delivery = {
    id: "(dry run)", postId: post.id, platform, status: "queued", attempts: 0, containerId: null,
    remoteId: null, url: null, error: null, retryAt: null, publishedAt: null, updatedAt: post.updatedAt,
  };
  try {
    out[platform] = adapters[platform].plan(d, post);
  } catch (e) {
    out[platform] = { error: (e as Error).message };
  }
}
console.log(JSON.stringify(out, null, 2));
