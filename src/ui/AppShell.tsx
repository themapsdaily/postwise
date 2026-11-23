"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "./Button";

const ICON = {
  calendar: "M3 5h10v8H3zM3 8h10M6 3v3M10 3v3",
  queue: "M3 4h10M3 8h10M3 12h6",
  compose: "M3 13l1-3 7-7 2 2-7 7zM10 4l2 2",
  history: "M8 3a5 5 0 1 0 5 5M8 5v3l2 1M13 3v3h-3",
  settings: "M3 5h10M3 11h10M6 3v4M10 9v4",
};
const NAV: { href: string; label: string; icon: keyof typeof ICON }[] = [
  { href: "/calendar", label: "Calendar", icon: "calendar" },
  { href: "/queue", label: "Queue", icon: "queue" },
  { href: "/compose", label: "Compose", icon: "compose" },
  { href: "/history", label: "History", icon: "history" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="shell">
      <header className="topbar">
        <span className="brand" style={{ padding: 0 }}>Post<b>wise</b></span>
        <Button size="sm" aria-expanded={open} aria-controls="rail" onClick={() => setOpen((o) => !o)}>{open ? "Close" : "Menu"}</Button>
      </header>
      <nav id="rail" className={`rail ${open ? "open" : ""}`} aria-label="Main">
        <div className="brand">Post<b>wise</b></div>
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="navlink" onClick={() => setOpen(false)} aria-current={path === n.href ? "page" : undefined}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[n.icon]} /></svg>
            {n.label}
          </Link>
        ))}
        <div className="rail-foot"><Button variant="ghost" onClick={signOut} style={{ width: "100%", justifyContent: "flex-start" }}>Sign out</Button></div>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
