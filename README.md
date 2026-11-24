# Postwise

A free, self-hosted scheduler for Instagram, Threads, X, Bluesky and Mastodon.

## Why

Later and Buffer are good, but they charge monthly and hold your accounts. Postwise runs on your own
machine or server. You own your data and your API keys. There is nothing to pay for except the server.

## What you get

- A calendar, a queue and a composer with per-platform text and live character counts
- Checks that run before a post can be approved (length, media rules, and your own)
- Approval in the app, or by a signed link in an email
- Publishers for Instagram (photo, carousel, Reel), Threads, X, Bluesky and Mastodon, with retries
- A webhook (`POST /api/drafts`) and script sources, so anything can create drafts
- Plug-in points: **sources** (make drafts), **checks** (your rules), **adapters** (more platforms)
- One SQLite file for all data. Back it up by copying a folder.

## Run it in 15 minutes

You need Docker with Compose.

```bash
git clone https://github.com/themapsdaily/postwise.git
cd postwise
cp .env.example .env
```

Make a secret and copy it:

```bash
openssl rand -hex 32
```

Edit `.env` and fill in these four. Put each on its own line, with no comment after the value.

```
ADMIN_PASSWORD=choose-a-long-password
APP_SECRET=<the output of the openssl command>
PUBLIC_URL=http://localhost:3000
TZ=Europe/London
```

`PUBLIC_URL` can stay on localhost to try Bluesky or Mastodon. Instagram and Threads need a public address.

Start it:

```bash
docker compose up -d
```

Then:

1. Open `http://localhost:3000` and sign in with your `ADMIN_PASSWORD`.
2. Go to Settings and connect an account. Each platform has a guide in [docs/platforms](docs/platforms/).
   Bluesky and Mastodon are the quickest to set up.
3. Go to Compose, write a post, pick the platform and approve it. It goes out at the next slot.

Instagram and Threads download your media from `PUBLIC_URL`, so that address must be reachable from the
internet. Bluesky, Mastodon and X upload the file themselves and do not need it.
See [docs/public-url.md](docs/public-url.md).

## Local development without Docker

You need Node.js 24 and npm.

```bash
npm install
cp .env.example .env
npm run dev
```

In a second terminal, start the worker (it publishes posts and runs your sources). Next loads `.env` for
the web app by itself. The worker needs to be told to:

```bash
npx tsx --env-file=.env src/worker.ts
```

Checks:

```bash
npm test
npm run typecheck
npm run lint
```

## How it works

```
 sources            checks            approve           slot            worker           adapters
 -------            ------            -------           ----            ------           --------
 composer  \                                                                          /-> Instagram
 webhook    >-> draft -> run on every -> you (app or -> booked time -> every minute -> Threads
 scripts   /     post      edit         email link)    (slot_at)      claim + publish   X, Bluesky,
 your own                                                                              \-> Mastodon
```

A source makes a draft. Checks look at it. You approve it, and it gets a slot (a time of day you set in
Settings). Once a minute the worker finds posts whose slot has passed, claims them, and sends each one to
its platforms. A platform that fails is retried on its own after 2, 10 and 30 minutes.
Details are in [docs/architecture.md](docs/architecture.md).

## Docs

- [Setup and configuration](docs/setup.md)
- [Making your server reachable (public URL)](docs/public-url.md)
- [Architecture](docs/architecture.md)
- [Writing a source](docs/writing-a-source.md), [a check](docs/writing-a-check.md), [an adapter](docs/writing-an-adapter.md)
- Platforms: [Instagram](docs/platforms/instagram.md), [Threads](docs/platforms/threads.md),
  [X](docs/platforms/x.md), [Bluesky](docs/platforms/bluesky.md), [Mastodon](docs/platforms/mastodon.md)
- [Contributing](CONTRIBUTING.md)

Runnable examples are in [examples/](examples/).

## Status

Early. Test with a throwaway account first, and read what each adapter does before you point it at an
account you care about.

## Licence

MIT. See [LICENSE](LICENSE).
