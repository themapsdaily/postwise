import { approvePost } from "../../../../../server/booking";
import { fail, guard, json } from "../../../../../server/http";
import { approveBodySchema } from "../../../../../server/schemas";
import { getStore } from "../../../../../server/store";

/** UI approval: always allowed, whatever the approval mode in Settings. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const text = await req.text();
    let raw: unknown = {};
    if (text.trim()) { try { raw = JSON.parse(text); } catch { return fail(400, "Body must be JSON"); } }
    const body = approveBodySchema.safeParse(raw);
    if (!body.success) return fail(400, "slotAt must be an ISO date");
    const r = await approvePost(getStore(), (await ctx.params).id, { slotAt: body.data.slotAt });
    return r.ok ? json(r.post) : fail(r.status, r.error, r.results ? { results: r.results } : {});
  });
}
