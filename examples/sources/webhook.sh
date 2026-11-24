#!/usr/bin/env bash
# Send one draft to Postwise through the webhook.
#
#   POSTWISE_URL=https://postwise.example.com WEBHOOK_TOKEN=... \
#     ./examples/sources/webhook.sh "Hello from a script" bluesky,mastodon
#
# Arguments: 1 = caption, 2 = platforms (comma list, optional).
# Add "media": [{"src": "https://..."}] or "at": "2026-12-01T09:00:00Z" to the JSON below.
# Media must be an http(s) URL here; the server fetches it.
set -euo pipefail

: "${POSTWISE_URL:?set POSTWISE_URL, e.g. http://localhost:3000}"
: "${WEBHOOK_TOKEN:?set WEBHOOK_TOKEN (same value as in the server .env)}"
caption="${1:?usage: webhook.sh <caption> [platform,platform]}"
platforms="${2:-}"

# Build the JSON with node so quotes and newlines in the caption are escaped properly.
body=$(CAPTION="$caption" PLATFORMS="$platforms" node -e '
  const d = { caption: process.env.CAPTION };
  const p = process.env.PLATFORMS.split(",").map((s) => s.trim()).filter(Boolean);
  if (p.length) d.platforms = p;
  console.log(JSON.stringify(d));
')

curl --fail-with-body -sS -X POST "${POSTWISE_URL%/}/api/drafts" \
  -H "Authorization: Bearer ${WEBHOOK_TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$body"
echo
