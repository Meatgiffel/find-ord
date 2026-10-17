import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
export { migrateGameData } from "./migrations.js";

export const dataFile = resolve(process.env.DATA_FILE || "data/find-ord.sqlite");
mkdirSync(dirname(dataFile), { recursive: true });
export const db = new Database(dataFile);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

export function authSecret(): string {
  if (process.env.BETTER_AUTH_SECRET) return process.env.BETTER_AUTH_SECRET;
  const path = resolve(dirname(dataFile), "auth-secret");
  if (!existsSync(path)) {
    writeFileSync(path, randomBytes(48).toString("hex"), { mode: 0o600, flag: "wx" });
  }
  chmodSync(path, 0o600);
  return readFileSync(path, "utf8").trim();
}
