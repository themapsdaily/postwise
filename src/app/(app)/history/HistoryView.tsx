"use client";

import { Fragment, useState } from "react";
import { fmtTime, localParts } from "@/core/slots";
import type { Delivery, Post } from "@/core/types";
import { Card } from "@/ui/Card";
import { useApi, useSettings } from "@/ui/hooks";
import { PlatformPill, Pill, StatusPill } from "@/ui/Pill";
import { Segmented } from "@/ui/Segmented";
import { dayLabel, firstLine } from "@/ui/format";

type Dly = Pick<Delivery, "platform" | "status" | "url" | "error" | "publishedAt">;
type Row = Post & { deliveries: Dly[] };
type Filter = "all" | "posted" | "failed";

export function HistoryView() {
  const { data: settings } = useSettings();
  const { data: rows, error } = useApi<Row[]>("/api/history?limit=200");
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const tz = settings?.tz ?? "UTC";
  const shown = (rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const count = (f: Filter) => (rows ?? []).filter((r) => f === "all" || r.status === f).length;

  return (
    <>
      <div className="page-head">
        <h1>History</h1>
        <span className="grow" />
        <Segmented label="Filter" value={filter} onChange={setFilter} options={[
          { value: "all", label: `All ${rows ? count("all") : ""}` }, { value: "posted", label: `Posted ${rows ? count("posted") : ""}`, disabled: rows != null && count("posted") === 0 },
          { value: "failed", label: `Failed ${rows ? count("failed") : ""}`, disabled: rows != null && count("failed") === 0 },
        ]} />
      </div>
      {error && <p className="msg err" role="alert">{error}</p>}
      <Card>
        {rows && shown.length === 0 && <p className="empty">Nothing has been posted yet.</p>}
        {shown.length > 0 && (
          <div className="tbl-wrap">
            <table className="tbl">
              <thead><tr><th>When</th><th>Caption</th><th>Result</th><th aria-label="Details" /></tr></thead>
              <tbody>
                {shown.map((r) => {
                  const when = r.slotAt ?? r.updatedAt;
                  const lp = localParts(when, tz);
                  const isOpen = open === r.id;
                  return (
                    <Fragment key={r.id}>
                      <tr>
                        <td className="num" style={{ whiteSpace: "nowrap" }}>{dayLabel(lp.date)} <span className="muted">{fmtTime(lp.time)}</span></td>
                        <td><div className="cap">{firstLine(r)}</div></td>
                        <td>
                          <div className="row">
                            {r.deliveries.length === 0 && <StatusPill status={r.status} />}
                            {r.deliveries.map((d) => d.status === "posted" && d.url
                              ? <a key={d.platform} className="row link" href={d.url} target="_blank" rel="noreferrer" style={{ gap: "var(--space-1)" }}><PlatformPill platform={d.platform} />view</a>
                              : <span key={d.platform} className="row" style={{ gap: "var(--space-1)" }}><PlatformPill platform={d.platform} /><Pill tone={d.status === "posted" ? "ok" : "danger"}>{d.status === "posted" ? "posted" : d.error ? d.error.slice(0, 40) + (d.error.length > 40 ? "…" : "") : d.status}</Pill></span>)}
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <button className="btn sm ghost" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>{isOpen ? "Hide" : "Details"}</button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr><td colSpan={4} style={{ background: "var(--surface-2)" }}>
                          <div className="stack">
                            <p className="caption-full">{r.caption}</p>
                            {r.deliveries.map((d) => (
                              <div key={d.platform} className="row nowrap" style={{ alignItems: "flex-start" }}>
                                <PlatformPill platform={d.platform} />
                                <span className={d.status === "failed" ? "err" : "muted"}>{d.status}{d.error ? `: ${d.error}` : ""}</span>
                              </div>
                            ))}
                          </div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
