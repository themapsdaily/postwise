/** Adapter registry. Task 4 fills this in; the worker reads it. */
import type { Adapter } from "../core/adapter";
import type { Platform } from "../core/types";

export const adapters: Partial<Record<Platform, Adapter>> = {};
