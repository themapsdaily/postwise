/** The one SQLite store this server process shares. Opened on first use. */

import path from "node:path";
import { openStore, type SqliteStore } from "../store/sqlite";

export const dataDir = () => path.resolve(process.env.DATA_DIR ?? "./data");

const g = globalThis as unknown as { __postwiseStore?: SqliteStore; __postwiseStorePath?: string };

export function getStore(): SqliteStore {
  const file = path.join(dataDir(), "postwise.db");
  if (!g.__postwiseStore || g.__postwiseStorePath !== file) {
    g.__postwiseStore?.close();
    g.__postwiseStore = openStore(file);
    g.__postwiseStorePath = file;
  }
  return g.__postwiseStore;
}
