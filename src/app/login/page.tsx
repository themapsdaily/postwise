"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const password = String(new FormData(e.currentTarget).get("password") ?? "");
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }) });
      if (res.ok) { router.replace("/"); router.refresh(); return; }
      setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Sign-in failed");
    } catch {
      setError("Could not reach the server");
    }
    setBusy(false);
  }

  return (
    <main className="center">
      <div className="card auth-card">
        <div className="brand" style={{ padding: 0, fontSize: 18 }}>Post<b>wise</b></div>
        <form onSubmit={submit} className="stack">
          <label className="field">
            <span>Password</span>
            <input className="input" name="password" type="password" autoComplete="current-password" autoFocus required />
          </label>
          {error && <p className="msg err" role="alert">{error}</p>}
          <button type="submit" className="btn primary" disabled={busy} style={{ height: 36 }}>{busy ? "Signing in..." : "Sign in"}</button>
        </form>
      </div>
    </main>
  );
}
