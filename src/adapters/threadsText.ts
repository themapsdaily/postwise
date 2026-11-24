/** Pure, client-safe: the composer counter, the length check and the adapter all use it. */

export const THREADS_MAX = 500;
const PICTO = /\p{Extended_Pictographic}/u;

/** Length the way Threads counts it: an emoji counts as its UTF-8 bytes, anything else as 1. */
export function threadsLength(s: string): number {
  let n = 0;
  for (const ch of s) n += PICTO.test(ch) ? new TextEncoder().encode(ch).length : 1;
  return n;
}
