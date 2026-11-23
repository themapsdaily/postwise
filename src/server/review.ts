/** The review email: the caption and three one-tap slots, each a signed link to the /approve confirm page. */

import { approveConfigured, approveUrl, signApproval } from "../core/approveLink";
import { fmtSlot } from "../core/slots";
import type { Post } from "../core/types";
import type { SqliteStore } from "../store/sqlite";
import { freeSlots } from "./booking";
import { emailConfigured, sendMail } from "./email";
import { getStore } from "./store";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export async function sendReviewEmail(post: Post, store: SqliteStore = getStore()): Promise<void> {
  const settings = await store.getSettings();
  if (!settings.reviewEmail) throw new Error("No review email address in Settings");
  if (!process.env.PUBLIC_URL) throw new Error("PUBLIC_URL is not set");
  const slots = await freeSlots(store, 3);
  const links = slots.map((s) => `<li><a href="${esc(approveUrl(signApproval(post.id, s.at)))}">Approve for ${esc(fmtSlot(s.at, settings.tz))}</a></li>`).join("");
  const html = `<p>A post is waiting for your approval.</p>
<blockquote style="white-space:pre-wrap">${esc(post.caption)}</blockquote>
<p>Platforms: ${esc(post.platforms.join(", ") || "none chosen")}${post.media.length ? ` &middot; ${post.media.length} media` : ""}</p>
${links ? `<ul>${links}</ul><p>Each link opens a page where you confirm; nothing is booked until you do.</p>` : "<p>No free slot is open: add slot times in Settings.</p>"}`;
  await sendMail(settings.reviewEmail, "Post waiting for approval", html);
}

/** Call when a post enters needs_approval. Sends only in "email" mode with mail configured; never throws. */
export async function notifyNeedsApproval(post: Post, store: SqliteStore = getStore()): Promise<void> {
  try {
    if (post.status !== "needs_approval" || !emailConfigured() || !approveConfigured()) return;
    if ((await store.getSettings()).approval !== "email") return;
    await sendReviewEmail(post, store);
  } catch (e) {
    console.error("review email failed:", e instanceof Error ? e.message : e);
  }
}
