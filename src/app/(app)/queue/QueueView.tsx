"use client";

import { useState } from "react";
import { fmtSlot } from "@/core/slots";
import type { Post } from "@/core/types";
import { api, errMsg } from "@/ui/api";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { useApi, useSettings } from "@/ui/hooks";
import { PlatformPills, StatusPill } from "@/ui/Pill";
import { PostDrawer } from "@/ui/PostDrawer";
import { checkPost, firstLine, hasErrors, summarize } from "@/ui/format";

export function QueueView() {
  const { data: settings } = useSettings();
  const { data: posts, error, reload } = useApi<Post[]>("/api/posts?status=draft,needs_approval,approved,posting");
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const tz = settings?.tz ?? "UTC";

  const waiting = (posts ?? []).filter((p) => p.status === "draft" || p.status === "needs_approval");
  const scheduled = (posts ?? []).filter((p) => p.status === "approved" || p.status === "posting")
    .sort((a, b) => Date.parse(a.slotAt ?? "") - Date.parse(b.slotAt ?? ""));

  async function act(id: string, action: "approve" | "unschedule") {
    setBusy(id); setActionErr(null);
    try { await api(`/api/posts/${id}/${action}`, { method: "POST" }); reload(); } catch (e) { setActionErr(errMsg(e)); }
    setBusy(null);
  }

  const row = (p: Post) => {
    const results = checkPost(p);
    const s = summarize(results);
    return (
      <div className="qrow" key={p.id}>
        <div className="stack" style={{ gap: "var(--space-2)" }}>
          <button className="linkbtn" onClick={() => setOpenId(p.id)}><span className="cap">{firstLine(p)}</span></button>
          <div className="row">
            <PlatformPills platforms={p.platforms} />
            <StatusPill status={p.status} />
            <span className="note num">{p.slotAt ? fmtSlot(p.slotAt, tz) : "No slot"}</span>
            <span className={`note ${s.ok ? "" : "err"}`} style={s.ok ? { color: "var(--ok)" } : undefined}>{s.text}</span>
          </div>
        </div>
        <div className="qact">
          {p.status === "approved"
            ? <Button size="sm" disabled={busy === p.id} onClick={() => act(p.id, "unschedule")}>Unschedule</Button>
            : p.status === "posting" ? null
            : <Button size="sm" variant="primary" disabled={busy === p.id || hasErrors(results)} title={hasErrors(results) ? "Fix the issues first" : "Books the next free slot"} onClick={() => act(p.id, "approve")}>Approve</Button>}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-head"><h1>Queue</h1></div>
      {(error || actionErr) && <p className="msg err" role="alert">{actionErr ?? error}</p>}
      <div className="cols-2">
        <Card title={`Needs approval / drafts (${waiting.length})`}>
          {posts && waiting.length === 0 && <p className="empty">Nothing waiting.</p>}
          {waiting.map(row)}
        </Card>
        <Card title={`Scheduled (${scheduled.length})`}>
          {posts && scheduled.length === 0 && <p className="empty">Nothing scheduled.</p>}
          {scheduled.map(row)}
        </Card>
      </div>
      <PostDrawer post={(posts ?? []).find((p) => p.id === openId) ?? null} tz={tz} onClose={() => setOpenId(null)} onChanged={reload} />
    </>
  );
}
