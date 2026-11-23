/** Caption length per platform. Pure: the composer imports this in the browser too. */

import { textFor } from "../core/adapter";
import type { Check, CheckResult } from "../core/check";
import type { Platform } from "../core/types";
import { xLength } from "../adapters/xText";

const LIMITS: Record<Platform, number> = { instagram: 2200, threads: 500, x: 280, bluesky: 300, mastodon: 500 };
const URL_RE = /https?:\/\/[^\s]+/gi;
const MASTODON_URL_LENGTH = 23;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const graphemeCount = (s: string) => (segmenter ? Array.from(segmenter.segment(s)).length : Array.from(s).length);

/** The most `countFor` may return for a platform. */
export const limitsFor = (platform: Platform): number => LIMITS[platform];

/** Length of `text` the way `platform` counts it. */
export function countFor(platform: Platform, text: string): number {
  switch (platform) {
    case "x": return xLength(text);
    case "bluesky": return graphemeCount(text);
    case "mastodon": return Array.from(text.replace(URL_RE, "x".repeat(MASTODON_URL_LENGTH))).length;
    default: return Array.from(text).length;
  }
}

export const lengthCheck: Check = {
  id: "length",
  run(post) {
    const out: CheckResult[] = [];
    for (const platform of post.platforms) {
      const n = countFor(platform, textFor(post, platform));
      const max = limitsFor(platform);
      if (n > max) out.push({ checkId: "length", level: "error", platform, message: `${platform}: ${n} of ${max} characters, ${n - max} too many` });
    }
    return out;
  },
};
