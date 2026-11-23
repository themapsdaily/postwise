/**
 * A Check looks at a post before it can be approved: caption length, missing
 * media, banned words, a link that must be there. Checks are pure and fast;
 * the composer runs them on every keystroke.
 *
 * An `error` blocks approval; a `warn` is shown but does not.
 * Register yours in src/checks/index.ts.
 */

import type { Platform, Post } from "./types";

export interface CheckResult {
  checkId: string;
  level: "error" | "warn";
  /** Set when the problem is on one platform only. */
  platform?: Platform;
  message: string;
}

export interface Check {
  id: string;
  run(post: Post): CheckResult[];
}

export function runChecks(post: Post, checks: Check[]): CheckResult[] {
  return checks.flatMap((c) => {
    try {
      return c.run(post);
    } catch (e) {
      return [{ checkId: c.id, level: "warn" as const, message: `check crashed: ${e instanceof Error ? e.message : String(e)}` }];
    }
  });
}

export const blocks = (results: CheckResult[]) => results.some((r) => r.level === "error");
