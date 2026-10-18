import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type Database from "better-sqlite3";

// First-administrator setup on a new installation. While the database has no accounts,
// a one-time token in the data folder lets the owner create the administrator in the
// app. The token is shown in the server log and removed once an account exists.
export function setupTokenPath(dataFile: string): string {
  return resolve(dirname(dataFile), "setup-token");
}

export function setupNeeded(db: Database.Database): boolean {
  return (db.prepare("SELECT COUNT(*) AS count FROM user").get() as { count: number }).count === 0;
}

export function prepareSetupToken(db: Database.Database, dataFile: string): string | null {
  const path = setupTokenPath(dataFile);
  if (!setupNeeded(db)) {
    rmSync(path, { force: true });
    return null;
  }
  if (!existsSync(path)) writeFileSync(path, randomBytes(24).toString("hex"), { mode: 0o600, flag: "wx" });
  return readFileSync(path, "utf8").trim();
}

export function setupTokenMatches(dataFile: string, candidate: string): boolean {
  const path = setupTokenPath(dataFile);
  if (!existsSync(path)) return false;
  const expected = Buffer.from(readFileSync(path, "utf8").trim());
  const given = Buffer.from(candidate);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function finishSetup(dataFile: string): void {
  rmSync(setupTokenPath(dataFile), { force: true });
}
