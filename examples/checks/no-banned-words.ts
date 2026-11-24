/**
 * Example Check: block a post that uses a banned word.
 *
 * Register it in src/checks/index.ts:
 *
 *   import { noBannedWords } from "../../examples/checks/no-banned-words";
 *   export const checks: Check[] = [lengthCheck, mediaCheck, noBannedWords];
 *
 * (Or copy this file into src/checks/ and import it from "./no-banned-words".)
 *
 * Checks are pure and fast: no network, no file reads. The composer runs them
 * in the browser on every keystroke, so keep the list inline.
 */

import { textFor } from "../../src/core/adapter";
import type { Check, CheckResult } from "../../src/core/check";

const BANNED = ["guaranteed", "free money", "click here"];

/** Whole words or phrases, any case. "guaranteed" does not match "unguaranteed". */
const patterns = BANNED.map((w) => ({
  word: w,
  re: new RegExp(`(?<![\\p{L}\\p{N}])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu"),
}));

export const noBannedWords: Check = {
  id: "no-banned-words",
  run(post) {
    const out: CheckResult[] = [];
    for (const platform of post.platforms) {
      const text = textFor(post, platform);
      for (const { word, re } of patterns) {
        if (re.test(text)) {
          out.push({
            checkId: "no-banned-words",
            level: "error", // use "warn" to show the message without blocking approval
            platform,
            message: `${platform}: the text contains "${word}"`,
          });
        }
      }
    }
    return out;
  },
};
