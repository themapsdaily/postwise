/**
 * Domain types. Everything else (sources, checks, adapters, store, UI) speaks these.
 * A Post is what the user wants published; a Delivery is one Post on one platform.
 */

export const PLATFORMS = ["instagram", "threads", "x", "bluesky", "mastodon"] as const;
export type Platform = (typeof PLATFORMS)[number];

export const POST_STATUSES = ["draft", "needs_approval", "approved", "posting", "posted", "failed"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

export const DELIVERY_STATUSES = ["queued", "working", "posted", "failed", "skipped"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type MediaKind = "image" | "video";

export interface Media {
  id: string;
  kind: MediaKind;
  /** Path under the data dir; served publicly at `${PUBLIC_URL}/media/${id}`. */
  path: string;
  mime: string;
  alt?: string;
  width?: number;
  height?: number;
}

/** Per-platform text that replaces the main caption on that platform. */
export type PerPlatformText = Partial<Record<Platform, string>>;

export interface Post {
  id: string;
  status: PostStatus;
  caption: string;
  perPlatform: PerPlatformText;
  platforms: Platform[];
  media: Media[];
  /** UTC ISO time the post is booked for; null until it gets a slot. */
  slotAt: string | null;
  /** Which source made it: "manual", "webhook", or a source id from sources.yaml. */
  source: string;
  /** Free-form data a source attaches (ids, links); never sent to platforms. */
  meta: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface Delivery {
  id: string;
  postId: string;
  platform: Platform;
  status: DeliveryStatus;
  attempts: number;
  /** Upload or container id while the platform is still processing; null to start over. */
  containerId: string | null;
  /** Platform-side id of the published post. */
  remoteId: string | null;
  /** Public permalink once posted. */
  url: string | null;
  error: string | null;
  /** UTC ISO time of the next retry, when a step failed and attempts remain. */
  retryAt: string | null;
  publishedAt: string | null;
  updatedAt: string;
}

/** What a Source returns and what POST /api/drafts accepts. */
export interface DraftInput {
  caption: string;
  platforms?: Platform[];
  perPlatform?: PerPlatformText;
  /** Public URLs or local file paths; fetched into the media store on import. */
  media?: { src: string; alt?: string }[];
  /** Wanted time (ISO); omitted = next free slot. */
  at?: string;
  meta?: Record<string, unknown>;
  /**
   * Optional stable id from your data (a feed item's guid, a row id). A draft
   * whose key this source has already sent is skipped, so a source can resend
   * everything each run without making duplicates.
   */
  key?: string;
}
