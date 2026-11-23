/** App settings: one JSON value per key in the `settings` table. Server-side. */

import { z } from "zod";
import { PLATFORMS, type Platform } from "./types";

export interface Settings {
  /** IANA timezone slots and the calendar use. */
  tz: string;
  /** Slot wall-clock times, "HH:MM". */
  slotTimes: string[];
  /** A slot must be at least this many minutes away to be offered. */
  minLeadMinutes: number;
  /** auto: webhook drafts are booked straight away; ui: approve in the app; email: a review email goes out. */
  approval: "auto" | "ui" | "email";
  reviewEmail: string | null;
  defaultPlatforms: Platform[];
}

export function defaultSettings(): Settings {
  return {
    tz: (typeof process !== "undefined" && process.env.TZ) || "UTC",
    slotTimes: ["09:00", "13:00", "18:00", "21:00"],
    minLeadMinutes: 20,
    approval: "ui",
    reviewEmail: null,
    defaultPlatforms: [],
  };
}

const validTz = (tz: string) => {
  try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
};

export const settingsSchema = z.object({
  tz: z.string().refine(validTz, "Unknown timezone (use an IANA name such as Europe/London)"),
  slotTimes: z.array(z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Times look like 09:00")).min(1).max(24)
    .transform((a) => [...new Set(a)].sort()),
  minLeadMinutes: z.number().int().min(0).max(10080),
  approval: z.enum(["auto", "ui", "email"]),
  reviewEmail: z.union([z.literal("").transform(() => null), z.email().nullable()]),
  defaultPlatforms: z.array(z.enum(PLATFORMS)).transform((a) => [...new Set(a)]),
});

export const settingsPatchSchema = settingsSchema.partial().strict();

export interface SettingsStore {
  getSettings(): Promise<Settings>;
  saveSettings(patch: Partial<Settings>): Promise<Settings>;
}
