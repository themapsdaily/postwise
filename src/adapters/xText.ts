// X post length. Pure.
//
// X's weighted count (twitter-text v3): a post holds 280 units; code points
// 0-4351 (Latin through Georgian, so Devanagari and the other Indic scripts too)
// and the general-punctuation ranges weigh 1, everything else (CJK, Hangul, ...)
// weighs 2, and an emoji weighs 2 however many code points it is built from.
// Text is NFC-normalised first, as X does. Every link counts as 23.

export const X_MAX = 280;
export const X_LINK_LENGTH = 23;

const LIGHT: [number, number][] = [[0, 4351], [8192, 8205], [8208, 8223], [8242, 8247]];
const EMOJI = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;
const URL_RE = /https?:\/\/[^\s]+/gi;

const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter("en", { granularity: "grapheme" }) : null;
const graphemes = (s: string): string[] => (segmenter ? Array.from(segmenter.segment(s), (g) => g.segment) : Array.from(s));
const weight = (cp: number) => (LIGHT.some(([a, b]) => cp >= a && cp <= b) ? 1 : 2);

function plainLength(text: string): number {
  let n = 0;
  for (const g of graphemes(text)) {
    if (EMOJI.test(g)) { n += 2; continue; }
    for (const ch of g) n += weight(ch.codePointAt(0)!);
  }
  return n;
}

/** Length the way X counts it. */
export function xLength(text: string): number {
  let n = 0;
  let last = 0;
  const s = text.normalize("NFC");
  for (const m of s.matchAll(URL_RE)) {
    n += plainLength(s.slice(last, m.index)) + X_LINK_LENGTH;
    last = m.index + m[0].length;
  }
  return n + plainLength(s.slice(last));
}
