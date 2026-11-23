/**
 * Where posts and deliveries live. The shipped store is SQLite
 * (src/store/sqlite.ts); implement this to use Postgres or anything else.
 */

import type { Delivery, DraftInput, Post, PostStatus } from "./types";

/** What the publish engine needs. Tests pass an in-memory one. */
export interface EngineStore {
  /** Approved posts whose slot has passed, without claiming them (dry run). */
  duePosts(now: Date): Promise<Post[]>;
  /**
   * Claim every due post: approved -> posting, in one transaction, so two
   * workers never claim the same post.
   */
  claim(now: Date): Promise<Post[]>;
  getPost(id: string): Promise<Post>;
  updatePost(id: string, patch: Partial<Post>): Promise<Post>;
  /** Rows for these posts, any status. */
  deliveriesFor(postIds: string[]): Promise<Delivery[]>;
  /** Rows still queued or working. */
  openDeliveries(): Promise<Delivery[]>;
  createDeliveries(rows: Pick<Delivery, "postId" | "platform">[]): Promise<Delivery[]>;
  updateDelivery(id: string, patch: Partial<Delivery>): Promise<Delivery>;
}

export interface PostFilter {
  status?: PostStatus[];
  /** Slot range, UTC ISO, inclusive start, exclusive end. */
  from?: string;
  to?: string;
  limit?: number;
}

/** The full store: the engine's needs plus what the UI and sources use. */
export interface Store extends EngineStore {
  /** Make a draft. Media is already imported (paths under DATA_DIR). */
  createPost(input: Omit<DraftInput, "media"> & { source: string; status?: PostStatus; media?: Post["media"] }): Promise<Post>;
  listPosts(filter?: PostFilter): Promise<Post[]>;
  deletePost(id: string): Promise<void>;
}
