import { verifyApproval } from "../../core/approveLink";
import { fmtSlot } from "../../core/slots";
import { getStore } from "../../server/store";

export const dynamic = "force-dynamic";

const MESSAGES: Record<string, string> = {
  invalid: "This approval link is not valid.",
  expired: "This approval link has expired. Approve the post from the app instead.",
  missing: "That post no longer exists.",
  taken: "That slot has been taken. Approve the post from the app to pick another.",
  past: "That slot has already passed. Approve the post from the app to pick another.",
  checks: "The post no longer passes its checks. Fix it in the app first.",
  handled: "That post was already approved or has been sent.",
};

const card = { maxWidth: 480, margin: "10vh auto", padding: "1.5rem", border: "1px solid var(--foreground)", borderRadius: 8 } as const;

export default async function ApprovePage({ searchParams }: { searchParams: Promise<{ t?: string; done?: string; error?: string }> }) {
  const sp = await searchParams;
  if (sp.done) return <main style={card}><h1>Approved</h1><p>The post is booked. You can close this page.</p></main>;
  const note = sp.error ? MESSAGES[sp.error] ?? MESSAGES.invalid : null;

  // Reading only: opening this page (a mail scanner may) books nothing. The button below does.
  const v = verifyApproval(sp.t);
  if (!v.ok) {
    return <main style={card}><h1>Approval</h1><p>{note ?? (v.reason === "unconfigured" ? "APP_SECRET is not set (32+ characters), so approval links cannot be checked." : MESSAGES[v.reason === "expired" ? "expired" : "invalid"])}</p></main>;
  }
  let post;
  try { post = await getStore().getPost(v.approval.postId); } catch { return <main style={card}><h1>Approval</h1><p>{MESSAGES.missing}</p></main>; }
  const tz = (await getStore().getSettings()).tz;
  const open = post.status === "needs_approval" || post.status === "draft";

  return (
    <main style={card}>
      <h1>Approve this post?</h1>
      {note && <p role="alert">{note}</p>}
      <blockquote style={{ whiteSpace: "pre-wrap", margin: "1rem 0" }}>{post.caption}</blockquote>
      <p>Platforms: {post.platforms.join(", ") || "none chosen"}</p>
      <p>Slot: {fmtSlot(v.approval.slotAt, tz)}</p>
      {open ? (
        <form method="post" action="/api/approve" style={{ marginTop: "1rem" }}>
          <input type="hidden" name="t" value={sp.t} />
          <button type="submit">Confirm</button>
        </form>
      ) : <p>{MESSAGES.handled}</p>}
    </main>
  );
}
