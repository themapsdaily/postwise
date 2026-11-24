# Threads

Threads uses the same kind of Meta developer app as Instagram, with its own API.
Meta's guide: <https://developers.facebook.com/docs/threads/>

## What is supported

- Text only, one image, one video, or a **carousel of 2 to 20 images**
- Text up to **500 characters**. An emoji counts as the number of bytes it takes in UTF-8
  (usually 4), as Threads counts it. The composer counter and the length check count the same way.
- Not supported yet: carousels that contain a video
- `PUBLIC_URL` must be reachable from the internet when the post has media, because Threads downloads it.
  See [../public-url.md](../public-url.md). Text-only posts do not need it.

## Credentials (Settings, Threads)

| Field | Key | Required | Value |
|---|---|---|---|
| Access token | `accessToken` | yes | A long-lived Threads user token. |
| User ID | `userId` | no | Your numeric Threads user id. If empty, Postwise looks it up from the token. |
| Expires (ISO date) | `expiresAt` | no | When the token expires, e.g. `2026-12-31`. |

## How to get them

1. Create a Meta developer account and an app at <https://developers.facebook.com/apps/>. Add the Threads
   use case or product (names change; follow Meta's guide above).
2. Add your Threads account as a tester or role on the app, and accept the invitation in the Threads app
   (Meta's guide shows where).
3. Request the `threads_basic` and `threads_content_publish` permissions.
4. Generate a user access token, then exchange it for a **long-lived token** (about 60 days). Meta's guide
   describes the exchange.
5. Enter the token in Settings. You can add the expiry date too.

### Token expiry

Postwise refreshes Threads tokens by itself. Once an hour the worker checks: if the token has less than 7 days
left, or no expiry date is saved, it asks Threads for a fresh 60-day token and saves it and the new date.
For this to work the token must still be valid when the check runs, so keep the worker running. If a token
has already expired, make a new one. Refresh failures appear in the worker log as `token refresh failed`.

## Limits and common errors

| You see | Meaning |
|---|---|
| `Threads needs text or media` | The post is empty. |
| `the Threads text is over 500 characters` | Shorten it (remember emoji count as several). |
| `Threads takes at most 20 media in a carousel` | Remove some. |
| `threads ... (190)` or 401 | The token is wrong or expired. |
| `PUBLIC_URL needed` | A post with media needs `PUBLIC_URL` set. |
| `container ERROR` | Threads rejected the media. Postwise retries, then gives up after 4 attempts. |

Threads limits how many posts an account can publish per day. Check Meta's current limits in their guide.
