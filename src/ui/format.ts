import { localParts, nextSlots, type Slot } from "@/core/slots";
import type { Post } from "@/core/types";
import type { Settings } from "@/core/settings";
import { checks } from "@/checks";
import { blocks, runChecks, type CheckResult } from "@/core/check";

export type AppSettings = Settings & { emailConfigured?: boolean };

export const firstLine = (p: { caption: string; perPlatform?: Post["perPlatform"] }) => {
  const t = p.caption.trim() || Object.values(p.perPlatform ?? {}).find((x) => x?.trim())?.trim() || "";
  return t.split("\n")[0] || "(no text)";
};

export const checkPost = (post: Post): CheckResult[] => runChecks(post, checks);
export const hasErrors = blocks;

export function summarize(results: CheckResult[]): { ok: boolean; text: string } {
  const n = results.length;
  return n === 0 ? { ok: true, text: "✓ Checks pass" } : { ok: false, text: `${n} ${n === 1 ? "issue" : "issues"}` };
}

export const todayIn = (tz: string) => localParts(new Date(), tz).date;
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
/** Monday on or before a wall-clock date. */
export function weekStart(date: string): string {
  const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((wd + 6) % 7));
}
export const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short" }) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { ...opts, timeZone: "UTC" });

export const slotsFor = (s: AppSettings, count: number, taken: Set<string>): Slot[] =>
  nextSlots({ tz: s.tz, times: s.slotTimes, minLeadMinutes: s.minLeadMinutes }, count, taken);

export const mediaUrl = (m: { path: string }) => `/${m.path}`;
