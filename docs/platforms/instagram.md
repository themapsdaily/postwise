# Instagram

Instagram is the most work to set up, because Meta only lets apps publish to professional accounts through
its Graph API. Plan for about 30 minutes the first time.

Meta changes its dashboard often. The steps below say what you need and why; the menu names may differ, so
follow Meta's current guide: <https://developers.facebook.com/docs/instagram-platform/content-publishing/>

## What is supported

- One image, one video (posted as a **Reel**), or a **carousel of 2 to 10 images**
- Caption up to **2200 characters**, and alt text per image (first 1000 characters)
- Not supported yet: carousels that contain a video, stories
- An image or video is **required**. A text-only post fails.
- `PUBLIC_URL` must be reachable from the internet, because Instagram downloads the media from it.
  See [../public-url.md](../public-url.md).

Posting runs in steps: Postwise creates a container, waits for Instagram to process it (seconds for an
image, a minute or more for a Reel), then publishes it and saves the permalink.

## Credentials (Settings, Instagram)

| Field | Key | Required | Value |
|---|---|---|---|
| Access token | `accessToken` | yes | A token that can publish to the account (see below). |
| Instagram user ID | `igUserId` | yes | The numeric id of the Instagram professional account. Not the username, not a Facebook Page id. |
| Expires (ISO date) | `expiresAt` | no | When the token expires, e.g. `2026-12-31`. Needed for automatic refresh. |

## How to get them

1. You need an Instagram **Business or Creator** account (at the time of writing, personal accounts cannot
   publish through the API). Switch in the Instagram app under account settings if needed.
2. Create a Meta developer account and an app at <https://developers.facebook.com/apps/>. Add the Instagram
   product to it.
3. Link the Instagram account to the app as Meta's guide describes (through a Facebook Page, or by adding the
   Instagram account directly, depending on the login type you choose). While the app is in development mode,
   you can use it with accounts that have a role on the app, and you do not need app review for your own account.
4. Request the content-publishing permission for the login type you chose
   (`instagram_content_publish` with Facebook Login, or `instagram_business_content_publish` with Instagram Login,
   at the time of writing) and generate an access token. Make it a **long-lived** token (about 60 days) if
   Meta offers that choice.
5. Find the Instagram user id. Meta's Graph API explorer or the "me" call for your token returns it.
6. Enter the token, user id and expiry date in Settings.

Postwise sends requests to `https://graph.facebook.com/v25.0/...` with the token. Use a token that works there.
Check by trying a post with a throwaway account first.

### Token expiry

Postwise tries to refresh the token itself when `expiresAt` is set and less than 7 days away, using the
Instagram long-lived token refresh call (`graph.instagram.com/refresh_access_token`). That only works for
the token type that call supports. If a token cannot be refreshed, Postwise logs `token refresh failed` in the
worker and you must make a new one before it expires. Tokens that do not expire (for example from a system
user) need no date, and Postwise leaves them alone.

## Limits and common errors

| You see | Meaning |
|---|---|
| `Instagram needs an image or a video` | Add media. |
| `Instagram takes at most 10 media in a carousel` | Remove some. |
| `carousels with a video are not supported on the Instagram adapter yet` | Use images only. |
| `PUBLIC_URL needed` | Set `PUBLIC_URL` and restart. |
| A media download error from Instagram | Instagram could not fetch the file. Test `curl -I $PUBLIC_URL/media/<file>` from outside your network. |
| `instagram 400 (190)` or 401 | The token is wrong or expired. Make a new one. |
| `container ERROR` or `EXPIRED` | Instagram rejected the media (format, size, ratio). Postwise retries with a new container, then gives up after 4 attempts. |
| `retry` with codes 4, 17, 32, 613 | Rate limit. Postwise waits and retries. |

Meta limits how many posts an account can publish per day and what image shapes and video lengths it takes.
Check Meta's current limits in the guide linked above.
