/** Schema migrations, embedded as strings so they work under tsx and Next alike. Append only; never edit a shipped one. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE posts (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'needs_approval',
  caption TEXT NOT NULL DEFAULT '',
  per_platform TEXT NOT NULL DEFAULT '{}',
  platforms TEXT NOT NULL DEFAULT '[]',
  media TEXT NOT NULL DEFAULT '[]',
  slot_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_posts_status_slot ON posts(status, slot_at);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0,
  container_id TEXT,
  remote_id TEXT,
  url TEXT,
  error TEXT,
  retry_at TEXT,
  published_at TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(post_id, platform)
);
CREATE INDEX idx_deliveries_status ON deliveries(status);

CREATE TABLE source_runs (
  source_id TEXT PRIMARY KEY,
  last_run_at TEXT,
  last_error TEXT
);
`,
  },
  {
    version: 2,
    sql: `
CREATE TABLE accounts (
  platform TEXT PRIMARY KEY,
  credentials TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    version: 3,
    sql: `
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`,
  },
];
