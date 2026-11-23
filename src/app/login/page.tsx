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
    <main style={{ margin: "auto", width: "min(360px, 92vw)", padding: "1.5rem", border: "1px solid var(--foreground)", borderRadius: 8 }}>
      <h1 style={{ fontSize: "1.25rem", marginBottom: "1rem" }}>Postwise</h1>
      <form onSubmit={submit} style={{ display: "grid", gap: "0.75rem" }}>
        <label style={{ display: "grid", gap: "0.25rem" }}>
          Password
          <input name="password" type="password" autoComplete="current-password" autoFocus required style={{ padding: "0.5rem", font: "inherit" }} />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy} style={{ padding: "0.5rem", font: "inherit" }}>{busy ? "Signing in..." : "Sign in"}</button>
      </form>
    </main>
  );
}
