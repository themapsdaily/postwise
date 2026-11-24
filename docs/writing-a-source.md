# Writing a source

A source turns your data into drafts. The easiest kind is a script: any program in any language that prints
JSON. The worker runs it on a schedule. If you would rather push drafts from your own system, use the webhook.

Runnable examples are in `examples/sources/`.

## The script contract

| | |
|---|---|
| **Output** | A JSON array of drafts on **stdout**. Nothing else on stdout. An empty array `[]` is fine. |
| **Exit code** | `0` for success. Anything else is a failure; the last 500 characters of stderr are logged. |
| **Timeout** | `timeoutSeconds` from `sources.yaml`, default **120**. After that the process is killed (SIGKILL) and the run fails. |
| **Working directory** | The repo root (`/app` in Docker). Relative paths in `command` and in `media` resolve from there. |
| **Shell** | The `command` string runs through a shell, so `VAR=value cmd args` and pipes work. |
| **Environment** | The worker's environment without the app's secrets (`ADMIN_PASSWORD`, `APP_SECRET`, `WEBHOOK_TOKEN`, `SMTP_URL` are removed), plus `POSTWISE_SOURCE_ID` and `SINCE` (the time of the last successful run, ISO; unset on the first run). Add your own variables inline in `command`. |
| **Stdin** | Closed. The script gets no input. |
| **State** | None. The script is not told when it last ran. Pick a time window that matches the schedule (the RSS example looks back 24 hours for a daily schedule) or keep your own state file. |
| **On failure** | The run is logged as failed and the source tries again at its next cron time, not every minute. If the failure happens part way through importing, the drafts saved before it stay saved, so the next run can repeat them. |

Each draft in the array is a **DraftInput**:

| Field | Type | Required | Notes |
|---|---|---|---|
| `caption` | string | yes | The post text. Used on every platform unless `perPlatform` overrides it. |
| `platforms` | array of `"instagram"`, `"threads"`, `"x"`, `"bluesky"`, `"mastodon"` | no | Where to post. With no platforms, the draft gets the default platforms from Settings. |
| `perPlatform` | object, platform name to string | no | Replaces `caption` on that platform, e.g. `{"x": "Short version"}`. |
| `media` | array of `{ "src": string, "alt"?: string }` | no | `src` is an `http(s)` URL or a local file path (scripts only, not the webhook). The worker copies the file into `data/media/`. JPEG, PNG, GIF, WebP, MP4, MOV, WebM, up to 50 MB each. `alt` is the alt text. |
| `at` | string (ISO 8601 time) | no | When to post, e.g. `"2026-12-01T09:00:00Z"`. Without it the draft gets the next free slot when approved. |
| `meta` | object | no | Anything you want to keep with the post (ids, links). Never sent to a platform. |

The worker checks the output against this shape. A bad shape fails the whole run with a message in the worker log.

## sources.yaml

Copy the example and edit it. The file sits in the repo root, next to `package.json`. The worker reads it
when it starts, so restart the worker after a change.

```bash
cp sources.example.yaml sources.yaml
```

```yaml
- id: blog-feed                 # unique; stored on each post as its source
  schedule: "0 8 * * *"         # cron, in TZ: here every day at 08:00
  command: FEED_URL=https://example.com/feed.xml PLATFORMS=bluesky,mastodon node examples/sources/rss-to-drafts.mjs
  autoApprove: false            # optional. true: draft is booked at its "at" time with no review
  timeoutSeconds: 120           # optional, default 120
```

The file can be a plain list (as above) or `sources:` followed by that list.

Drafts start as `needs_approval`. With `autoApprove: true`, a draft that has `at` and passes every check is
approved at once with that time as its slot. A draft with no `at`, or one that fails a check, waits for you.

A source runs when its cron time has passed since its last run (or since the worker started). If the worker
was off at 08:00, it will not catch up for times before it started.

In Docker, mount `sources.yaml` and `examples/` into the worker. See [setup.md](setup.md#script-sources-in-docker).

## Try it by hand

Run the script and look at the output:

```bash
node examples/sources/rss-to-drafts.mjs --file examples/sources/sample-feed.xml
```

The sample feed is dated November 2026. Use `SINCE` to include older items:

```bash
SINCE=2020-01-01T00:00:00Z PLATFORMS=bluesky,x node examples/sources/rss-to-drafts.mjs --file examples/sources/sample-feed.xml
```

```bash
python3 examples/sources/csv-to-drafts.py examples/sources/posts.csv
```

Check it the way the worker does: this loads `sources.yaml`, runs each command and validates the output,
without writing anything to the database.

```bash
npx tsx -e '
import { loadScriptSources } from "./src/sources";
for (const s of loadScriptSources("sources.yaml")) {
  s.run({ now: new Date(), log: console.log, lastRunAt: null })
    .then((d) => console.log(s.id, "ok,", d.length, "draft(s)"), (e) => console.log(s.id, "FAILED:", e.message));
}'
```

## The examples

- `rss-to-drafts.mjs`: RSS 2.0 or Atom, no dependencies. Reads a URL from the first argument or `FEED_URL`
  (or `--file path`). Items newer than `SINCE` (default: last 24 hours) become drafts, with the title and link
  as the caption and an image from `<enclosure>` or `<media:content>` if there is one. `PLATFORMS` is a comma list.
  The XML handling is a few regular expressions: fine for ordinary feeds, not a full parser.
- `csv-to-drafts.py`: columns `caption`, `platforms` (semicolon list), `at` (ISO, or `YYYY-MM-DD HH:MM` in
  the timezone named by `TZ`), `media` (semicolon list). Python 3 standard library only.
- `webhook.sh`: sends one draft with `curl`.

## The webhook instead of a script

If your system can make an HTTP call, push to Postwise instead of being polled. Set `WEBHOOK_TOKEN` in `.env`,
then:

```bash
curl -X POST "$POSTWISE_URL/api/drafts" \
  -H "Authorization: Bearer $WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"caption": "Hello from the webhook", "platforms": ["bluesky"]}'
```

Send one DraftInput, or an array of 1 to 50. The reply is `201` with the created post (or an array of them).

| Status | Meaning |
|---|---|
| `201` | Created. |
| `400` | The body is not valid (the message says which field), or a media URL could not be fetched. Nothing is created. |
| `401` | Wrong or missing bearer token. |
| `503` | `WEBHOOK_TOKEN` is not set on the server. |

Differences from scripts: `media.src` must be an `http(s)` URL (the server downloads it), `caption` is limited to
10000 characters, up to 20 media per draft, and `platforms` falls back to the default platforms in Settings.
What happens next depends on Settings, Approval ([architecture.md](architecture.md#the-pipeline)).
`examples/sources/webhook.sh` does the same call from a shell.

## A TypeScript source

For anything a script cannot do (use a library, keep state in the app), implement `Source` from
`src/core/source.ts` and register it in `src/sources/index.ts`:

```ts
import type { Source } from "../core/source";

const weeklyTip: Source = {
  id: "weekly-tip",
  schedule: "0 9 * * 1",           // Mondays 09:00 in TZ
  autoApprove: false,
  async run({ now, log, lastRunAt }) {
    log(`weekly-tip: last ran ${lastRunAt ?? "never"}`);
    return [
      {
        caption: `Monday tip for ${now.toISOString().slice(0, 10)}: drink water.`,
        platforms: ["bluesky", "mastodon"],
      },
    ];
  },
};

export const sources: Source[] = [weeklyTip];
```

`lastRunAt` is the ISO time of the last successful run, or `null`. Use it to fetch only what is new. A failed run does not move it, so nothing is skipped.
Rebuild the Docker image after changing code (`docker compose build && docker compose up -d`).
Omit `schedule` for a source that is only called by your own code.
