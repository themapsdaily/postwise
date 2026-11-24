# Writing an adapter

An adapter publishes a post to one platform. Five ship in `src/adapters/`. Read the smallest, `mastodon.ts`,
alongside this page.

## The interface

From `src/core/adapter.ts`:

```ts
interface Adapter {
  platform: Platform;
  plan(d: Delivery, post: Post): PlannedRequest[];   // dry run: pure, no network
  start(d: Delivery, post: Post): Promise<Step>;
  poll(d: Delivery, post: Post): Promise<Step>;
}

interface Step {
  status: "working" | "posted" | "retry" | "failed";
  containerId?: string | null;
  remoteId?: string | null;
  url?: string | null;
  error?: string;
  retryInS?: number;
}

interface PlannedRequest { method: "GET" | "POST"; url: string; body?: Record<string, string> }
```

`d` is the delivery row (this post on this platform) and `post` is the post. Use `textFor(post, "<platform>")`
for the text, and `credentials(accounts, "<platform>", [...required keys])` from `src/adapters/util.ts` to read
the saved keys. It returns a `failed` step that names what is missing (never the values).

## start, poll and Step

Publishing is split so that slow platform processing never holds the worker.

- **`start`** is called for a `queued` delivery. Validate the post, upload media or create a container, and
  either publish straight away (`posted`) or return `working` with a `containerId`.
- **`poll`** is called for a `working` delivery that has a `containerId`. Check the container and publish it
  when it is ready.

What each `Step.status` does:

| `status` | Engine does | Use it when |
|---|---|---|
| `posted` | Marks the delivery `posted`; saves `remoteId` and `url`; marks the post `posted` if it is not already. | It is live. |
| `working` | Keeps the delivery `working`, stores `containerId`, and calls `poll` again after `retryInS` seconds (default 60). If `retryInS` is 15 or less, the engine also polls up to 3 times inside the same tick. | The platform is still processing. |
| `retry` | Counts an attempt and tries again after 2, then 10, then 30 minutes. The 4th failure is final. | A temporary problem: network, 429, 5xx. |
| `failed` | Final at once. The `error` is shown in History. | Retrying cannot help: bad token, content the platform refuses. |

`containerId` is a string you keep between calls (a Meta container id, a list of uploaded media ids, a
Bluesky record key). `null` clears it so the next attempt starts over; leaving it out keeps the old value.
`retryInS` only matters for `working`.

Rules:

- A thrown error is treated as `retry` and keeps the container.
- Be safe to repeat. A retry can happen after a lost response, so make a second attempt find the first one's
  result instead of posting twice (an idempotency key, a fixed record key, or checking the container status).
- Never put a token, password or key in `error`, a URL or a plan. Use `.replaceAll(secret, "[token]")` on
  messages that might echo one. The shipped adapters have tests that look for leaks.
- Use `httpStep(status, message)` from `util.ts` to map an HTTP failure to `retry` (429, 5xx) or `failed`.
- Put timeouts on every `fetch` (`AbortSignal.timeout(...)`).
- Check what you can locally (length, media count, file size) before the first request, and return `failed`
  with a clear message.

## plan

`plan` returns the requests `start` and `poll` would send, with placeholders such as `<container id>`. It
must be pure: no network, no credential. It powers the dry run, and a test checks that no credential appears
in any plan. If the post is invalid, return one request whose body is `{ refused: "<reason>" }`.

## Example skeleton

```ts
import type { AccountStore } from "../core/accounts";
import { textFor, type Adapter, type PlannedRequest, type Step } from "../core/adapter";
import type { Post } from "../core/types";
import { credentials, httpStep } from "./util";

export function createMyPlatformAdapter(accounts: AccountStore): Adapter {
  return {
    platform: "myplatform",

    plan(_d, post): PlannedRequest[] {
      return [{ method: "POST", url: "https://api.example.com/posts", body: { text: textFor(post, "myplatform") } }];
    },

    async start(d, post): Promise<Step> {
      const { c, step } = await credentials(accounts, "myplatform", ["accessToken"]);
      if (!c) return step;
      const res = await fetch("https://api.example.com/posts", {
        method: "POST",
        headers: { Authorization: `Bearer ${c.accessToken}`, "Idempotency-Key": d.id, "content-type": "application/json" },
        body: JSON.stringify({ text: textFor(post, "myplatform") }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) return httpStep(res.status, `myplatform ${res.status}`);
      const j = (await res.json()) as { id: string; url: string };
      return { status: "posted", remoteId: j.id, url: j.url };
    },

    // Nothing to wait for on this platform.
    async poll(): Promise<Step> {
      return { status: "retry", containerId: null, error: "nothing to poll" };
    },
  };
}
```

## Register a new platform

A platform name appears in several typed places, so TypeScript tells you what you missed. Add it to:

1. `PLATFORMS` in `src/core/types.ts`.
2. `FACTORIES` in `src/adapters/index.ts`.
3. `credentialSchemas` in `src/server/schemas.ts` (the exact keys Settings may save).
4. `FIELDS` in `src/app/(app)/settings/SettingsView.tsx` (the labels Settings shows).
5. `PLATFORM_GLYPH` and `PLATFORM_NAME` in `src/ui/Pill.tsx`.
6. `LIMITS` and `countFor` in `src/checks/length.ts` (character limit), and any media rules in `src/checks/media.ts`.
7. The fake accounts in `src/cli/dry-run.ts`.

Then run `npm run typecheck`. A platform goes live once it has an account saved in Settings.

## Test with the dry-run CLI

The dry run builds every adapter with fake credentials and prints the requests `plan` returns. No network,
no database.

```bash
npm run dry-run -- --post fixtures/post.json
```

`fixtures/post.json` is a sample post. Copy it and change `platforms`, `media` and `caption` to try other cases.
Instagram and Threads build media links from `PUBLIC_URL`, so set it:

```bash
PUBLIC_URL=https://example.com npm run dry-run -- --post fixtures/post.json
```

For `start` and `poll`, see `tests/adapters.test.ts`: it swaps `globalThis.fetch` for a stub and asserts on
the steps. Do the same for your adapter, and add a test that its plan contains no credential.

```bash
npm test
```

You can also run the worker with `DRY_RUN=1` to log the previews for posts that are due. It sends nothing.
