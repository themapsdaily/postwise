#!/usr/bin/env node
// Turn an RSS 2.0 or Atom feed into Postwise drafts. Zero dependencies.
//
//   node examples/sources/rss-to-drafts.mjs https://example.com/feed.xml
//   node examples/sources/rss-to-drafts.mjs --file examples/sources/sample-feed.xml
//
// Environment:
//   FEED_URL    feed to read when no URL argument is given
//   SINCE       ISO time; only items newer than this are printed (default: the last 24 hours)
//   PLATFORMS   comma list, e.g. "bluesky,mastodon" (default: none; set them in the composer)
//
// Output: a JSON array of DraftInput on stdout. Problems go to stderr, exit code 1.
//
// The XML "parser" is a handful of regexes. It handles ordinary RSS 2.0 and Atom
// feeds. It does not handle every corner of XML (namespaces with odd prefixes,
// nested CDATA tricks). If a feed breaks it, use a real XML library instead.

import fs from "node:fs";

const args = process.argv.slice(2);
const fileIdx = args.indexOf("--file");
const file = fileIdx >= 0 ? args[fileIdx + 1] : null;
const url = args.find((a, i) => !a.startsWith("--") && i !== fileIdx + 1) ?? process.env.FEED_URL;

const since = process.env.SINCE ? new Date(process.env.SINCE) : new Date(Date.now() - 24 * 3600 * 1000);
if (Number.isNaN(since.getTime())) die(`SINCE is not a date: ${process.env.SINCE}`);
const VALID = ["instagram", "threads", "x", "bluesky", "mastodon"];
const platforms = (process.env.PLATFORMS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
for (const p of platforms) if (!VALID.includes(p)) die(`Unknown platform in PLATFORMS: ${p}`);

function die(msg) {
  console.error(msg);
  process.exit(1);
}

const decode = (s) =>
  s
    .replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, "&")
    .trim();

/** Text of the first <tag>...</tag> inside a block, or "". */
const text = (block, tag) => {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i").exec(block);
  return m ? decode(m[1]) : "";
};

/** Value of an attribute on the first matching tag, or "". */
const attr = (block, tag, name, filter = () => true) => {
  for (const m of block.matchAll(new RegExp(`<${tag}\\s([^>]*?)/?>`, "gi"))) {
    const a = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(m[1]);
    if (a && filter(m[1])) return decode(a[1]);
  }
  return "";
};

function link(block) {
  const rss = text(block, "link");
  if (rss) return rss;
  // Atom: <link rel="alternate" href="..."/> (rel is optional and defaults to alternate)
  return attr(block, "link", "href", (a) => !/rel\s*=\s*"(?!alternate)/i.test(a));
}

function image(block) {
  const img = (a) => /type\s*=\s*"image\//i.test(a) || /medium\s*=\s*"image"/i.test(a) || /\.(jpe?g|png|gif|webp)(\?|")/i.test(a);
  return attr(block, "enclosure", "url", img) || attr(block, "media:content", "url", img) || attr(block, "media:thumbnail", "url");
}

function parse(xml) {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  return blocks.map((b) => ({
    title: text(b, "title"),
    link: link(b),
    date: new Date(text(b, "pubDate") || text(b, "published") || text(b, "updated") || text(b, "dc:date") || NaN),
    image: image(b),
  }));
}

async function load() {
  if (file) return fs.readFileSync(file, "utf8");
  if (!url) die("Usage: rss-to-drafts.mjs <feed url> | --file <path>   (or set FEED_URL)");
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "postwise-example" } });
  if (!res.ok) die(`Fetching ${url} failed: ${res.status}`);
  return res.text();
}

const items = parse(await load());
const drafts = items
  // Items without a usable date are skipped: we cannot tell if they are new.
  .filter((i) => i.title && !Number.isNaN(i.date.getTime()) && i.date > since)
  .sort((a, b) => a.date - b.date)
  .map((i) => ({
    caption: i.link ? `${i.title}\n\n${i.link}` : i.title,
    ...(platforms.length ? { platforms } : {}),
    ...(i.image ? { media: [{ src: i.image }] } : {}),
    meta: { link: i.link, published: i.date.toISOString() },
  }));

console.log(JSON.stringify(drafts, null, 2));
