"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { countFor, limitsFor } from "@/checks";
import { fmtSlot, localParts, zonedToUtc, type Slot } from "@/core/slots";
import { textFor } from "@/core/adapter";
import { PLATFORMS, type Media, type Platform, type Post } from "@/core/types";
import { api, errMsg } from "@/ui/api";
import { Button } from "@/ui/Button";
import { Card, CardBody } from "@/ui/Card";
import { Counter } from "@/ui/Counter";
import { useApi, useSettings } from "@/ui/hooks";
import { PLATFORM_GLYPH, PLATFORM_NAME, PlatformPill } from "@/ui/Pill";
import { Segmented } from "@/ui/Segmented";
import { checkPost, mediaUrl, type AppSettings } from "@/ui/format";

type Mode = "next" | "slot" | "exact";

export function ComposeView({ id, slot }: { id?: string; slot?: string }) {
  const { data: settings, error: sErr } = useSettings();
  const { data: post, error: pErr } = useApi<Post>(id ? `/api/posts/${id}` : null);
  const { data: slots } = useApi<Slot[]>("/api/slots?count=24");
  const err = sErr ?? pErr;
  if (err) return <p className="msg err" role="alert">{err}</p>;
  if (!settings || !slots || (id && !post)) return <p className="muted">Loading…</p>;
  return <Editor key={post?.id ?? "new"} settings={settings} slots={slots} post={post} slot={slot} />;
}

interface Upload { key: string; name: string; pct: number; error?: string }

function uploadFile(file: File, onPct: (n: number) => void): Promise<Media> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/media");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onPct(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      let body: { error?: string } & Partial<Media> = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* keep empty */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as Media); else reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    const fd = new FormData();
    fd.append("file", file);
    xhr.send(fd);
  });
}

const toLocalInput = (iso: string, tz: string) => { const p = localParts(iso, tz); return `${p.date}T${p.time}`; };

function Editor({ settings, slots, post, slot }: { settings: AppSettings; slots: Slot[]; post: Post | null; slot?: string }) {
  const router = useRouter();
  const tz = settings.tz;
  const [caption, setCaption] = useState(post?.caption ?? "");
  const [platforms, setPlatforms] = useState<Platform[]>(post?.platforms ?? settings.defaultPlatforms);
  const [over, setOver] = useState<Partial<Record<Platform, string>>>(post?.perPlatform ?? {});
  const [media, setMedia] = useState<Media[]>(post?.media ?? []);
  const [tab, setTab] = useState<"main" | Platform>("main");
  const [mode, setMode] = useState<Mode>(slot || post?.slotAt ? "slot" : "next");
  const [chosen, setChosen] = useState<string | null>(slot ?? post?.slotAt ?? null);
  const [exact, setExact] = useState(post?.slotAt ? toLocalInput(post.slotAt, tz) : "");
  const [shownSlots, setShownSlots] = useState(8);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "approve">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const locked = post?.status === "posting" || post?.status === "posted";

  const activeOver = Object.fromEntries(Object.entries(over).filter(([p, t]) => t && platforms.includes(p as Platform))) as Partial<Record<Platform, string>>;
  const draft: Post = {
    id: post?.id ?? "new", status: post?.status ?? "draft", caption, perPlatform: activeOver, platforms, media,
    slotAt: null, source: "manual", meta: {}, createdAt: "", updatedAt: "",
  };
  const results = checkPost(draft);
  const errors = results.filter((r) => r.level === "error");

  const slotList: Slot[] = chosen && !slots.some((s) => s.at === chosen)
    ? [{ at: chosen, date: "", time: "", label: fmtSlot(chosen, tz) }, ...slots] : slots;
  const exactIso = exact ? zonedToUtc(exact.slice(0, 10), exact.slice(11, 16), tz) : null;
  const exactPast = exactIso != null && Date.parse(exactIso) < Date.now();
  const slotAt = mode === "slot" ? chosen : mode === "exact" ? exactIso : null;

  let blocker: string | null = null;
  if (locked) blocker = `A ${post?.status} post cannot be changed`;
  else if (errors.length) blocker = errors[0].message;
  else if (mode === "slot" && !chosen) blocker = "Pick a slot";
  else if (mode === "exact" && !exactIso) blocker = "Choose a date and time";
  else if (mode === "exact" && exactPast) blocker = "That time is in the past";
  else if (uploads.some((u) => !u.error)) blocker = "Wait for uploads to finish";

  function togglePlatform(p: Platform) {
    setPlatforms((cur) => {
      const next = cur.includes(p) ? cur.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || cur.includes(x));
      if (tab === p && !next.includes(p)) setTab("main");
      return next;
    });
  }

  async function addFiles(files: FileList | File[]) {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${Math.random().toString(36).slice(2)}`;
      setUploads((u) => [...u, { key, name: file.name, pct: 0 }]);
      try {
        const m = await uploadFile(file, (pct) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct } : x))));
        setMedia((cur) => [...cur, m]);
        setUploads((u) => u.filter((x) => x.key !== key));
      } catch (e) {
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: errMsg(e) } : x)));
      }
    }
  }

  const move = (i: number, d: -1 | 1) => setMedia((m) => { const n = [...m]; [n[i], n[i + d]] = [n[i + d], n[i]]; return n; });
  const setAlt = (i: number, alt: string) => setMedia((m) => m.map((x, j) => (j === i ? { ...x, alt: alt || undefined } : x)));

  async function save(approve: boolean) {
    setBusy(approve ? "approve" : "save"); setError(null); setSaved(null);
    try {
      const body = { caption, platforms, perPlatform: activeOver, media, slotAt: approve ? slotAt : mode === "next" ? null : slotAt };
      const saved = post
        ? await api<Post>(`/api/posts/${post.id}`, { method: "PATCH", body })
        : await api<Post>("/api/posts", { method: "POST", body });
      if (approve) {
        await api(`/api/posts/${saved.id}/approve`, { method: "POST", body: slotAt ? { slotAt } : {} });
        router.push("/calendar");
        return;
      }
      if (!post) router.replace(`/compose?id=${saved.id}`);
      else setSaved("Saved");
    } catch (e) { setError(errMsg(e)); }
    setBusy(null);
  }

  const tabs: { value: "main" | Platform; label: string }[] = [{ value: "main", label: "Main" }, ...platforms.map((p) => ({ value: p, label: PLATFORM_GLYPH[p] }))];
  const tabPlatform = tab === "main" ? null : tab;

  return (
    <>
      <div className="page-head">
        <h1>{post ? "Edit post" : "Compose"}</h1>
        {post && <span className="muted grow">{post.status.replace("_", " ")}{post.slotAt ? `, ${fmtSlot(post.slotAt, tz)}` : ""}</span>}
      </div>
      <div className="compose-grid">
        <div className="stack">
          <Card>
            <CardBody>
              <div className="field">
                <span className="label">Platforms</span>
                <div className="row" role="group" aria-label="Platforms">
                  {PLATFORMS.map((p) => (
                    <button key={p} type="button" className="pill plat" aria-pressed={platforms.includes(p)} onClick={() => togglePlatform(p)} title={PLATFORM_NAME[p]} disabled={locked}>
                      {PLATFORM_GLYPH[p]} <span className="sr">{PLATFORM_NAME[p]}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <div className="row">
                  <div className="tabs grow">
                    {platforms.length > 0 && <div className="seg sm" role="group" aria-label="Text version">
                      {tabs.map((t) => (
                        <button key={t.value} type="button" aria-pressed={tab === t.value} onClick={() => setTab(t.value)}>{t.label}</button>
                      ))}
                    </div>}
                  </div>
                  {tabPlatform
                    ? <Counter count={countFor(tabPlatform, textFor(draft, tabPlatform))} max={limitsFor(tabPlatform)} />
                    : platforms.map((p) => !activeOver[p] && <span key={p} className="row" style={{ gap: "var(--space-1)" }}><PlatformPill platform={p} /><Counter count={countFor(p, caption)} max={limitsFor(p)} /></span>)}
                </div>
                {tabPlatform ? (
                  <>
                    <label className="sr" htmlFor="ov">{PLATFORM_NAME[tabPlatform]} text</label>
                    <textarea id="ov" className="textarea" disabled={locked} value={over[tabPlatform] ?? ""} placeholder="Empty: this platform uses the main caption"
                      onChange={(e) => setOver((o) => ({ ...o, [tabPlatform]: e.target.value }))} />
                    {over[tabPlatform] ? <div><Button size="sm" variant="ghost" onClick={() => setOver((o) => ({ ...o, [tabPlatform]: undefined }))}>Use main caption</Button></div> : null}
                  </>
                ) : (
                  <>
                    <label className="sr" htmlFor="cap">Caption</label>
                    <textarea id="cap" className="textarea" disabled={locked} value={caption} placeholder="Write your post" onChange={(e) => setCaption(e.target.value)} />
                  </>
                )}
              </div>
            </CardBody>
          </Card>

          <Card title="Media">
            <CardBody>
              <div className={`dropzone ${dragging ? "over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); if (!locked) addFiles(e.dataTransfer.files); }}>
                <span>Drop images or video here</span>
                <input ref={fileRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} aria-label="Choose files" />
                <Button size="sm" disabled={locked} onClick={() => fileRef.current?.click()}>Choose files</Button>
              </div>
              {uploads.map((u) => (
                <div key={u.key} className="stack" style={{ gap: "var(--space-1)" }}>
                  <div className="row"><span className="grow">{u.name}</span>{u.error ? <><span className="err">{u.error}</span><Button size="sm" variant="ghost" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>Dismiss</Button></> : <span className="note num">{u.pct}%</span>}</div>
                  {!u.error && <div className="progress"><i style={{ width: `${u.pct}%` }} /></div>}
                </div>
              ))}
              {media.length > 0 && (
                <div className="media-list">
                  {media.map((m, i) => (
                    <div className="media-item" key={m.id}>
                      {m.kind === "image"
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img className="thumb" src={mediaUrl(m)} alt={m.alt ?? ""} />
                        : <video className="thumb" src={mediaUrl(m)} muted />}
                      <div className="field">
                        <label className="sr" htmlFor={`alt-${m.id}`}>Alt text for item {i + 1}</label>
                        <input id={`alt-${m.id}`} className="input" placeholder="Alt text" value={m.alt ?? ""} maxLength={1500} disabled={locked} onChange={(e) => setAlt(i, e.target.value)} />
                      </div>
                      <div className="row nowrap" style={{ gap: "var(--space-1)" }}>
                        <Button size="sm" icon aria-label="Move up" disabled={i === 0 || locked} onClick={() => move(i, -1)}>↑</Button>
                        <Button size="sm" icon aria-label="Move down" disabled={i === media.length - 1 || locked} onClick={() => move(i, 1)}>↓</Button>
                        <Button size="sm" icon variant="danger" aria-label="Remove" disabled={locked} onClick={() => setMedia((x) => x.filter((_, j) => j !== i))}>✕</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card title="Schedule">
            <CardBody>
              <Segmented label="Schedule" value={mode} onChange={setMode} options={[
                { value: "next", label: "Next free slot" }, { value: "slot", label: "Pick slot" }, { value: "exact", label: "Exact time" },
              ]} />
              {mode === "next" && <p className="note">{slots[0] ? `Books ${slots[0].label}.` : "No free slot: add slot times in Settings."}</p>}
              {mode === "slot" && (
                <div className="slot-chips" role="group" aria-label="Slots">
                  {slotList.slice(0, shownSlots).map((s) => <button key={s.at} type="button" className="chip" aria-pressed={chosen === s.at} onClick={() => setChosen(s.at)}>{s.label}</button>)}
                  {shownSlots < slotList.length && <button type="button" className="chip" onClick={() => setShownSlots((n) => n + 8)}>More</button>}
                </div>
              )}
              {mode === "exact" && (
                <div className="field" style={{ maxWidth: 260 }}>
                  <label htmlFor="exact"><span className="label">Date and time ({tz})</span></label>
                  <input id="exact" className="input num" type="datetime-local" value={exact} onChange={(e) => setExact(e.target.value)} />
                  {exactPast && <span className="err">That time is in the past.</span>}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="stack">
            {error && <p className="msg err" role="alert">{error}</p>}
            {saved && <p className="msg ok" role="status">{saved}</p>}
            <div className="row">
              <Button disabled={!!busy || locked} onClick={() => save(false)}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
              <Button variant="primary" disabled={!!busy || !!blocker} onClick={() => save(true)}>{busy === "approve" ? "Scheduling…" : "Approve & schedule"}</Button>
              {blocker && <span className="note" role="status">{blocker}</span>}
            </div>
          </div>
        </div>

        <div className="stack sticky">
          <Card title="Checks">
            <CardBody>
              {results.length === 0 ? <span className="checklist"><span className="g">✓ All checks pass</span></span> : (
                <ul className="checklist">{results.map((c, i) => (
                  <li key={i} className={c.level === "error" ? "e" : "w"}><span className="ico">{c.level === "error" ? "✕" : "!"}</span>{c.message}</li>
                ))}</ul>
              )}
            </CardBody>
          </Card>
          {platforms.length === 0 && <Card title="Preview"><p className="empty">Pick a platform to preview.</p></Card>}
          {platforms.map((p) => {
            const text = textFor(draft, p);
            const img = media.find((m) => m.kind === "image");
            return (
              <Card key={p} className="preview-card">
                <div className="preview">
                  <div className="row"><PlatformPill platform={p} /><span className="grow muted">{PLATFORM_NAME[p]}</span><Counter count={countFor(p, text)} max={limitsFor(p)} /></div>
                  <div className="txt">{text || <span className="muted">(empty)</span>}</div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {img && <img src={mediaUrl(img)} alt={img.alt ?? ""} />}
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </>
  );
}
