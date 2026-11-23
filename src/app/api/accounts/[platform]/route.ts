import { PLATFORMS, type Platform } from "../../../../core/types";
import { fail, guard, json, readJson } from "../../../../server/http";
import { credentialSchemas } from "../../../../server/schemas";
import { getStore } from "../../../../server/store";

type Ctx = { params: Promise<{ platform: string }> };
const platformOf = async (ctx: Ctx) => {
  const p = (await ctx.params).platform;
  return (PLATFORMS as readonly string[]).includes(p) ? (p as Platform) : null;
};

/** Body is the flat credentials object the platform's adapter reads, e.g. {accessToken, igUserId}; Instagram and Threads may add expiresAt. */
export async function PUT(req: Request, ctx: Ctx) {
  return guard(async () => {
    const platform = await platformOf(ctx);
    if (!platform) return fail(404, "Unknown platform");
    const body = await readJson(req, credentialSchemas[platform]);
    if (!body.ok) return body.res;
    const { expiresAt, ...creds } = body.data;
    const clean = Object.fromEntries(Object.entries(creds).filter(([, v]) => v !== undefined)) as Record<string, string>;
    await getStore().setAccount(platform, clean, expiresAt ?? null);
    return json({ platform, connected: true, expiresAt: expiresAt ?? null });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return guard(async () => {
    const platform = await platformOf(ctx);
    if (!platform) return fail(404, "Unknown platform");
    await getStore().deleteAccount(platform);
    return json({ platform, connected: false, expiresAt: null });
  });
}
