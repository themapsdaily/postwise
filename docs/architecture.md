# Architecture

Two processes share one SQLite file:

- **web**: the Next.js app (UI, API, the `/media/` files). Runs checks and books slots.
- **worker**: `src/worker.ts`. Once a minute it runs due sources, refreshes tokens, and publishes due posts.

```
sources --> draft --> checks --> approve --> slot --> worker tick --> adapters --> platforms
```

## The pipeline

1. **Source.** The composer, the webhook (`POST /api/drafts`), a script in `sources.yaml`, or a TypeScript
   `Source` makes a **Post** in status `draft` or `needs_approval`.
2. **Checks.** Every check in `src/checks/index.ts` runs on the post. An `error` blocks approval, a `warn` is shown.
3. **Approve.** In the app, or from the signed link in a review email, or automatically (see below).
   Approval books the post into a **slot**: a time of day from Settings, in your timezone, stored as a UTC
   time in `slotAt`. Approving with no time picks the next free slot, at least `minLeadMinutes` away.
4. **Tick.** The worker finds approved posts whose slot has passed and sends them out.
5. **Adapters.** One per platform. Each turns a post into API calls.

How a draft gets approved:

| Source | Starts as | Then |
|---|---|---|
| Composer | `draft` | You approve it in the app |
| Webhook | `needs_approval` | Settings, Approval = **Auto**: approved straight away if checks pass (at `at` if it is in the future, else the next free slot). **In app**: waits in the Queue. **Email**: a review email with three slot links goes out. |
| Script or code source | `needs_approval` | If the source has `autoApprove: true`, the draft has `at` and every check passes, it is `approved` at once with `slotAt = at`. Otherwise it waits for you. |

An approved post that you edit goes back to `draft` with no slot, so the checks run again.

## Statuses

### Post

| Status | Meaning |
|---|---|
| `draft` | Being written, or taken back out of the queue. Not scheduled. |
| `needs_approval` | Made by a source, waiting for you. |
| `approved` | Booked at `slotAt`. The worker will claim it when that time passes. |
| `posting` | Claimed. Its deliveries are being worked on. |
| `posted` | At least one platform published it. |
| `failed` | Every platform ended without publishing. |

A post is `posted` as soon as the first platform succeeds, even if another platform later fails. Check the
History page for each platform's result.

### Delivery (one post on one platform)

| Status | Meaning |
|---|---|
| `queued` | Not started, or waiting for a retry. |
| `working` | The platform is still processing (a container or an upload). Polled again later. |
| `posted` | Published. `url` and `remoteId` are saved when the platform gives them. |
| `failed` | Ended without publishing. The `error` says why. |
| `skipped` | No account is connected for that platform. |

## The tick

`runTick` in `src/core/engine.ts` runs once a minute (the worker also runs sources first, and refreshes
Instagram and Threads tokens at most once an hour). One tick:

1. **Claim.** `claim` turns every `approved` post with `slotAt <= now` into `posting`, in one SQLite
   transaction, then creates one delivery row per platform.
2. **Deliveries.** It loads every `queued` or `working` delivery. Rows whose `retryAt` is still in the
   future wait. Rows for a post that was unscheduled or deleted are left alone.
3. **Start or poll.** A `working` row with a container id is **polled**. Anything else is **started**.
   If the step says `working` with a wait of 15 seconds or less, the engine waits that long and polls again,
   up to 3 times in the same tick. Longer waits (a Reel can take a minute) go to the next tick.
4. **Retries.** A step that returns `retry` (or throws) is tried again after **2, 10 and 30 minutes**. The
   fourth failure is final. A step that returns `failed` is final at once. The other platforms carry on.
5. **Settle.** If every delivery of a `posting` post has ended and none posted, the post is `failed`.

HTTP errors: 429 and 5xx are retried. Any other 4xx (bad token, bad content) is final, because retrying
will not help. Meta error codes for rate limits and temporary blocks are retried too.

If a tick is still running when the next one starts (in the same process), the new one does nothing.

### Why `claim` is atomic

Two workers (or a restart overlapping an old process) could both see the same approved post. `claim` selects
and updates in a single transaction, and the update only succeeds while the status is still `approved`
(`UPDATE ... WHERE status = 'approved'`). Only one caller changes the row, so only one gets the post.
This stops a post going out twice. Adapters add their own guards: Bluesky uses a fixed record key and checks
for it before posting, Mastodon sends an `Idempotency-Key`, and Instagram and Threads treat a container that
is already `PUBLISHED` as done.

## The four interfaces

Defined in `src/core/`. Everything else speaks these and the types in `src/core/types.ts`.

```ts
// source.ts: makes drafts
interface Source {
  id: string;                 // stored on each Post as `source`
  schedule?: string;          // cron, in TZ; omit for push-only
  autoApprove?: boolean;      // default false
  run(ctx: SourceContext): Promise<DraftInput[]>;
}
interface SourceContext { now: Date; log: (msg: string) => void; lastRunAt: string | null }

// check.ts: looks at a post before it can be approved
interface Check {
  id: string;
  run(post: Post): CheckResult[];   // pure and fast
}
interface CheckResult { checkId: string; level: "error" | "warn"; platform?: Platform; message: string }

// adapter.ts: publishes a post to one platform
interface Adapter {
  platform: Platform;
  plan(d: Delivery, post: Post): PlannedRequest[];   // dry run, no network
  start(d: Delivery, post: Post): Promise<Step>;
  poll(d: Delivery, post: Post): Promise<Step>;
}
interface Step {
  status: "working" | "posted" | "retry" | "failed";
  containerId?: string | null;   // null clears it, undefined keeps it
  remoteId?: string | null;
  url?: string | null;
  error?: string;
  retryInS?: number;             // for "working": seconds until the next poll
}

// store.ts: where posts and deliveries live (SQLite ships; EngineStore is what the engine needs)
interface EngineStore {
  duePosts(now: Date): Promise<Post[]>;
  claim(now: Date): Promise<Post[]>;
  getPost(id: string): Promise<Post>;
  updatePost(id: string, patch: Partial<Post>): Promise<Post>;
  deliveriesFor(postIds: string[]): Promise<Delivery[]>;
  openDeliveries(): Promise<Delivery[]>;
  createDeliveries(rows: Pick<Delivery, "postId" | "platform">[]): Promise<Delivery[]>;
  updateDelivery(id: string, patch: Partial<Delivery>): Promise<Delivery>;
}
```

`Store` extends `EngineStore` with `createPost`, `listPosts` and `deletePost` for the UI and sources.
Guides: [source](writing-a-source.md), [check](writing-a-check.md), [adapter](writing-an-adapter.md).

## Where data lives

| What | Where |
|---|---|
| Posts, deliveries, settings, accounts, source run times | `DATA_DIR/postwise.db` (SQLite, WAL). Tables: `posts`, `deliveries`, `accounts`, `settings`, `source_runs`. |
| Media | `DATA_DIR/media/<uuid>.<ext>`, served at `/media/<uuid>.<ext>` |
| Script sources | `sources.yaml` in the repo root (not in the database) |
| Everything else | Environment variables ([setup.md](setup.md)) |

The schema is created by embedded migrations in `src/store/migrations.ts`, applied when a process opens the file.
