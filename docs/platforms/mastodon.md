# Mastodon

Works with any Mastodon server. You make an access token on your own account.

## What is supported

- Text up to **500 characters**. Every link counts as 23, as on most servers. Your server may use a different
  limit; Postwise checks against 500.
- Up to **4 images**, or **1 video** (not both), with alt text
- Video and large images are processed by the server; Postwise waits for it and then posts
- Retries are safe: each post is sent with an idempotency key

## Credentials (Settings, Mastodon)

| Field | Key | Required | Value |
|---|---|---|---|
| Instance URL | `instance` | yes | Your server, e.g. `https://mastodon.social` (a bare `mastodon.social` also works). |
| Access token | `accessToken` | yes | The token from your application, below. |

## How to get an access token

1. Sign in on your Mastodon server in the browser.
2. Open Preferences, then Development, then New application (at the time of writing). Docs:
   <https://docs.joinmastodon.org/client/token/>
3. Name it `postwise`.
4. Under Scopes, tick `write:statuses` and `write:media`. Untick the rest, including `read`.
5. Save, open the application you made, and copy **Your access token**.
6. Paste it into Postwise with your instance URL.

## Limits and common errors

| You see | Meaning |
|---|---|
| `the Mastodon text is N characters; the limit is 500` | Shorten it. |
| `Mastodon takes up to 4 images or 1 video, not both` | Fix the media. |
| `mastodon upload 401` or `post 401` | The token is wrong or lacks a scope. Check `write:statuses` and `write:media`. |
| `mastodon post 422: ...` | The server refused the content (your server's limits, for example). |
| `mastodon media expired; uploading again` | A normal retry; Postwise uploads again. |
