import { guard, json } from "../../../server/http";
import { getStore } from "../../../server/store";
import { PLATFORMS } from "../../../core/types";

/** Which platforms are connected and when their token expires. Credentials are never returned. */
export async function GET() {
  return guard(async () => {
    const rows = await getStore().listAccounts();
    return json(PLATFORMS.map((platform) => {
      const a = rows.find((r) => r.platform === platform);
      return { platform, connected: !!a, expiresAt: a?.expiresAt ?? null };
    }));
  });
}
