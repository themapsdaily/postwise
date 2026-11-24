# Bluesky

The easiest one to connect. No developer app, just an app password.

## What is supported

- Text up to **300 characters** (counted in graphemes, as Bluesky does)
- Up to **4 images**, each **976 KB or smaller**, with alt text
- Links in the text become clickable (link facets are added for every `http(s)` URL)
- Not supported yet: video, and mentions or hashtags as links (they are posted as plain text)

Retries are safe: the post uses a fixed record key and is looked up before it is created, so a lost
response does not cause a duplicate.

## Credentials (Settings, Bluesky)

| Field | Key | Required | Value |
|---|---|---|---|
| Handle or email | `identifier` | yes | Your handle, e.g. `you.bsky.social`, or your account email. |
| App password | `appPassword` | yes | A password made for Postwise. |
| Service URL | `service` | no | Leave empty for `https://bsky.social`. Set it only if your account is on another server. |

## How to get an app password

1. Sign in to Bluesky.
2. Open Settings and find App Passwords (at the time of writing it is under Privacy and Security).
   Direct link: <https://bsky.app/settings/app-passwords>
3. Add a new app password, name it `postwise`, and copy it. It looks like `xxxx-xxxx-xxxx-xxxx`.
4. Paste it into Postwise (Settings, Bluesky). Never use your main password.

You can delete the app password from the same page to cut off Postwise. Protocol docs: <https://atproto.com/>.

## Limits and common errors

| You see | Meaning |
|---|---|
| `the Bluesky text is N characters; the limit is 300` | Shorten it. |
| `image N is X KB; Bluesky takes at most 976 KB` | Resize or compress the image. |
| `video not supported on Bluesky adapter yet` | Remove the video. |
| `bluesky login 401: ...` | Wrong handle or app password. |
| `bluesky ... 429` | Rate limited; Postwise retries after 2, 10 and 30 minutes. |
