/** The worker: runs due sources and the publish tick every minute. `npx tsx src/worker.ts` */

import path from "node:path";
import { CronExpressionParser } from "cron-parser";
import { runTick } from "./core/engine";
import type { Source } from "./core/source";
import { refreshDue } from "./core/accounts";
import { buildAdapters } from "./adapters";
import { loadScriptSources, sources as codeSources } from "./sources";
import { importMedia } from "./store/media";
import { openStore } from "./store/sqlite";
import { notifyNeedsApproval } from "./server/review";

const dataDir = path.resolve(process.env.DATA_DIR ?? "./data");
const tz = process.env.TZ || "UTC";
const dryRun = process.env.DRY_RUN === "1";
const store = openStore(path.join(dataDir, "postwise.db"));
const sources: Source[] = [...codeSources, ...loadScriptSources(path.resolve("sources.yaml"))];
const started = new Date();
const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);

/** Did the cron fire between `since` (exclusive) and `now`? */
function fired(cron: string, since: Date, now: Date): boolean {
  const next = CronExpressionParser.parse(cron, { currentDate: since, tz }).next().toDate();
  return next.getTime() <= now.getTime();
}

async function runSources(now: Date): Promise<string[]> {
  const notes: string[] = [];
  for (const s of sources) {
    if (!s.schedule) continue;
    const prev = store.getSourceRun(s.id);
    const since = prev?.lastRunAt ? new Date(prev.lastRunAt) : started;
    try {
      if (!fired(s.schedule, since, now)) continue;
    } catch (e) {
      notes.push(`source ${s.id}: bad schedule: ${(e as Error).message}`);
      continue;
    }
    try {
      const drafts = await s.run({ now, log, lastRunAt: prev?.lastRunAt ?? null });
      for (const d of drafts) {
        const media = [];
        for (const m of d.media ?? []) media.push({ ...(await importMedia(m.src, dataDir, { allowLocal: true })), alt: m.alt });
        const post = await store.createPost({
          caption: d.caption, platforms: d.platforms, perPlatform: d.perPlatform, at: d.at, meta: d.meta,
          source: s.id, media, status: s.autoApprove && d.at ? "approved" : "needs_approval",
        });
        await notifyNeedsApproval(post, store);
      }
      store.setSourceRun(s.id, now.toISOString(), null);
      notes.push(`source ${s.id}: ${drafts.length} draft(s)`);
    } catch (e) {
      // Record the run so a broken source retries on its next cron time, not every minute.
      store.setSourceRun(s.id, now.toISOString(), (e as Error).message.slice(0, 500));
      notes.push(`source ${s.id} failed: ${(e as Error).message}`);
    }
  }
  return notes;
}

let busy = false;
let lastRefresh = 0;
async function loop() {
  if (busy) return;
  busy = true;
  try {
    const now = new Date();
    // A dry run writes nothing, so sources (which create posts) do not run.
    const notes = dryRun ? [] : await runSources(now);
    if (!dryRun && now.getTime() - lastRefresh >= 3600_000) {
      lastRefresh = now.getTime();
      const rr = await refreshDue(store, now);
      if (rr.refreshed.length) notes.push(`refreshed tokens: ${rr.refreshed.join(", ")}`);
      for (const f of rr.failed) notes.push(`token refresh failed: ${f.error}`);
    }
    const r = await runTick(now, { store, adapters: await buildAdapters(store), dryRun });
    if (r.claimed.length) notes.push(`claimed ${r.claimed.length}`);
    if (r.changes.length) notes.push(`${r.changes.length} delivery change(s): ${r.changes.map((c) => `${c.platform} ${c.from}->${c.to}`).join(", ")}`);
    for (const e of r.errors) notes.push(`error: ${e}`);
    if (r.previews?.length) notes.push(`dry run: ${r.previews.length} preview(s)`);
    if (notes.length) log(notes.join(" | "));
  } catch (e) {
    log(`loop error: ${(e as Error).message}`);
  } finally {
    busy = false;
  }
}

const timer = setInterval(loop, 60_000);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  while (busy) await new Promise((r) => setTimeout(r, 100));
  store.close();
  process.exit(0);
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);

log(`worker started (data ${dataDir}, tz ${tz}${dryRun ? ", dry run" : ""}, ${sources.length} source(s))`);
void loop();
