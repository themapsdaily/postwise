import { guard, json } from "../../../server/http";
import { getStore } from "../../../server/store";

export async function GET(req: Request) {
  return guard(async () => {
    const n = Number(new URL(req.url).searchParams.get("limit") ?? 50);
    const limit = Number.isInteger(n) ? Math.min(Math.max(n, 1), 500) : 50;
    const store = getStore();
    const posts = (await store.listPosts({ status: ["posted", "failed"] }))
      .sort((a, b) => Date.parse(b.slotAt ?? b.updatedAt) - Date.parse(a.slotAt ?? a.updatedAt))
      .slice(0, limit);
    const deliveries = await store.deliveriesFor(posts.map((p) => p.id));
    return json(posts.map((p) => ({
      ...p,
      deliveries: deliveries.filter((d) => d.postId === p.id).map((d) => ({ platform: d.platform, status: d.status, url: d.url, error: d.error, publishedAt: d.publishedAt })),
    })));
  });
}
