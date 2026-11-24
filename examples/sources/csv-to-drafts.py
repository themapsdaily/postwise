#!/usr/bin/env python3
"""Turn a CSV file into Postwise drafts. Python 3 standard library only.

    python3 examples/sources/csv-to-drafts.py examples/sources/posts.csv

Columns (header row required):
  caption    the post text
  platforms  semicolon list, e.g. "bluesky;mastodon" (empty = none, set them in the composer)
  at         when to post: ISO ("2026-12-01T09:00:00Z") or "YYYY-MM-DD HH:MM" in the
             timezone named by the TZ environment variable (default UTC). Empty = next free slot.
  media      semicolon list of http(s) URLs or local file paths (empty = no media)

Prints a JSON array of DraftInput on stdout. Problems go to stderr, exit code 1.
Local media paths only work for script sources run by the worker, not for the webhook.
"""

import csv
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

PLATFORMS = {"instagram", "threads", "x", "bluesky", "mastodon"}


def die(msg):
    print(msg, file=sys.stderr)
    sys.exit(1)


def split(value):
    return [p.strip() for p in (value or "").split(";") if p.strip()]


def to_utc_iso(value, tz):
    value = value.strip()
    try:
        if "T" in value:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        else:
            dt = datetime.strptime(value, "%Y-%m-%d %H:%M")
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=tz)
    except ValueError:
        die(f"Bad time in column 'at': {value!r} (use ISO or 'YYYY-MM-DD HH:MM')")
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def main():
    if len(sys.argv) != 2:
        die("Usage: csv-to-drafts.py <file.csv>")
    try:
        tz = ZoneInfo(os.environ.get("TZ") or "UTC")
    except Exception:
        die(f"Unknown timezone in TZ: {os.environ.get('TZ')!r}")

    drafts = []
    with open(sys.argv[1], newline="", encoding="utf-8") as f:
        for n, row in enumerate(csv.DictReader(f), start=2):
            caption = (row.get("caption") or "").strip()
            if not caption:
                continue
            platforms = split(row.get("platforms"))
            bad = [p for p in platforms if p not in PLATFORMS]
            if bad:
                die(f"Line {n}: unknown platform {bad[0]!r}")
            # key: a stable id per row, so re-running on the same file adds nothing new.
            draft = {"caption": caption, "key": hashlib.sha1(f"{caption}|{row.get('at') or ''}".encode()).hexdigest()[:16]}
            if platforms:
                draft["platforms"] = platforms
            if (row.get("at") or "").strip():
                draft["at"] = to_utc_iso(row["at"], tz)
            media = split(row.get("media"))
            if media:
                draft["media"] = [{"src": m} for m in media]
            drafts.append(draft)
    print(json.dumps(drafts, indent=2, ensure_ascii=False))


main()
