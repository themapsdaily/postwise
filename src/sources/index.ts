/**
 * Source registry. TypeScript sources: add them to `sources` below.
 * Script sources: list them in sources.yaml (see sources.example.yaml).
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { z } from "zod";
import { PLATFORMS } from "../core/types";
import type { DraftInput } from "../core/types";
import type { Source } from "../core/source";

export const sources: Source[] = [];

const Draft = z.object({
  caption: z.string(),
  platforms: z.array(z.enum(PLATFORMS)).optional(),
  perPlatform: z.partialRecord(z.enum(PLATFORMS), z.string()).optional(),
  media: z.array(z.object({ src: z.string(), alt: z.string().optional() })).optional(),
  at: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  key: z.string().min(1).max(200).optional(),
});

const Entry = z.object({
  id: z.string().min(1),
  schedule: z.string().min(1),
  command: z.string().min(1),
  autoApprove: z.boolean().optional(),
  timeoutSeconds: z.number().positive().optional(),
});

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/** Env vars a script never sees: the app's own secrets. */
const SECRET_ENV = ["ADMIN_PASSWORD", "APP_SECRET", "WEBHOOK_TOKEN", "SMTP_URL"];

/** The worker's environment minus its secrets, plus what the script needs to know. */
export function scriptEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const k of SECRET_ENV) delete env[k];
  return env;
}

function runCommand(command: string, timeoutS: number, env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, cwd: REPO_ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let err = "";
    let timedOut = false;
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutS * 1000);
    const tail = () => err.trim().slice(-500);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (timedOut) return reject(new Error(`Timed out after ${timeoutS}s. ${tail()}`));
      if (code !== 0) return reject(new Error(`Exited with code ${code}. ${tail()}`));
      resolve(out);
    });
  });
}

/** Read sources.yaml; a missing file means no script sources. */
export function loadScriptSources(file: string): Source[] {
  if (!fs.existsSync(file)) return [];
  const doc = parse(fs.readFileSync(file, "utf8"));
  const entries = z.array(Entry).parse(Array.isArray(doc) ? doc : (doc?.sources ?? []));
  return entries.map((e): Source => ({
    id: e.id,
    schedule: e.schedule,
    autoApprove: e.autoApprove,
    async run(ctx): Promise<DraftInput[]> {
      // SINCE: when this source last ran, so a script can fetch only what is new.
      const env = scriptEnv({ POSTWISE_SOURCE_ID: e.id, ...(ctx.lastRunAt ? { SINCE: ctx.lastRunAt } : {}) });
      const out = await runCommand(e.command, e.timeoutSeconds ?? 120, env);
      let json: unknown;
      try { json = JSON.parse(out); } catch { throw new Error(`Source ${e.id}: stdout is not JSON: ${out.slice(0, 200)}`); }
      const r = z.array(Draft).safeParse(json);
      if (!r.success) throw new Error(`Source ${e.id}: output is not a DraftInput array: ${r.error.message.slice(0, 400)}`);
      return r.data;
    },
  }));
}
