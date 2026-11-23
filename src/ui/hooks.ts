"use client";

import { useCallback, useEffect, useState } from "react";
import { api, errMsg } from "./api";
import type { AppSettings } from "./format";

/** Load JSON from the API; `reload` refetches. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    api<T>(path).then((d) => { if (live) { setData(d); setError(null); } }).catch((e) => { if (live) setError(errMsg(e)); });
    return () => { live = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload, setData };
}

export const useSettings = () => useApi<AppSettings>("/api/settings");
