/**
 * The checks every post passes before it can be approved. Add your own:
 *
 *   const noEmDash: Check = {
 *     id: "no-em-dash",
 *     run: (post) => post.caption.includes("—")
 *       ? [{ checkId: "no-em-dash", level: "warn", message: "Caption has an em dash" }]
 *       : [],
 *   };
 *   export const checks: Check[] = [lengthCheck, mediaCheck, noEmDash];
 *
 * level "error" blocks approval; "warn" is only shown. Checks must be pure and
 * fast: the composer runs them in the browser on every keystroke.
 */

import type { Check } from "../core/check";
import { lengthCheck } from "./length";
import { mediaCheck } from "./media";

export const checks: Check[] = [lengthCheck, mediaCheck];

export { lengthCheck, mediaCheck };
export { countFor, limitsFor } from "./length";
