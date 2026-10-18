import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "./backup.js";
import { migrateGameData } from "./migrations.js";

let root: string;
const live = () => join(root, "live", "find-ord.sqlite");

function liveDatabase(): Database.Database {
  mkdirSync(join(root, "live"));
  const db = new Database(live());
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT)");
  migrateGameData(db);
  db.prepare("INSERT INTO user (id, name) VALUES ('kid', 'Barn')").run();
  db.prepare("INSERT INTO profile (user_id, child) VALUES ('kid', 1)").run();
  db.prepare("INSERT INTO game (id, user_id, category, level, puzzle, found, completed) VALUES ('g1', 'kid', 'dyr', 'let', '{}', '[\"HUND\"]', 0)").run();
  db.prepare("INSERT INTO game_event (id, game_id, user_id, kind, word) VALUES ('e1', 'g1', 'kid', 'find', 'HUND')").run();
  writeFileSync(join(root, "live", "auth-secret"), "secret-value", { mode: 0o600 });
  return db;
}

function rows(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    return {
      child: (db.prepare("SELECT child FROM profile WHERE user_id = 'kid'").get() as { child: number }).child,
      found: (db.prepare("SELECT found FROM game WHERE id = 'g1'").get() as { found: string }).found,
      events: (db.prepare("SELECT COUNT(*) AS count FROM game_event").get() as { count: number }).count
    };
  } finally { db.close(); }
}

describe("backup og restore", () => {
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "find-ord-backup-")); });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("tager et konsistent snapshot af en kørende database og gendanner det på en ren installation", async () => {
    const db = liveDatabase();
    // The last write is still only in the WAL file while the server runs.
    db.prepare("UPDATE game SET found = '[\"HUND\",\"KAT\"]' WHERE id = 'g1'").run();
    const folder = await createBackup(live(), join(root, "backups"), new Date("2026-10-18T12:00:00Z"));
    db.close();
    expect(folder.endsWith("find-ord-backup-20261018-120000")).toBe(true);
    const manifest = JSON.parse(readFileSync(join(folder, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({ format: 1, schemaVersion: 5, counts: { users: 1, games: 1, events: 1 } });
    expect(statSync(join(folder, "find-ord.sqlite")).mode & 0o777).toBe(0o600);

    const restored = join(root, "new", "find-ord.sqlite");
    restoreBackup(folder, restored);
    expect(rows(restored)).toEqual({ child: 1, found: "[\"HUND\",\"KAT\"]", events: 1 });
    expect(readFileSync(join(root, "new", "auth-secret"), "utf8")).toBe("secret-value");
  });

  it("afviser afbrudte, beskadigede og nyere backups uden at røre den aktuelle database", async () => {
    liveDatabase().close();
    const folder = await createBackup(live(), join(root, "backups"));
    const before = readFileSync(live());

    mkdirSync(join(root, "backups", "find-ord-backup-x.partial"));
    expect(() => restoreBackup(join(root, "backups", "find-ord-backup-x.partial"), live(), { replace: true })).toThrow("ikke fuldført");

    const damaged = join(root, "damaged");
    mkdirSync(damaged);
    for (const file of readdirSync(folder)) writeFileSync(join(damaged, file), readFileSync(join(folder, file)));
    const bytes = readFileSync(join(damaged, "find-ord.sqlite"));
    bytes[bytes.length - 100] ^= 0xff;
    writeFileSync(join(damaged, "find-ord.sqlite"), bytes);
    expect(() => restoreBackup(damaged, live(), { replace: true })).toThrow("ændret siden backup");

    expect(() => restoreBackup(folder, live())).toThrow("--replace");
    expect(readFileSync(live()).equals(before)).toBe(true);
    expect(readdirSync(join(root, "live")).some((file) => file.includes("before-restore"))).toBe(false);
  });

  it("gemmer den erstattede database ved --replace og afviser backups fra en nyere udgave", async () => {
    liveDatabase().close();
    const folder = await createBackup(live(), join(root, "backups"));
    const replaced = new Database(live());
    replaced.prepare("DELETE FROM game_event").run();
    replaced.close();
    restoreBackup(folder, live(), { replace: true, now: new Date("2026-10-18T13:00:00Z") });
    expect(rows(live()).events).toBe(1);
    expect(existsSync(`${live()}.before-restore-20261018T130000`)).toBe(true);

    const newer = new Database(join(folder, "find-ord.sqlite"));
    newer.prepare("INSERT INTO app_schema_migration (version) VALUES (999)").run();
    newer.close();
    const manifestPath = join(folder, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const { createHash } = await import("node:crypto");
    manifest.files["find-ord.sqlite"] = createHash("sha256").update(readFileSync(join(folder, "find-ord.sqlite"))).digest("hex");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(() => restoreBackup(folder, join(root, "other", "find-ord.sqlite"))).toThrow("nyere udgave");
  });
});
