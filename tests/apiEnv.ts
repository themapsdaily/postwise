/** Test env, set before any route module opens the store. Import this first. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const dir = fs.mkdtempSync(path.join(os.tmpdir(), "postwise-api-"));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = "correct horse";
process.env.APP_SECRET = "s".repeat(40);
process.env.WEBHOOK_TOKEN = "hook-token";
process.env.PUBLIC_URL = "https://example.test";
process.env.TZ = "UTC";
