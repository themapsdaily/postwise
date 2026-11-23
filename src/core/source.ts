/**
 * A Source makes drafts: anything that turns your data into posts.
 *
 * Built in: manual posts from the composer and POST /api/drafts (webhook).
 * Yours: any script listed in sources.yaml. The worker runs it on its cron and
 * reads a JSON array of DraftInput from stdout (see examples/sources/).
 * In TypeScript, implement this interface and register it in src/sources/index.ts.
 */

import type { DraftInput } from "./types";

export interface SourceContext {
  now: Date;
  log: (msg: string) => void;
  /** When this source last ran successfully (ISO), so it can fetch only what is new. */
  lastRunAt: string | null;
}

export interface Source {
  /** Stable id; stored on each Post as `source`. */
  id: string;
  /** Cron expression in the app's timezone, e.g. "0 8 * * *". Omit for push-only sources. */
  schedule?: string;
  /** Status new drafts get: straight to approval, or approved and booked. Default "needs_approval". */
  autoApprove?: boolean;
  run(ctx: SourceContext): Promise<DraftInput[]>;
}
