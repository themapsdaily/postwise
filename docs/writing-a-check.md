# Writing a check

A check looks at a post before it can be approved: a banned word, a missing link, a hashtag count.
Two checks ship in `src/checks/`: `length` (per-platform character limits) and `media` (platform media rules).

## The interface

From `src/core/check.ts`:

```ts
interface Check {
  id: string;
  run(post: Post): CheckResult[];
}

interface CheckResult {
  checkId: string;
  level: "error" | "warn";
  platform?: Platform;   // set it when the problem is on one platform only
  message: string;
}
```

- `error` blocks approval (the API answers 422 with the results). `warn` is shown but does not block.
- Return `[]` when the post is fine.
- A check that throws is turned into a `warn` saying it crashed; it does not break the others.
- Checks must be **pure and fast**: no network, no file reads, no clock. The composer runs them in the
  browser on every keystroke, so they cannot import Node modules either.
- Use `textFor(post, platform)` from `src/core/adapter.ts` to get the text a platform will receive
  (its `perPlatform` text, else the caption).

## Example

`examples/checks/no-banned-words.ts` blocks a post when its text for any selected platform contains a word
or phrase from a list (whole words, any case). It reports one error per platform and word.

## Register it

Add it to the list in `src/checks/index.ts`:

```ts
import { noBannedWords } from "../../examples/checks/no-banned-words";

export const checks: Check[] = [lengthCheck, mediaCheck, noBannedWords];
```

Or copy the file into `src/checks/` and import it with `./no-banned-words`. Edit the `BANNED` list in the file.
If you run Docker, rebuild: `docker compose build && docker compose up -d`.

## Test it

The dry-run CLI shows what adapters send and does not run checks, so test a check with a small unit test.
Put this in `tests/no-banned-words.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { noBannedWords } from "../examples/checks/no-banned-words";
import type { Post } from "../src/core/types";

const post = (caption: string): Post => ({
  id: "t", status: "draft", caption, perPlatform: {}, platforms: ["bluesky"], media: [],
  slotAt: null, source: "manual", meta: {}, createdAt: "", updatedAt: "",
});

test("flags a banned word", () => {
  const r = noBannedWords.run(post("This is guaranteed to work"));
  assert.equal(r.length, 1);
  assert.equal(r[0].level, "error");
});

test("lets a clean post through", () => {
  assert.deepEqual(noBannedWords.run(post("Hello")), []);
});
```

```bash
npm test
```

You can also see the live result for a saved post (while signed in, from the browser, or with your session
cookie): `GET /api/posts/<id>/checks` returns the `CheckResult[]`.
