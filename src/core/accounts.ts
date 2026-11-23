/**
 * Connected platform accounts. Credentials are a flat JSON object per platform
 * (the shape each adapter documents in its file) kept in the `accounts` table.
 * Adapters read them through an AccountStore, so tests and the dry-run CLI can
 * pass an in-memory one. Credentials never appear in a plan, a log or an error.
 */

import type { Platform } from "./types";

export interface Account {
  platform: Platform;
  credentials: Record<string, string>;
  /** When the main token expires, if the platform says; null = does not expire or unknown. */
  expiresAt: string | null;
  updatedAt: string;
}

export interface AccountStore {
  getAccount(platform: Platform): Promise<Account | null>;
  setAccount(platform: Platform, credentials: Record<string, string>, expiresAt?: string | null): Promise<void>;
  listAccounts(): Promise<Account[]>;
}

/** An in-memory AccountStore: tests and the dry-run CLI. */
export function memoryAccounts(initial: Partial<Record<Platform, Record<string, string>>> = {}): AccountStore {
  const m = new Map<Platform, Account>();
  const put = (platform: Platform, credentials: Record<string, string>, expiresAt: string | null = null) =>
    m.set(platform, { platform, credentials, expiresAt, updatedAt: new Date().toISOString() });
  for (const [p, c] of Object.entries(initial)) put(p as Platform, c);
  return {
    async getAccount(p) { return m.get(p) ?? null; },
    async setAccount(p, c, e) { put(p, c, e ?? null); },
    async listAccounts() { return [...m.values()]; },
  };
}

const DAY = 864e5;
/** Refresh a long-lived token once it has less than this left. */
export const REFRESH_WHEN_LEFT_DAYS = 7;

export interface RefreshReport {
  refreshed: Platform[];
  /** Refresh attempts that failed; the message never contains a token. */
  failed: { platform: Platform; error: string }[];
}

const HOSTS = {
  instagram: "https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token",
  threads: "https://graph.threads.com/refresh_access_token?grant_type=th_refresh_token",
} as const;

/**
 * Refresh the long-lived tokens that are close to expiry (60-day tokens):
 *   threads: when less than 7 days are left, or the expiry is unknown (a refresh tells us);
 *   instagram: only when an expiry is recorded and under 7 days away. Tokens from Facebook
 *   Login (system users) do not expire and have no refresh, so an unknown expiry is left alone.
 * Platforms with tokens that do not expire (X, Mastodon) are skipped; Bluesky logs in per call.
 */
export async function refreshDue(store: AccountStore, now: Date): Promise<RefreshReport> {
  const report: RefreshReport = { refreshed: [], failed: [] };
  for (const a of await store.listAccounts()) {
    if (a.platform !== "instagram" && a.platform !== "threads") continue;
    const token = a.credentials.accessToken;
    if (!token) continue;
    const left = a.expiresAt ? (Date.parse(a.expiresAt) - now.getTime()) / DAY : null;
    if (left == null ? a.platform === "instagram" : left >= REFRESH_WHEN_LEFT_DAYS) continue;
    try {
      const res = await fetch(`${HOSTS[a.platform]}&access_token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(20_000) });
      const j = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: { message?: string } };
      if (!res.ok || !j.access_token) throw new Error(`${a.platform} refresh ${res.status}: ${j.error?.message ?? "no token returned"}`);
      const expiresAt = new Date(now.getTime() + (j.expires_in ?? 60 * 86400) * 1000).toISOString();
      await store.setAccount(a.platform, { ...a.credentials, accessToken: j.access_token }, expiresAt);
      report.refreshed.push(a.platform);
    } catch (e) {
      report.failed.push({ platform: a.platform, error: (e instanceof Error ? e.message : String(e)).replaceAll(token, "[token]").slice(0, 300) });
    }
  }
  return report;
}
