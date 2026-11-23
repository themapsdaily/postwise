/** Adapter registry. One adapter per platform; a platform is live once it has an account row. */

import type { AccountStore } from "../core/accounts";
import type { Adapter } from "../core/adapter";
import type { Platform } from "../core/types";
import { createBlueskyAdapter } from "./bluesky";
import { createInstagramAdapter } from "./instagram";
import { createMastodonAdapter } from "./mastodon";
import { createThreadsAdapter } from "./threads";
import { createXAdapter } from "./x";

const FACTORIES: Record<Platform, (accounts: AccountStore) => Adapter> = {
  instagram: createInstagramAdapter,
  threads: createThreadsAdapter,
  x: createXAdapter,
  bluesky: createBlueskyAdapter,
  mastodon: createMastodonAdapter,
};

/** Every adapter, whether or not its account exists (dry run, tests). */
export function allAdapters(accounts: AccountStore): Record<Platform, Adapter> {
  return Object.fromEntries(Object.entries(FACTORIES).map(([p, f]) => [p, f(accounts)])) as Record<Platform, Adapter>;
}

/** Only the platforms that have an account row; the engine skips deliveries for the rest. */
export async function buildAdapters(accounts: AccountStore): Promise<Partial<Record<Platform, Adapter>>> {
  const all = allAdapters(accounts);
  const out: Partial<Record<Platform, Adapter>> = {};
  for (const a of await accounts.listAccounts()) if (a.platform in all) out[a.platform] = all[a.platform];
  return out;
}
