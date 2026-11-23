/** The shipped Store: one SQLite file (WAL). Multiple processes may open it; `claim` is atomic. */

import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Store, PostFilter } from "../core/store";
import type { Account, AccountStore } from "../core/accounts";
import type { Delivery, Post } from "../core/types";
import { MIGRATIONS } from "./migrations";

type Row = Record<string, unknown>;

const iso = (s: string) => {
  const t = Date.parse(s);
  if (Number.isNaN(t)) throw new Error(`Invalid date: ${s}`);
  return new Date(t).toISOString();
};

const toPost = (r: Row): Post => ({
  id: r.id as string,
  status: r.status as Post["status"],
  caption: r.caption as string,
  perPlatform: JSON.parse(r.per_platform as string),
  platforms: JSON.parse(r.platforms as string),
  media: JSON.parse(r.media as string),
  slotAt: (r.slot_at as string | null) ?? null,
  source: r.source as string,
  meta: JSON.parse(r.meta as string),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const toDelivery = (r: Row): Delivery => ({
  id: r.id as string,
  postId: r.post_id as string,
  platform: r.platform as Delivery["platform"],
  status: r.status as Delivery["status"],
  attempts: r.attempts as number,
  containerId: (r.container_id as string | null) ?? null,
  remoteId: (r.remote_id as string | null) ?? null,
  url: (r.url as string | null) ?? null,
  error: (r.error as string | null) ?? null,
  retryAt: (r.retry_at as string | null) ?? null,
  publishedAt: (r.published_at as string | null) ?? null,
  updatedAt: r.updated_at as string,
});

const toAccount = (r: Row): Account => ({
  platform: r.platform as Account["platform"],
  credentials: JSON.parse(r.credentials as string),
  expiresAt: (r.expires_at as string | null) ?? null,
  updatedAt: r.updated_at as string,
});

const POST_COLS: Record<string, [string, (v: never) => unknown]> = {
  status: ["status", (v) => v],
  caption: ["caption", (v) => v],
  perPlatform: ["per_platform", (v) => JSON.stringify(v)],
  platforms: ["platforms", (v) => JSON.stringify(v)],
  media: ["media", (v) => JSON.stringify(v)],
  slotAt: ["slot_at", (v: string | null) => (v == null ? null : iso(v))],
  source: ["source", (v) => v],
  meta: ["meta", (v) => JSON.stringify(v)],
};

const DELIVERY_COLS: Record<string, string> = {
  status: "status", attempts: "attempts", containerId: "container_id", remoteId: "remote_id",
  url: "url", error: "error", retryAt: "retry_at", publishedAt: "published_at",
};

export type SqliteStore = Store & AccountStore & {
  close(): void;
  getSourceRun(id: string): { lastRunAt: string | null; lastError: string | null } | null;
  setSourceRun(id: string, lastRunAt: string | null, error: string | null): void;
};

export function openStore(dbPath: string): SqliteStore {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)");
  for (const m of MIGRATIONS) {
    // IMMEDIATE so two processes starting together do not both apply one.
    db.transaction(() => {
      if (db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(m.version)) return;
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version) VALUES (?)").run(m.version);
    }).immediate();
  }

  const getRow = (id: string) => {
    const r = db.prepare("SELECT * FROM posts WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new Error(`Post not found: ${id}`);
    return toPost(r);
  };
  const getDelivery = (id: string) => {
    const r = db.prepare("SELECT * FROM deliveries WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new Error(`Delivery not found: ${id}`);
    return toDelivery(r);
  };

  const claimTx = db.transaction((nowIso: string): Post[] => {
    const rows = db.prepare("SELECT id FROM posts WHERE status = 'approved' AND slot_at IS NOT NULL AND slot_at <= ? ORDER BY slot_at").all(nowIso) as { id: string }[];
    const upd = db.prepare("UPDATE posts SET status = 'posting', updated_at = ? WHERE id = ? AND status = 'approved'");
    const out: Post[] = [];
    for (const { id } of rows) if (upd.run(nowIso, id).changes === 1) out.push(getRow(id));
    return out;
  });

  const store: SqliteStore = {
    close: () => { db.close(); },

    async getAccount(platform) {
      const r = db.prepare("SELECT * FROM accounts WHERE platform = ?").get(platform) as Row | undefined;
      return r ? toAccount(r) : null;
    },
    async setAccount(platform, credentials, expiresAt) {
      db.prepare(`INSERT INTO accounts (platform, credentials, expires_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(platform) DO UPDATE SET credentials = excluded.credentials, expires_at = excluded.expires_at, updated_at = excluded.updated_at`)
        .run(platform, JSON.stringify(credentials), expiresAt ? iso(expiresAt) : null, new Date().toISOString());
    },
    async listAccounts() {
      return (db.prepare("SELECT * FROM accounts ORDER BY platform").all() as Row[]).map(toAccount);
    },

    async duePosts(now) {
      return (db.prepare("SELECT * FROM posts WHERE status = 'approved' AND slot_at IS NOT NULL AND slot_at <= ? ORDER BY slot_at").all(now.toISOString()) as Row[]).map(toPost);
    },
    async claim(now) {
      return claimTx.immediate(now.toISOString());
    },
    async getPost(id) { return getRow(id); },
    async updatePost(id, patch) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(patch)) {
        const c = POST_COLS[k];
        if (!c || v === undefined) continue;
        sets.push(`${c[0]} = ?`);
        vals.push(c[1](v as never));
      }
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString(), id);
      const r = db.prepare(`UPDATE posts SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      if (r.changes === 0) throw new Error(`Post not found: ${id}`);
      return getRow(id);
    },
    async deliveriesFor(postIds) {
      if (!postIds.length) return [];
      const q = postIds.map(() => "?").join(",");
      return (db.prepare(`SELECT * FROM deliveries WHERE post_id IN (${q})`).all(...postIds) as Row[]).map(toDelivery);
    },
    async openDeliveries() {
      return (db.prepare("SELECT * FROM deliveries WHERE status IN ('queued','working')").all() as Row[]).map(toDelivery);
    },
    async createDeliveries(rows) {
      const now = new Date().toISOString();
      const ins = db.prepare("INSERT INTO deliveries (id, post_id, platform, status, attempts, updated_at) VALUES (?, ?, ?, 'queued', 0, ?)");
      return db.transaction(() => rows.map((r) => {
        const id = randomUUID();
        ins.run(id, r.postId, r.platform, now);
        return getDelivery(id);
      }))();
    },
    async updateDelivery(id, patch) {
      const sets: string[] = [];
      const vals: unknown[] = [];
      for (const [k, v] of Object.entries(patch)) {
        const c = DELIVERY_COLS[k];
        if (!c || v === undefined) continue;
        sets.push(`${c} = ?`);
        vals.push(v);
      }
      sets.push("updated_at = ?");
      vals.push(new Date().toISOString(), id);
      const r = db.prepare(`UPDATE deliveries SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
      if (r.changes === 0) throw new Error(`Delivery not found: ${id}`);
      return getDelivery(id);
    },

    async createPost(input) {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO posts (id, status, caption, per_platform, platforms, media, slot_at, source, meta, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, input.status ?? "needs_approval", input.caption,
        JSON.stringify(input.perPlatform ?? {}), JSON.stringify(input.platforms ?? []), JSON.stringify(input.media ?? []),
        input.at ? iso(input.at) : null, input.source, JSON.stringify(input.meta ?? {}), now, now,
      );
      return getRow(id);
    },
    async listPosts(f: PostFilter = {}) {
      const where: string[] = [];
      const vals: unknown[] = [];
      if (f.status?.length) { where.push(`status IN (${f.status.map(() => "?").join(",")})`); vals.push(...f.status); }
      if (f.from) { where.push("slot_at >= ?"); vals.push(iso(f.from)); }
      if (f.to) { where.push("slot_at < ?"); vals.push(iso(f.to)); }
      let sql = "SELECT * FROM posts" + (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
        " ORDER BY (slot_at IS NULL), slot_at, created_at";
      if (f.limit) { sql += " LIMIT ?"; vals.push(f.limit); }
      return (db.prepare(sql).all(...vals) as Row[]).map(toPost);
    },
    async deletePost(id) { db.prepare("DELETE FROM posts WHERE id = ?").run(id); },

    getSourceRun(id) {
      const r = db.prepare("SELECT * FROM source_runs WHERE source_id = ?").get(id) as Row | undefined;
      return r ? { lastRunAt: (r.last_run_at as string | null) ?? null, lastError: (r.last_error as string | null) ?? null } : null;
    },
    setSourceRun(id, lastRunAt, error) {
      db.prepare(`INSERT INTO source_runs (source_id, last_run_at, last_error) VALUES (?, ?, ?)
        ON CONFLICT(source_id) DO UPDATE SET last_run_at = excluded.last_run_at, last_error = excluded.last_error`).run(id, lastRunAt, error);
    },
  };
  return store;
}
