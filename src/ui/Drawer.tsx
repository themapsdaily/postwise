"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button";

/** Side panel on desktop, full-screen sheet on phones (CSS). Esc or the scrim closes it. */
export function Drawer({ open, title, onClose, children, footer }: {
  open: boolean; title: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Post details" tabIndex={-1} ref={ref}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <Button variant="ghost" size="sm" icon onClick={onClose} aria-label="Close">✕</Button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </aside>
    </>
  );
}
