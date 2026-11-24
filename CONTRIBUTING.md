# Contributing

Thanks for helping. Postwise is small on purpose: keep changes small and tested.

## Set up

You need Node.js 24 and npm.

```bash
git clone <repo-url> postwise
cd postwise
npm install
cp .env.example .env     # set ADMIN_PASSWORD and APP_SECRET (openssl rand -hex 32)
npm run dev
```

In a second terminal, run the worker:

```bash
npx tsx --env-file=.env src/worker.ts
```

## Before you open a pull request

```bash
npm test
npm run typecheck
npm run lint
```

Tests use Node's built-in runner through `tsx` (`tests/*.test.ts`). Adapter tests stub `fetch`; no test calls a
real platform. Do not put real keys in tests, fixtures or docs.

Try an adapter change without any network:

```bash
npm run dry-run -- --post fixtures/post.json
```

## Where things are

| Path | What |
|---|---|
| `src/core/` | Types and the four interfaces (Source, Check, Adapter, Store), the engine, slots |
| `src/adapters/` | One file per platform |
| `src/checks/` | Checks that run before approval |
| `src/sources/` | Script and code sources |
| `src/store/` | SQLite store and migrations (append only: never edit a shipped migration) |
| `src/server/` | Auth, booking, request schemas, email |
| `src/app/` | Pages and API routes |
| `examples/` | Runnable example sources and checks |
| `docs/` | Documentation |

## Adding a platform

Follow [docs/writing-an-adapter.md](docs/writing-an-adapter.md), including the list of places to register it.
Also add:

- a guide in `docs/platforms/<name>.md` with the credential keys, setup steps, limits and common errors
- tests that stub `fetch` and check that the plan and the errors never contain a credential

Say clearly in the guide what the adapter does not support yet.

## Style

Plain code, short comments that say why. No new runtime dependencies without a reason in the pull request.
