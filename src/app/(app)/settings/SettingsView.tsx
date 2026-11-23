"use client";

import { useMemo, useState } from "react";
import { fmtTime } from "@/core/slots";
import { PLATFORMS, type Platform } from "@/core/types";
import { api, errMsg } from "@/ui/api";
import { Button } from "@/ui/Button";
import { Card, CardBody } from "@/ui/Card";
import { useApi, useSettings } from "@/ui/hooks";
import { PLATFORM_GLYPH, PLATFORM_NAME, Pill } from "@/ui/Pill";
import { Segmented } from "@/ui/Segmented";
import type { AppSettings } from "@/ui/format";

export function SettingsView() {
  const { data, error, setData } = useSettings();
  if (error) return <p className="msg err" role="alert">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const update = (s: Partial<AppSettings>) => setData({ ...data, ...s });
  return (
    <>
      <div className="page-head"><h1>Settings</h1></div>
      <div className="cols-settings">
        <div className="stack">
          <ScheduleCard s={data} onSaved={update} />
          <ApprovalCard s={data} onSaved={update} />
          <PlatformsCard s={data} onSaved={update} />
        </div>
        <div className="stack">
          <AccountsCard />
          <WebhookCard />
        </div>
      </div>
    </>
  );
}

async function save(patch: Partial<AppSettings>): Promise<AppSettings> {
  return api<AppSettings>("/api/settings", { method: "PUT", body: patch });
}

function useSaver(onSaved: (s: Partial<AppSettings>) => void) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function run(patch: Partial<AppSettings>) {
    setBusy(true); setMsg(null);
    try { onSaved(await save(patch)); setMsg({ ok: true, text: "Saved" }); } catch (e) { setMsg({ ok: false, text: errMsg(e) }); }
    setBusy(false);
  }
  return { busy, msg, run };
}

const Msg = ({ msg }: { msg: { ok: boolean; text: string } | null }) => msg ? <span className={msg.ok ? "note" : "err"} role="status">{msg.text}</span> : null;

function ScheduleCard({ s, onSaved }: { s: AppSettings; onSaved: (s: Partial<AppSettings>) => void }) {
  const { busy, msg, run } = useSaver(onSaved);
  const [tz, setTz] = useState(s.tz);
  const [times, setTimes] = useState(s.slotTimes);
  const [lead, setLead] = useState(String(s.minLeadMinutes));
  const [newTime, setNewTime] = useState("");
  const [filter, setFilter] = useState("");
  const zones = useMemo(() => {
    const all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.("timeZone") ?? [];
    return all.includes("UTC") ? all : ["UTC", ...all];
  }, []);
  const shown = zones.filter((z) => z.toLowerCase().includes(filter.trim().toLowerCase().replace(/ /g, "_")) || z === tz);
  const leadN = Number(lead);
  const leadOk = lead.trim() !== "" && Number.isInteger(leadN) && leadN >= 0 && leadN <= 10080;
  const dirty = tz !== s.tz || times.join() !== s.slotTimes.join() || (leadOk && leadN !== s.minLeadMinutes);
  const addTime = () => { if (newTime && !times.includes(newTime)) setTimes([...times, newTime].sort()); setNewTime(""); };

  return (
    <Card title="Schedule" actions={<Msg msg={msg} />}>
      <CardBody>
        <div className="field">
          <label htmlFor="tzf"><span className="label">Timezone</span></label>
          <div className="row nowrap">
            <input id="tzf" className="input" style={{ maxWidth: 140 }} placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <select aria-label="Timezone" className="select" value={tz} onChange={(e) => setTz(e.target.value)}>
              {shown.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <span className="label">Slot times</span>
          <div className="slot-chips">
            {times.map((t) => (
              <span key={t} className="chip">{fmtTime(t)}
                <button type="button" aria-label={`Remove ${fmtTime(t)}`} disabled={times.length <= 1} onClick={() => setTimes(times.filter((x) => x !== t))}>✕</button>
              </span>
            ))}
            <span className="row nowrap" style={{ gap: "var(--space-1)" }}>
              <input aria-label="New slot time" className="input" style={{ width: 110 }} type="time" value={newTime} onChange={(e) => setNewTime(e.target.value)} />
              <Button size="sm" disabled={!newTime || times.includes(newTime) || times.length >= 24} onClick={addTime}>Add</Button>
            </span>
          </div>
        </div>
        <div className="field" style={{ maxWidth: 200 }}>
          <label htmlFor="lead"><span className="label">Minimum lead (minutes)</span></label>
          <input id="lead" className="input num" inputMode="numeric" value={lead} onChange={(e) => setLead(e.target.value)} aria-invalid={!leadOk} />
        </div>
        <div className="row">
          <Button variant="primary" disabled={busy || !dirty || !leadOk} onClick={() => run({ tz, slotTimes: times, minLeadMinutes: leadN })}>Save</Button>
        </div>
      </CardBody>
    </Card>
  );
}

function ApprovalCard({ s, onSaved }: { s: AppSettings; onSaved: (s: Partial<AppSettings>) => void }) {
  const { busy, msg, run } = useSaver(onSaved);
  const [mode, setMode] = useState(s.approval);
  const [email, setEmail] = useState(s.reviewEmail ?? "");
  const emailOk = s.emailConfigured !== false;
  const dirty = mode !== s.approval || (mode === "email" && email !== (s.reviewEmail ?? ""));
  return (
    <Card title="Approval" actions={<Msg msg={msg} />}>
      <CardBody>
        <Segmented label="Approval" value={mode} onChange={setMode} options={[
          { value: "auto", label: "Auto" }, { value: "ui", label: "In app" },
          { value: "email", label: "Email", disabled: !emailOk, title: emailOk ? undefined : "Set SMTP_URL and MAIL_FROM in .env" },
        ]} />
        <p className="note">
          {mode === "auto" ? "Webhook drafts that pass checks are booked straight away." : mode === "ui" ? "Webhook drafts wait in the Queue for you to approve." : "A review email with an approve link goes out for each draft."}
          {!emailOk && " Email needs SMTP_URL and MAIL_FROM set in .env."}
        </p>
        {mode === "email" && (
          <div className="field" style={{ maxWidth: 320 }}>
            <label htmlFor="rev"><span className="label">Review email</span></label>
            <input id="rev" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        )}
        <div className="row"><Button variant="primary" disabled={busy || !dirty || (mode === "email" && !email)} onClick={() => run({ approval: mode, ...(mode === "email" ? { reviewEmail: email } : {}) })}>Save</Button></div>
      </CardBody>
    </Card>
  );
}

function PlatformsCard({ s, onSaved }: { s: AppSettings; onSaved: (s: Partial<AppSettings>) => void }) {
  const { busy, msg, run } = useSaver(onSaved);
  const toggle = (p: Platform) => run({ defaultPlatforms: s.defaultPlatforms.includes(p) ? s.defaultPlatforms.filter((x) => x !== p) : PLATFORMS.filter((x) => x === p || s.defaultPlatforms.includes(x)) });
  return (
    <Card title="Default platforms" actions={<Msg msg={msg} />}>
      <CardBody>
        <div className="row" role="group" aria-label="Default platforms">
          {PLATFORMS.map((p) => (
            <button key={p} type="button" className="pill plat" aria-pressed={s.defaultPlatforms.includes(p)} disabled={busy} onClick={() => toggle(p)} title={PLATFORM_NAME[p]}>
              {PLATFORM_GLYPH[p]} <span className="sr">{PLATFORM_NAME[p]}</span>
            </button>
          ))}
        </div>
        <p className="note">Pre-selected in Compose and used for webhook drafts that name no platform.</p>
      </CardBody>
    </Card>
  );
}

interface Field { key: string; label: string; secret?: boolean; optional?: boolean; placeholder?: string }
const FIELDS: Record<Platform, Field[]> = {
  instagram: [{ key: "accessToken", label: "Access token", secret: true }, { key: "igUserId", label: "Instagram user ID" }, { key: "expiresAt", label: "Expires (ISO date)", optional: true, placeholder: "2026-12-31" }],
  threads: [{ key: "accessToken", label: "Access token", secret: true }, { key: "userId", label: "User ID", optional: true }, { key: "expiresAt", label: "Expires (ISO date)", optional: true, placeholder: "2026-12-31" }],
  x: [{ key: "consumerKey", label: "Consumer key", secret: true }, { key: "consumerSecret", label: "Consumer secret", secret: true }, { key: "accessToken", label: "Access token", secret: true }, { key: "accessTokenSecret", label: "Access token secret", secret: true }],
  bluesky: [{ key: "identifier", label: "Handle or email" }, { key: "appPassword", label: "App password", secret: true }, { key: "service", label: "Service URL", optional: true, placeholder: "https://bsky.social" }],
  mastodon: [{ key: "instance", label: "Instance URL", placeholder: "https://mastodon.social" }, { key: "accessToken", label: "Access token", secret: true }],
};

interface Account { platform: Platform; connected: boolean; expiresAt: string | null }

function AccountsCard() {
  const { data, error, reload } = useApi<Account[]>("/api/accounts");
  const [open, setOpen] = useState<Platform | null>(null);
  return (
    <Card title="Accounts">
      <CardBody>
        {error && <p className="msg err" role="alert">{error}</p>}
        <div>
          {data?.map((a) => <AccountRow key={a.platform} a={a} open={open === a.platform} onToggle={() => setOpen(open === a.platform ? null : a.platform)} onChanged={() => { setOpen(null); reload(); }} />)}
        </div>
      </CardBody>
    </Card>
  );
}

function AccountRow({ a, open, onToggle, onChanged }: { a: Account; open: boolean; onToggle: () => void; onChanged: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fields = FIELDS[a.platform];
  const required = fields.filter((f) => !f.optional);
  const ready = required.every((f) => (vals[f.key] ?? "").trim());
  const [now] = useState(() => Date.now());
  const days = a.expiresAt ? Math.ceil((Date.parse(a.expiresAt) - now) / 864e5) : null;

  async function connect() {
    setBusy(true); setError(null);
    const body = Object.fromEntries(Object.entries(vals).filter(([, v]) => v.trim()).map(([k, v]) => [k, k === "expiresAt" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) ? `${v.trim()}T00:00:00Z` : v.trim()]));
    try { await api(`/api/accounts/${a.platform}`, { method: "PUT", body }); setVals({}); onChanged(); } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }
  async function disconnect() {
    if (!confirm(`Disconnect ${PLATFORM_NAME[a.platform]}?`)) return;
    setBusy(true); setError(null);
    try { await api(`/api/accounts/${a.platform}`, { method: "DELETE" }); onChanged(); } catch (e) { setError(errMsg(e)); }
    setBusy(false);
  }

  return (
    <div className="acct">
      <div className="row nowrap">
        <span className="pill plat">{PLATFORM_GLYPH[a.platform]}</span>
        <span className="grow">{PLATFORM_NAME[a.platform]}</span>
        {a.connected
          ? <Pill tone={days != null && days < 7 ? "warn" : "ok"}>{days == null ? "Connected" : days < 0 ? "Expired" : `Connected, ${days}d left`}</Pill>
          : <Pill>Not connected</Pill>}
        <Button size="sm" aria-expanded={open} onClick={onToggle}>{a.connected ? "Update" : "Connect"}</Button>
        {a.connected && <Button size="sm" variant="danger" disabled={busy} onClick={disconnect}>Disconnect</Button>}
      </div>
      {open && (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); connect(); }} autoComplete="off">
          {fields.map((f) => (
            <div className="field" key={f.key}>
              <label htmlFor={`${a.platform}-${f.key}`}><span className="label">{f.label}{f.optional ? " (optional)" : ""}</span></label>
              <input id={`${a.platform}-${f.key}`} className="input" type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder}
                value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
            </div>
          ))}
          {error && <p className="msg err" role="alert">{error}</p>}
          <div className="row"><Button type="submit" variant="primary" disabled={busy || !ready}>Save credentials</Button><span className="note">Stored on this server, never shown again.</span></div>
        </form>
      )}
      {!open && error && <p className="err">{error}</p>}
    </div>
  );
}

function WebhookCard() {
  const url = `${window.location.origin}/api/drafts`;
  const curl = `curl -X POST ${url} \\\n  -H "Authorization: Bearer $WEBHOOK_TOKEN" \\\n  -H "Content-Type: application/json" \\\n  -d '{"caption": "Hello", "platforms": ["bluesky"]}'`;
  return (
    <Card title="Webhook">
      <CardBody>
        <div className="field"><span className="label">Endpoint</span><code className="mono" style={{ wordBreak: "break-all" }}>POST {url}</code></div>
        <p className="note">Set <span className="mono">WEBHOOK_TOKEN</span> in .env to enable it; the token is never shown here.</p>
        <pre className="code">{curl}</pre>
      </CardBody>
    </Card>
  );
}
