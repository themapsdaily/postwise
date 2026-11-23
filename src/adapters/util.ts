/** Helpers the adapters share. Nothing here logs or returns a credential. */

import fs from "node:fs";
import path from "node:path";
import type { AccountStore } from "../core/accounts";
import type { Step } from "../core/adapter";
import type { Media, Platform } from "../core/types";

export const trim = (s: string, n = 300) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** 429 and 5xx are worth another try; any other failure (bad token, bad content) is final. */
export const httpStep = (status: number, message: string): Step => ({
  status: status === 429 || status >= 500 ? "retry" : "failed",
  error: trim(message),
});

/** Read a stored media file from the data dir. */
export const readMedia = (m: Media) =>
  fs.promises.readFile(path.join(path.resolve(process.env.DATA_DIR ?? "./data"), m.path));

export type Creds = Record<string, string>;

/** The platform's saved credentials, or a failed Step naming what is missing (never the values). */
export async function credentials(
  accounts: AccountStore, platform: Platform, required: string[],
): Promise<{ c: Creds; step?: undefined } | { c?: undefined; step: Step }> {
  const a = await accounts.getAccount(platform);
  if (!a) return { step: { status: "failed", error: `no ${platform} account connected: add it in Settings` } };
  const missing = required.filter((k) => !a.credentials[k]);
  if (missing.length) return { step: { status: "failed", error: `${platform} account is missing: ${missing.join(", ")}` } };
  return { c: a.credentials };
}

export const sleepMs = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
