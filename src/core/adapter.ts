/**
 * An Adapter publishes a Post to one platform. Ship one per platform in
 * src/adapters/; write your own for any platform with an API.
 *
 * Publishing is split into steps so slow platform processing (video
 * transcoding, Instagram containers) never holds a request open:
 *   start: upload media or create a container, maybe publish straight away
 *   poll:  check a container from `start` and publish it when it is ready
 * The engine calls `start` for a queued row and `poll` for a working one.
 */

import type { Delivery, Platform, Post } from "./types";

/** What one adapter call achieved. */
export interface Step {
  /** working: still processing, poll again; retry: this attempt failed; failed: retrying won't help. */
  status: "working" | "posted" | "retry" | "failed";
  /** null clears the container (the next attempt starts over); undefined keeps it. */
  containerId?: string | null;
  remoteId?: string | null;
  url?: string | null;
  error?: string;
  /** Seconds until the next poll, for `working`. */
  retryInS?: number;
}

/** One HTTP request an adapter would send, for a dry run. Never include tokens. */
export interface PlannedRequest {
  method: "GET" | "POST";
  url: string;
  body?: Record<string, string>;
}

export interface Adapter {
  platform: Platform;
  /** Dry run: the requests start and poll would send. Pure, no network. */
  plan(d: Delivery, post: Post): PlannedRequest[];
  start(d: Delivery, post: Post): Promise<Step>;
  poll(d: Delivery, post: Post): Promise<Step>;
}

/** The text this post sends to a platform: its per-platform override, else the caption. */
export const textFor = (post: Post, platform: Platform) => post.perPlatform[platform] ?? post.caption;
