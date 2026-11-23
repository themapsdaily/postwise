/**
 * Post slots: the times of day posts go out, in the user's timezone. Pure and
 * client-safe, so the calendar, the composer and the approval email offer the
 * same slots. Posts store their slot as a UTC instant (`slotAt`); this file is
 * the only place that converts between that and wall-clock time.
 */

export interface SlotConfig {
  /** IANA timezone, e.g. "Europe/London", "Asia/Kolkata". */
  tz: string;
  /** Wall-clock times, "HH:MM", in order. */
  times: string[];
  /** A slot must be at least this many minutes away to be offered. */
  minLeadMinutes?: number;
}

export const DEFAULT_SLOTS: SlotConfig = { tz: "UTC", times: ["09:00", "13:00", "18:00", "21:00"], minLeadMinutes: 20 };

export interface Slot {
  /** UTC ISO instant. */
  at: string;
  /** Wall-clock date and time in the config's timezone. */
  date: string;
  time: string;
  /** "Today 6:00 PM", "Wed 14 Oct, 9:00 AM". */
  label: string;
}

const HM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY_MS = 864e5;

/** Wall-clock parts of an instant in `tz`. */
export function localParts(instant: Date | string, tz: string): { date: string; time: string; weekday: number } {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

/** Offset of `tz` from UTC at an instant, in ms (positive east of UTC). */
function offsetMs(utcMs: number, tz: string): number {
  const { date, time } = localParts(new Date(utcMs), tz);
  return Date.parse(`${date}T${time}:00Z`) - Math.floor(utcMs / 60000) * 60000;
}

/**
 * The UTC instant of a wall-clock date and time in `tz`. A time skipped by a
 * DST jump (02:30 on a spring-forward night) lands just after the jump; a time
 * that happens twice (autumn) takes the first.
 */
export function zonedToUtc(date: string, time: string, tz: string): string {
  const wall = Date.parse(`${date}T${time}:00Z`);
  // The offsets a day either side cover both sides of any DST change that day.
  const before = wall - offsetMs(wall - DAY_MS, tz);
  const after = wall - offsetMs(wall + DAY_MS, tz);
  const reads = (ms: number) => { const p = localParts(new Date(ms), tz); return p.date === date && p.time === time; };
  const hits = [before, after].filter(reads);
  // Both read back (autumn overlap): the earlier. Neither (spring gap): the
  // pre-change offset, which lands just after the jump.
  return new Date(hits.length ? Math.min(...hits) : before).toISOString();
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

export function fmtTime(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** "Today 6:00 PM", "Tomorrow 9:00 AM", "Wed 14 Oct, 9:00 AM", in `tz`. */
export function fmtSlot(at: string | null, tz: string, now = new Date()): string {
  if (!at) return "No slot";
  const { date, time } = localParts(at, tz);
  const today = localParts(now, tz).date;
  const t = fmtTime(time);
  if (date === today) return `Today ${t}`;
  if (date === addDays(today, 1)) return `Tomorrow ${t}`;
  const d = new Date(`${date}T00:00:00Z`);
  const wd = d.toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
  const mon = d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  return `${wd} ${d.getUTCDate()} ${mon}, ${t}`;
}

function validTimes(cfg: SlotConfig): string[] {
  return [...new Set(cfg.times.filter((t) => HM.test(t)))].sort();
}

/** The next `count` free slots, at least `minLeadMinutes` out, soonest first. `taken` holds UTC ISO instants. */
export function nextSlots(cfg: SlotConfig, count: number, taken = new Set<string>(), now = new Date()): Slot[] {
  const out: Slot[] = [];
  const cut = now.getTime() + (cfg.minLeadMinutes ?? 20) * 60_000;
  const today = localParts(now, cfg.tz).date;
  const times = validTimes(cfg);
  for (let day = 0; out.length < count && day < 60 && times.length; day++) {
    const date = addDays(today, day);
    for (const time of times) {
      if (out.length >= count) break;
      const at = zonedToUtc(date, time, cfg.tz);
      if (Date.parse(at) < cut || taken.has(at)) continue;
      out.push({ at, date, time, label: fmtSlot(at, cfg.tz, now) });
    }
  }
  return out;
}

/** The first free slot on a wall-clock `date`, or null when the day is full or past. */
export function freeSlotOn(cfg: SlotConfig, date: string, taken = new Set<string>(), now = new Date()): string | null {
  const cut = now.getTime() + (cfg.minLeadMinutes ?? 20) * 60_000;
  for (const time of validTimes(cfg)) {
    const at = zonedToUtc(date, time, cfg.tz);
    if (Date.parse(at) >= cut && !taken.has(at)) return at;
  }
  return null;
}

/** Has this post's slot arrived? A post with no slot is never due. */
export function isDue(post: { slotAt: string | null }, now = new Date()): boolean {
  return !!post.slotAt && Date.parse(post.slotAt) <= now.getTime();
}

/**
 * A typed time: "18:30", "6pm", "6:30 pm", "tomorrow 9am", "tomorrow 9:15".
 * A time already past today rolls to tomorrow. Returns a UTC ISO instant, or
 * null when it isn't a time.
 */
export function parseTypedSlot(text: string, tz: string, now = new Date()): string | null {
  const s = text.trim().toLowerCase();
  const m = s.match(/^(today|tomorrow|tmrw)?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  // A bare number ("8") is too easy to send by accident.
  if (!m || (!m[1] && m[3] == null && !m[4])) return null;
  let h = Number(m[2]);
  const min = Number(m[3] ?? 0);
  if (m[4] && (h < 1 || h > 12)) return null;
  if (m[4] === "pm" && h < 12) h += 12;
  if (m[4] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  const time = `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  const local = localParts(now, tz);
  const later = m[1] === "tomorrow" || m[1] === "tmrw" || (m[1] !== "today" && time <= local.time);
  return zonedToUtc(later ? addDays(local.date, 1) : local.date, time, tz);
}
