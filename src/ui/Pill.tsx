import type { ReactNode } from "react";
import type { Platform, PostStatus } from "@/core/types";

export type Tone = "neutral" | "accent" | "ok" | "warn" | "danger";

export function Pill({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return <span className={`pill ${tone === "neutral" ? "" : tone}`} title={title}>{children}</span>;
}

const STATUS: Record<PostStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  needs_approval: { label: "Needs approval", tone: "warn" },
  approved: { label: "Approved", tone: "accent" },
  posting: { label: "Posting", tone: "accent" },
  posted: { label: "Posted", tone: "ok" },
  failed: { label: "Failed", tone: "danger" },
};

export const statusLabel = (s: PostStatus) => STATUS[s].label;
export const StatusPill = ({ status }: { status: PostStatus }) => <Pill tone={STATUS[status].tone}>{STATUS[status].label}</Pill>;

/** Neutral monochrome platform marks; no brand colours. */
export const PLATFORM_GLYPH: Record<Platform, string> = { instagram: "IG", threads: "Th", x: "X", bluesky: "Bs", mastodon: "Ma" };
export const PLATFORM_NAME: Record<Platform, string> = { instagram: "Instagram", threads: "Threads", x: "X", bluesky: "Bluesky", mastodon: "Mastodon" };

export function PlatformPill({ platform }: { platform: Platform }) {
  return <span className="pill plat" title={PLATFORM_NAME[platform]}>{PLATFORM_GLYPH[platform]}</span>;
}

export function PlatformPills({ platforms }: { platforms: Platform[] }) {
  return <span className="row" style={{ gap: "var(--space-1)" }}>{platforms.map((p) => <PlatformPill key={p} platform={p} />)}</span>;
}
