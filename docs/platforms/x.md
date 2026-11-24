# X

Postwise posts to X with the v2 API (`https://api.x.com/2`), signed with OAuth 1.0a for your own account.
No browser login is involved. You use four keys from the X developer portal.

**Access and cost.** X decides which API plans can post, and what each costs. At the time of writing, posting
through the API can require a paid plan, and free access, if offered, has a low monthly post limit. Check the
current plans and limits before you rely on it: <https://docs.x.com/> and the developer portal at
<https://developer.x.com/>. Postwise does not use any other X endpoint.

## What is supported

- Text up to **280** weighted characters. Links count as 23. Characters outside Latin and similar scripts
  (for example Chinese, Japanese, Korean) and emoji count as 2.
- Up to **4 images**, each **5 MB or smaller**
- Not supported yet: video. GIFs and other types are sent as plain images; stick to JPEG and PNG.
- Does not need `PUBLIC_URL`: Postwise uploads the image bytes itself.

## Credentials (Settings, X)

| Field | Key | Required |
|---|---|---|
| Consumer key | `consumerKey` | yes |
| Consumer secret | `consumerSecret` | yes |
| Access token | `accessToken` | yes |
| Access token secret | `accessTokenSecret` | yes |

The consumer key and secret may be called API key and API secret in the portal.

## How to get them

1. Sign in at the X developer portal (<https://developer.x.com/>) with the account you want to post from, and
   sign up for the API access plan you choose.
2. Create a project and an app (names and steps change; follow the portal).
3. In the app's settings, find user authentication settings. Turn on **OAuth 1.0a** and set the app permissions
   to **Read and write**. A callback URL and website are required by the form; any valid URL works, since
   Postwise does not use them.
4. Go to the app's Keys and tokens. Copy the **API key and secret** (consumer key and secret).
5. Generate the **Access token and secret** for your own account. **Do this after setting Read and write.**
   A token made earlier keeps the old permission, and you must regenerate it.
6. Paste all four into Postwise.

## Limits and common errors

| You see | Meaning |
|---|---|
| `the X text is over 280 characters` | Shorten it. Check the count in the composer. |
| `X takes at most 4 images` or `video not supported on X adapter yet` | Fix the media. |
| `image N is X MB; X takes 5 MB` | Make the image smaller. |
| `x 401` | A key or secret is wrong, or the token was regenerated. |
| `x 403` | The token is read-only (regenerate after setting Read and write), or your plan does not allow posting, or the post is a duplicate. |
| `x 429` | Rate or plan limit. Postwise retries after 2, 10 and 30 minutes, which may not be enough if you used your monthly quota. |
