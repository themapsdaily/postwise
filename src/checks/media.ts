/** Platform and media rules that need no network. Pure. */

import { textFor } from "../core/adapter";
import type { Check, CheckResult } from "../core/check";

export const mediaCheck: Check = {
  id: "media",
  run(post) {
    const out: CheckResult[] = [];
    const err = (message: string, platform?: CheckResult["platform"]) => out.push({ checkId: "media", level: "error", platform, message });
    const images = post.media.filter((m) => m.kind === "image").length;
    const videos = post.media.filter((m) => m.kind === "video").length;

    if (!post.platforms.length) err("Pick at least one platform");
    const hasText = post.caption.trim() !== "" || post.platforms.some((p) => textFor(post, p).trim() !== "");
    if (!hasText && !post.media.length) err("Add a caption or some media");

    for (const p of post.platforms) {
      if (p === "instagram") {
        if (!post.media.length) err("instagram needs at least one image or video", p);
        if (post.media.length > 10) err(`instagram: a carousel holds 10, this has ${post.media.length}`, p);
      } else if (p === "x" || p === "bluesky" || p === "mastodon") {
        if (images > 4) err(`${p}: at most 4 images, this has ${images}`, p);
        if (videos && (p === "x" || p === "bluesky")) err(`${p}: video is not supported yet`, p);
      }
    }
    return out;
  },
};
