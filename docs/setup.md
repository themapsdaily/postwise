# Setup and configuration

## Environment variables

Postwise reads these. Put them in `.env` (Docker Compose passes the whole file to both containers).
Platform keys are not here: you add them in Settings and they are stored in the database.

| Variable | Required | Read by | What it does |
|---|---|---|---|
| `ADMIN_PASSWORD` | yes | web | The one password for the web UI. Without it every page returns a 500 that says so. |
| `APP_SECRET` | yes | web | Signs session cookies and approval links. At least 32 characters. `openssl rand -hex 32`. Changing it signs you out and kills old approval links. |
| `PUBLIC_URL` | for Instagram, Threads, email approval | web, worker | The address the internet uses to reach this app. Used to build media links (`PUBLIC_URL/media/<id>.<ext>`) and approval links. See [public-url.md](public-url.md). |
| `TZ` | recommended | web, worker | Default timezone. The worker uses it for source cron times. It is also the first value of the timezone setting in Settings (slots and the calendar use the saved setting after that). Default `UTC`. |
| `DATA_DIR` | no | web, worker | Where `postwise.db` and `media/` live. Default `./data`. In Docker this is `/app/data`, mounted from `./data`. |
| `WEBHOOK_TOKEN` | to use the webhook | web | Bearer token for `POST /api/drafts`. If it is empty the endpoint answers 503. `openssl rand -hex 24`. |
| `SMTP_URL` | for email approval | web, worker | SMTP connection, e.g. `smtps://user:pass@smtp.example.com:465`. |
| `MAIL_FROM` | for email approval | web, worker | The From header, e.g. `Postwise <postwise@example.com>`. Email approval needs both `SMTP_URL` and `MAIL_FROM`. |
| `DRY_RUN` | no | worker | Set to `1` and the worker only logs what each adapter would send. It claims nothing, runs no sources and sends nothing. |

## Data and backups

Everything lives in `DATA_DIR`:

| Path | Contents |
|---|---|
| `data/postwise.db` | Posts, deliveries, settings, accounts (including platform keys), source run times. SQLite in WAL mode, so you may also see `postwise.db-wal` and `postwise.db-shm`. |
| `data/media/` | Uploaded and imported images and video. |

Back it up by stopping the stack and copying the folder:

```bash
docker compose stop
cp -a data "backup-$(date +%F)"
docker compose start
```

If you have the `sqlite3` command, you can make a consistent copy of the database while it runs:

```bash
sqlite3 data/postwise.db ".backup 'postwise-backup.db'"
```

Copy `data/media/` separately in that case. To restore, stop the stack, put the files back, start it again.

Your platform keys are in `postwise.db` as plain JSON. Treat backups like secrets.

## Upgrading

```bash
git pull
docker compose build
docker compose up -d
```

Database migrations run by themselves when the app or worker opens the database. Back up `data/` first.
If you added your own checks or sources in code, they are part of the image, so a rebuild is needed.

## Reverse proxy

Postwise listens on port 3000 inside the container. Put a proxy in front of it for HTTPS.
Send the `X-Forwarded-Proto` header: the session cookie gets the `Secure` flag only when the request is HTTPS
(directly, or through that header).

Uploads can be 50 MB, so allow bodies of at least that size.

### Caddy

```
postwise.example.com {
	request_body {
		max_size 55MB
	}
	reverse_proxy localhost:3000
}
```

Caddy gets the certificate and sets `X-Forwarded-Proto` for you.

### nginx

```nginx
server {
    listen 443 ssl;
    server_name postwise.example.com;
    # ssl_certificate and ssl_certificate_key go here (for example from certbot)

    client_max_body_size 55m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then set `PUBLIC_URL=https://postwise.example.com` in `.env` and run `docker compose up -d`.

If the app is only reachable through the proxy, change the port mapping in `docker-compose.yml` to
`"127.0.0.1:3000:3000"` so nobody can reach it directly.

## Script sources in Docker

The worker image does not contain `sources.yaml` or `examples/`. Uncomment the two volume lines in the
`worker` service of `docker-compose.yml` (or add your own) so the worker sees them. The image is based on
`node:24-slim`, which does not normally include Python, so the Node examples work out of the box and
`csv-to-drafts.py` needs an image that has `python3`. See [writing-a-source.md](writing-a-source.md).

## Security notes

- **Single user.** There is one password and no accounts. Anyone who has it can post to every connected account.
- **Sessions last 30 days.** The cookie is HttpOnly and SameSite=Lax. There is no server-side session list;
  to sign everyone out, change `APP_SECRET`.
- **A wrong password waits 0.4 seconds.** There is no lockout, so use a long password.
- **Keep `WEBHOOK_TOKEN` secret.** Anyone with it can create drafts. In "Auto" approval mode, that means
  they can schedule posts to your accounts.
- **The webhook fetches any URL you send it.** Draft media given as `http(s)` URLs is downloaded by the server
  (50 MB cap, 30 second timeout), including addresses on your private network. Only give the token to callers
  you trust. The webhook never reads local file paths; script sources (which you write) can.
- **Public paths.** Without a session you can reach `/login`, `/media/*` (files are named by random ids),
  `/approve` and `/api/approve` (need a signed link, valid for 72 hours) and `/api/drafts` (needs the token).
  Everything else needs the session cookie.
- **Keys at rest.** Platform keys are stored unencrypted in the SQLite file. They are never returned by the API
  and never appear in dry-run output or error messages.
- Use HTTPS in front of the app, especially if the password travels over the internet.
