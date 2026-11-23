import { settingsPatchSchema } from "../../../core/settings";
import { guard, json, readJson } from "../../../server/http";
import { getStore } from "../../../server/store";

export async function GET() {
  return guard(async () => json(await getStore().getSettings()));
}

/** Send any subset of the settings; the rest stay as they are. */
export async function PUT(req: Request) {
  return guard(async () => {
    const body = await readJson(req, settingsPatchSchema);
    if (!body.ok) return body.res;
    return json(await getStore().saveSettings(body.data));
  });
}
