"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtSlot } from "@/core/slots";
import type { Delivery, Post } from "@/core/types";
import { api, errMsg } from "./api";
import { useApi } from "./hooks";
import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { PlatformPill, PlatformPills, StatusPill } from "./Pill";
import { PLATFORM_NAME } from "./Pill";
import { checkPost, mediaUrl } from "./format";

type Dly = Pick<Delivery, "platform" | "status" | "url" | "error" | "publishedAt">;

/** Details, checks, deliveries and actions for one post. `onChanged` fires after any change. */
export function PostDrawer(props: { post: Post | null; tz: string; onClose: () => void; onChanged: () => void }) {
  return props.post ? <Inner key={props.post.id} {...props} post={props.post} /> : null;
}

function Inner({ post, tz, onClose, onChanged }: { post: Post; tz: string; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checks = useMemo(() => checkPost(post), [post]);
  const sent = post.status === "posted" || post.status === "failed" || post.status === "posting";
  const { data: history } = useApi<(Post & { deliveries: Dly[] })[]>(sent ? "/api/history?limit=500" : null);
  const deliveries = history?.find((p) => p.id === post.id)?.deliveries ?? [];

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); onChanged(); onClose(); } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  };

  const canApprove = (post.status === "draft" || post.status === "needs_approval") && !checks.some((c) => c.level === "error");
  const canUnschedule = post.status === "approved";
  const canEdit = post.status !== "posting" && post.status !== "posted";
  const canDelete = post.status !== "posting";

  return (
    <Drawer open title={<span className="row"><StatusPill status={post.status} /><span className="muted num" style={{ fontWeight: 400 }}>{fmtSlot(post.slotAt, tz)}</span></span>} onClose={onClose}
      footer={<>
        {canEdit ? <Link className="btn" href={`/compose?id=${post.id}`}>Edit</Link> : <Button disabled>Edit</Button>}
        <Button variant="primary" disabled={!canApprove || busy} onClick={() => run(() => api(`/api/posts/${post.id}/approve`, { method: "POST" }))}>Approve</Button>
        <Button disabled={!canUnschedule || busy} onClick={() => run(() => api(`/api/posts/${post.id}/unschedule`, { method: "POST" }))}>Unschedule</Button>
        <Button variant="danger" disabled={!canDelete || busy} onClick={() => { if (confirm("Delete this post?")) run(() => api(`/api/posts/${post.id}`, { method: "DELETE" })); }}>Delete</Button>
      </>}>
      {error && <p className="msg err" role="alert">{error}</p>}
      <p className="caption-full">{post.caption || <span className="muted">(no caption)</span>}</p>
      <dl className="stack" style={{ gap: "var(--space-2)" }}>
        <div className="kv"><dt>Platforms</dt><dd>{post.platforms.length ? <PlatformPills platforms={post.platforms} /> : <span className="muted">none</span>}</dd></div>
        <div className="kv"><dt>Source</dt><dd>{post.source}</dd></div>
        {Object.entries(post.perPlatform).filter(([, t]) => t).map(([p, t]) => (
          <div className="kv" key={p}><dt>{PLATFORM_NAME[p as keyof typeof PLATFORM_NAME]} text</dt><dd className="caption-full">{t}</dd></div>
        ))}
      </dl>
      {post.media.length > 0 && (
        <div className="row">{post.media.map((m) => (
          m.kind === "image"
            // eslint-disable-next-line @next/next/no-img-element
            ? <img key={m.id} className="thumb" src={mediaUrl(m)} alt={m.alt ?? ""} />
            : <span key={m.id} className="chip">video</span>
        ))}</div>
      )}
      <div className="stack" style={{ gap: "var(--space-2)" }}>
        <span className="label">Checks</span>
        {checks.length === 0 ? <span className="checklist"><span className="g">✓ All checks pass</span></span> : (
          <ul className="checklist">{checks.map((c, i) => (
            <li key={i} className={c.level === "error" ? "e" : "w"}><span className="ico">{c.level === "error" ? "✕" : "!"}</span>{c.message}</li>
          ))}</ul>
        )}
      </div>
      {deliveries.length > 0 && (
        <div className="stack" style={{ gap: "var(--space-2)" }}>
          <span className="label">Deliveries</span>
          {deliveries.map((d) => (
            <div key={d.platform} className="row nowrap"><PlatformPill platform={d.platform} />
              <span className={d.status === "failed" ? "err" : "muted"}>{d.status}</span>
              {d.url && <a className="link" href={d.url} target="_blank" rel="noreferrer">view</a>}
              {d.error && <span className="err grow">{d.error}</span>}
            </div>
          ))}
        </div>
      )}
    </Drawer>
  );
}
