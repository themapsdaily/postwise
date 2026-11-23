# Postwise

Self-hosted social post scheduler. Plan, approve and publish to Instagram,
Threads, X, Bluesky and Mastodon from your own server, free.

> Work in progress. Not ready to use yet.

## What you get

- A calendar, a queue and a composer with per-platform text and live character counts
- Approval in the UI or by a signed email link
- Working publishers for Instagram, Threads, X, Bluesky and Mastodon, with retries
- Plug-in points for your own data: **sources** (any script, webhook, feed),
  **checks** (your own rules before a post goes out) and **adapters** (more platforms)

## Run it

```bash
cp .env.example .env   # fill it in
docker compose up -d
```

Instagram and Threads fetch media from a public URL, so the app needs one
(a domain, or a tunnel). See `docs/public-url.md` (coming).

## Licence

MIT
