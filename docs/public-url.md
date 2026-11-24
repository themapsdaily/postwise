# Public URL

## Why Instagram and Threads need it

Instagram and Threads do not take file uploads. You hand them a link and their servers download the image or
video. Postwise stores your media in `data/media/` and serves it at:

```
PUBLIC_URL/media/<id>.<ext>
```

So `PUBLIC_URL` must be an address that Meta's servers can reach from the internet. `http://localhost:3000`
will not work for them.

Bluesky, Mastodon and X receive the file bytes directly from Postwise, so they do not need a public address.
If you only use those three, `PUBLIC_URL` can stay on localhost. (It is also used in approval emails, so links
in the email must open on the device you read it on.)

The `/media/` files have random names and need no login, which is how Meta fetches them. Anyone who has a link
can open that one file.

## Option 1: a domain and Caddy (best for a server)

Point a DNS record for `postwise.example.com` at your server, then use the Caddy snippet in
[setup.md](setup.md#reverse-proxy). Set:

```
PUBLIC_URL=https://postwise.example.com
```

## Option 2: Cloudflare Tunnel (no open ports, good for a home machine)

Install `cloudflared`, then run a quick tunnel to the app:

```bash
cloudflared tunnel --url http://localhost:3000
```

It prints an address like `https://something-random.trycloudflare.com`. Put it in `.env`:

```
PUBLIC_URL=https://something-random.trycloudflare.com
```

Then restart:

```bash
docker compose up -d
```

A quick tunnel gets a new address each time it starts, so you would have to update `PUBLIC_URL` every time.
For something permanent, create a named tunnel with your own domain. See Cloudflare's documentation for
`cloudflared` at the time you set it up.

## Option 3: ngrok

```bash
ngrok http 3000
```

Copy the `https://...` forwarding address into `PUBLIC_URL`. Free addresses may change when ngrok restarts.

## Test it

Upload an image in the composer (or put any `.jpg` in `data/media/` named like `<36-char-uuid>.jpg`).
Find a real file name:

```bash
ls data/media
```

Then, from any machine (your phone on mobile data is a good test):

```bash
curl -I "$PUBLIC_URL/media/<file name from the list>"
```

You want `HTTP/2 200` (or `HTTP/1.1 200`) and a `content-type` of `image/...`. A 404 means the name is wrong;
a connection error means the address is not reachable from the internet.

If `PUBLIC_URL` is empty, Instagram and Threads posts fail with "PUBLIC_URL needed".
