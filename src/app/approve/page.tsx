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

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="center"><div className="card auth-card" style={{ width: "min(480px, 100%)" }}>{children}</div></main>;
}

export default async function ApprovePage({ searchParams }: { searchParams: Promise<{ t?: string; done?: string; error?: string }> }) {
  const sp = await searchParams;
  if (sp.done) return <Shell><h1>Approved</h1><p>The post is booked. You can close this page.</p></Shell>;
  const note = sp.error ? MESSAGES[sp.error] ?? MESSAGES.invalid : null;

  // Reading only: opening this page (a mail scanner may) books nothing. The button below does.
  const v = verifyApproval(sp.t);
  if (!v.ok) {
    return <Shell><h1>Approval</h1><p>{note ?? (v.reason === "unconfigured" ? "APP_SECRET is not set (32+ characters), so approval links cannot be checked." : MESSAGES[v.reason === "expired" ? "expired" : "invalid"])}</p></Shell>;
  }
  let post;
  try { post = await getStore().getPost(v.approval.postId); } catch { return <Shell><h1>Approval</h1><p>{MESSAGES.missing}</p></Shell>; }
  const tz = (await getStore().getSettings()).tz;
  const open = post.status === "needs_approval" || post.status === "draft";

  return (
    <Shell>
      <h1>Approve this post?</h1>
      {note && <p className="msg err" role="alert">{note}</p>}
      <blockquote>{post.caption}</blockquote>
      <p className="muted">Platforms: {post.platforms.join(", ") || "none chosen"}</p>
      <p className="muted num">Slot: {fmtSlot(v.approval.slotAt, tz)}</p>
      {open ? (
        <form method="post" action="/api/approve">
          <input type="hidden" name="t" value={sp.t} />
          <button type="submit" className="btn primary" style={{ height: 36, width: "100%" }}>Confirm</button>
        </form>
      ) : <p>{MESSAGES.handled}</p>}
    </Shell>
  );
}
