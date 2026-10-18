import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { LATEST_MIGRATION } from "./migrations.js";
import { CATEGORY_TAG_VERSION, WORD_LIST_VERSION } from "../shared/words.js";
import { CHILD_POLICY_VERSION } from "../shared/safety.js";
import { VALIDATION_VERSION } from "../shared/validation.js";

const DATABASE = "find-ord.sqlite";
const SECRET = "auth-secret";
const MANIFEST = "manifest.json";

export type BackupManifest = {
  format: 1;
  createdAt: string;
  schemaVersion: number;
  corVersion: string | null;
  versions: { words: number; categories: number; childPolicy: number; validation: number };
  counts: { users: number; games: number; events: number };
  files: Record<string, string>;
};

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkDatabase(path: string): { schemaVersion: number; corVersion: string | null; counts: BackupManifest["counts"] } {
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    const integrity = db.pragma("integrity_check", { simple: true });
    if (integrity !== "ok") throw new Error(`Databasen er beskadiget: ${integrity}`);
    const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
    const schemaVersion = (db.prepare("SELECT MAX(version) AS version FROM app_schema_migration").get() as { version: number | null }).version ?? 0;
    const cor = db.prepare("SELECT name FROM sqlite_master WHERE name = 'cor_import'").get()
      ? (db.prepare("SELECT source_version FROM cor_import ORDER BY completed_at DESC LIMIT 1").get() as { source_version: string } | undefined)?.source_version ?? null
      : null;
    return { schemaVersion, corVersion: cor, counts: { users: count("user"), games: count("game"), events: count("game_event") } };
  } finally { db.close(); }
}

// Takes a consistent snapshot of the live database with SQLite's online backup API,
// verifies it and only then gives the folder its final name. An interrupted backup
// leaves a ".partial" folder that restore refuses to use.
export async function createBackup(dataFile: string, targetRoot: string, now = new Date()): Promise<string> {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\..*/, "").replace("T", "-");
  const final = resolve(targetRoot, `find-ord-backup-${stamp}`);
  const partial = `${final}.partial`;
  if (existsSync(final)) throw new Error(`Backupmappen findes allerede: ${final}`);
  mkdirSync(partial, { recursive: true, mode: 0o700 });
  try {
    const source = new Database(dataFile, { readonly: true, fileMustExist: true });
    try { await source.backup(join(partial, DATABASE)); }
    finally { source.close(); }
    // Store the copy as a single file; the server switches back to WAL when it opens it.
    const copy = new Database(join(partial, DATABASE));
    try { copy.pragma("journal_mode = DELETE"); }
    finally { copy.close(); }
    chmodSync(join(partial, DATABASE), 0o600);
    const files: Record<string, string> = { [DATABASE]: sha256(join(partial, DATABASE)) };
    const secret = join(dirname(dataFile), SECRET);
    if (existsSync(secret)) {
      copyFileSync(secret, join(partial, SECRET));
      chmodSync(join(partial, SECRET), 0o600);
      files[SECRET] = sha256(join(partial, SECRET));
    }
    const checked = checkDatabase(join(partial, DATABASE));
    const manifest: BackupManifest = {
      format: 1, createdAt: now.toISOString(), schemaVersion: checked.schemaVersion, corVersion: checked.corVersion,
      versions: { words: WORD_LIST_VERSION, categories: CATEGORY_TAG_VERSION, childPolicy: CHILD_POLICY_VERSION, validation: VALIDATION_VERSION },
      counts: checked.counts, files
    };
    writeFileSync(join(partial, MANIFEST), JSON.stringify(manifest, null, 2), { mode: 0o600 });
    renameSync(partial, final);
    return final;
  } catch (cause) {
    rmSync(partial, { recursive: true, force: true });
    throw cause;
  }
}

// Verifies a backup completely before touching the data folder. An existing database is
// only replaced with replace=true and is first kept as "<file>.before-restore-<time>".
export function restoreBackup(backupDir: string, dataFile: string, options: { replace?: boolean; now?: Date } = {}): BackupManifest {
  if (basename(backupDir).endsWith(".partial")) throw new Error("Backuppen blev ikke fuldført og kan ikke gendannes.");
  const manifestPath = join(backupDir, MANIFEST);
  if (!existsSync(manifestPath)) throw new Error("Backuppen mangler manifest.json.");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as BackupManifest;
  if (manifest.format !== 1 || !manifest.files?.[DATABASE]) throw new Error("Ukendt backupformat.");
  for (const [file, expected] of Object.entries(manifest.files)) {
    const path = join(backupDir, file);
    if (!existsSync(path) || sha256(path) !== expected) throw new Error(`Filen ${file} mangler eller er ændret siden backup.`);
  }
  const checked = checkDatabase(join(backupDir, DATABASE));
  if (checked.schemaVersion > LATEST_MIGRATION) throw new Error("Backuppen er fra en nyere udgave af Find ord. Brug et image, der mindst svarer til backuppens version.");

  const dataDir = dirname(resolve(dataFile));
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  if (existsSync(dataFile) && !options.replace) throw new Error("Der findes allerede en database. Stop servicen og brug --replace for at erstatte den.");
  // Copy to a temporary name first, so a failed copy leaves the current database untouched.
  const temporary = `${dataFile}.restoring`;
  try {
    copyFileSync(join(backupDir, DATABASE), temporary);
    chmodSync(temporary, 0o600);
  } catch (cause) {
    rmSync(temporary, { force: true });
    throw cause;
  }
  if (existsSync(dataFile)) {
    // Keep the replaced database, including its WAL, next to the restored one.
    const suffix = `.before-restore-${(options.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\..*/, "")}`;
    renameSync(dataFile, dataFile + suffix);
    for (const extra of ["-wal", "-shm"]) if (existsSync(dataFile + extra)) renameSync(dataFile + extra, dataFile + suffix + extra);
    const secret = join(dataDir, SECRET);
    if (existsSync(secret) && manifest.files[SECRET]) renameSync(secret, secret + suffix);
  }
  renameSync(temporary, dataFile);
  if (manifest.files[SECRET]) {
    copyFileSync(join(backupDir, SECRET), join(dataDir, SECRET));
    chmodSync(join(dataDir, SECRET), 0o600);
  }
  return manifest;
}
