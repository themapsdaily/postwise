import { verifyApproval } from "../../../core/approveLink";
import { approvePost } from "../../../server/booking";
import { getStore } from "../../../server/store";

/** The confirm button on /approve posts here. Public: the signed token is the credential. */
export async function POST(req: Request) {
  const base = (process.env.PUBLIC_URL ?? "").replace(/\/+$/, "") || new URL(req.url).origin;
  const back = (q: string) => Response.redirect(`${base}/approve?${q}`, 303);

  let token = "";
  try { token = String((await req.formData()).get("t") ?? ""); } catch { /* falls through to invalid */ }
  const v = verifyApproval(token);
  if (!v.ok) return back(`error=${v.reason === "expired" ? "expired" : "invalid"}`);

  const r = await approvePost(getStore(), v.approval.postId, { slotAt: v.approval.slotAt, requireFree: true });
  if (r.ok) return back("done=1");
  const code = r.status === 404 ? "missing" : r.status === 422 && r.error === "Checks failed" ? "checks" : r.status === 422 ? "past" : r.error.includes("slot") ? "taken" : "handled";
  return back(`t=${encodeURIComponent(token)}&error=${code}`);
}
