"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtTime, localParts, zonedToUtc } from "@/core/slots";
import type { Post } from "@/core/types";
import { Button } from "@/ui/Button";
import { useApi, useSettings } from "@/ui/hooks";
import { PlatformPills, statusLabel } from "@/ui/Pill";
import { PostDrawer } from "@/ui/PostDrawer";
import { Segmented } from "@/ui/Segmented";
import { addDays, dayLabel, firstLine, todayIn, weekStart } from "@/ui/format";

type View = "week" | "month";

export function CalendarView() {
  const { data: settings, error: sErr } = useSettings();
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const tz = settings?.tz ?? "UTC";
  const today = settings ? todayIn(tz) : null;
  const cur = anchor ?? today;

  const range = useMemo(() => {
    if (!cur) return null;
    if (view === "week") { const s = weekStart(cur); return { start: s, end: addDays(s, 7) }; }
    const first = `${cur.slice(0, 7)}-01`;
    const s = weekStart(first);
    const next = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7), 1)).toISOString().slice(0, 10);
    const e = addDays(weekStart(addDays(next, -1)), 7);
    return { start: s, end: e };
  }, [cur, view]);

  const path = range && settings ? `/api/posts?from=${encodeURIComponent(zonedToUtc(range.start, "00:00", tz))}&to=${encodeURIComponent(zonedToUtc(range.end, "00:00", tz))}` : null;
  const { data: posts, error, reload } = useApi<Post[]>(path);

  const byDay = useMemo(() => {
    const m = new Map<string, Post[]>();
    for (const p of posts ?? []) {
      if (!p.slotAt) continue;
      const d = localParts(p.slotAt, tz).date;
      m.set(d, [...(m.get(d) ?? []), p]);
    }
    return m;
  }, [posts, tz]);

  const open = posts?.find((p) => p.id === openId) ?? null;

  function step(dir: -1 | 1) {
    if (!cur) return;
    if (view === "week") setAnchor(addDays(cur, 7 * dir));
    else { const d = new Date(Date.UTC(+cur.slice(0, 4), +cur.slice(5, 7) - 1 + dir, 1)); setAnchor(d.toISOString().slice(0, 10)); }
  }

  const title = !cur || !range ? "" : view === "week"
    ? `${dayLabel(range.start, { day: "numeric", month: "short" })} – ${dayLabel(addDays(range.start, 6), { day: "numeric", month: "short", year: "numeric" })}`
    : dayLabel(cur, { month: "long", year: "numeric" });

  return (
    <>
      <div className="page-head">
        <h1>Calendar</h1>
        <span className="muted num grow">{title}</span>
        <div className="row">
          <Segmented label="View" value={view} onChange={setView} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
          <div className="row" style={{ gap: "var(--space-1)" }}>
            <Button icon aria-label="Previous" onClick={() => step(-1)}>‹</Button>
            <Button onClick={() => setAnchor(null)}>Today</Button>
            <Button icon aria-label="Next" onClick={() => step(1)}>›</Button>
          </div>
        </div>
      </div>
      {(sErr || error) && <p className="msg err" role="alert">{sErr ?? error}</p>}
      {settings && cur && range && today && (view === "week"
        ? <WeekGrid start={range.start} today={today} tz={tz} times={settings.slotTimes} byDay={byDay} onOpen={setOpenId} />
        : <MonthGrid month={cur.slice(0, 7)} start={range.start} end={range.end} today={today} byDay={byDay} onPick={(d) => { setAnchor(d); setView("week"); }} />)}
      <PostDrawer post={open} tz={tz} onClose={() => setOpenId(null)} onChanged={reload} />
    </>
  );
}

function Chip({ post, onOpen }: { post: Post; onOpen: (id: string) => void }) {
  return (
    <button className={`postchip s-${post.status}`} onClick={() => onOpen(post.id)} title={`${statusLabel(post.status)}: ${firstLine(post)}`}>
      <span className="cap">{firstLine(post)}</span>
      <span className="pl"><PlatformPills platforms={post.platforms} /></span>
    </button>
  );
}

function WeekGrid({ start, today, tz, times, byDay, onOpen }: {
  start: string; today: string; tz: string; times: string[]; byDay: Map<string, Post[]>; onOpen: (id: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
  const [now] = useState(() => Date.now());
  const slotSet = new Set(times);
  return (
    <>
    <div className="cal-wrap weekgrid">
      <div className="week" role="grid" aria-label="Week" style={{ gridTemplateRows: `auto repeat(${times.length}, minmax(58px, 1fr)) minmax(40px, auto)` }}>
        <div className="corner" />
        {days.map((d) => <div key={d} className={`dayhead ${d === today ? "today" : ""}`}>{dayLabel(d, { weekday: "short" })} <span className="num">{dayLabel(d, { day: "numeric" })}</span></div>)}
        {times.map((t) => (
          <Row key={t} label={fmtTime(t)}>
            {days.map((d) => {
              const at = zonedToUtc(d, t, tz);
              const here = (byDay.get(d) ?? []).filter((p) => p.slotAt && localParts(p.slotAt, tz).time === t);
              const future = Date.parse(at) > now;
              return (
                <div key={d} className={`cell ${d === today ? "today" : ""} ${!future && !here.length ? "past" : ""}`}>
                  {here.map((p) => <Chip key={p.id} post={p} onOpen={onOpen} />)}
                  {future && !here.length && <Link className="cell-add" href={`/compose?slot=${encodeURIComponent(at)}`} aria-label={`Compose for ${d} ${fmtTime(t)}`}>+</Link>}
                </div>
              );
            })}
          </Row>
        ))}
        <Row label="Other">
          {days.map((d) => {
            const other = (byDay.get(d) ?? []).filter((p) => !p.slotAt || !slotSet.has(localParts(p.slotAt, tz).time));
            return (
              <div key={d} className={`cell ${d === today ? "today" : ""}`} style={{ minHeight: 40 }}>
                {other.map((p) => <Chip key={p.id} post={p} onOpen={onOpen} />)}
              </div>
            );
          })}
        </Row>
      </div>
    </div>
    <div className="agenda">
      {days.map((d) => {
        const ps = byDay.get(d) ?? [];
        const taken = new Set(ps.map((p) => p.slotAt && localParts(p.slotAt, tz).time));
        const free = times.find((t) => !taken.has(t) && Date.parse(zonedToUtc(d, t, tz)) > now);
        return (
          <section key={d} className="agenda-day">
            <div className={`dayhead ${d === today ? "today" : ""}`}>{dayLabel(d)}</div>
            <div className="agenda-body">
              {[...ps].sort((a, b) => Date.parse(a.slotAt ?? "") - Date.parse(b.slotAt ?? "")).map((p) => (
                <div key={p.id} className="row nowrap"><span className="note num" style={{ width: 56, flex: "none" }}>{p.slotAt ? fmtTime(localParts(p.slotAt, tz).time) : ""}</span><div className="grow"><Chip post={p} onOpen={onOpen} /></div></div>
              ))}
              {free && <Link className="agenda-add" href={`/compose?slot=${encodeURIComponent(zonedToUtc(d, free, tz))}`}>+ Add at {fmtTime(free)}</Link>}
            </div>
          </section>
        );
      })}
    </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <><div className="timecell">{label}</div>{children}</>;
}

function MonthGrid({ month, start, end, today, byDay, onPick }: {
  month: string; start: string; end: string; today: string; byDay: Map<string, Post[]>; onPick: (d: string) => void;
}) {
  const n = Math.round((Date.parse(end) - Date.parse(start)) / 864e5);
  const days = Array.from({ length: n }, (_, i) => addDays(start, i));
  return (
    <div className="cal-wrap">
      <div className="month">
        {days.slice(0, 7).map((d) => <div key={d} className="mhead">{dayLabel(d, { weekday: "short" })}</div>)}
        {days.map((d) => {
          const ps = byDay.get(d) ?? [];
          return (
            <button key={d} className={`mday ${d.slice(0, 7) !== month ? "other" : ""} ${d === today ? "today" : ""}`} onClick={() => onPick(d)}
              aria-label={`${dayLabel(d)}, ${ps.length} posts`}>
              <span className="dn num">{+d.slice(8)}</span>
              {ps.length > 0 && <span className="dots">{ps.slice(0, 12).map((p) => <i key={p.id} className={`dot s-${p.status}`} />)}</span>}
              {ps.length > 0 && <span className="note num">{ps.length}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
