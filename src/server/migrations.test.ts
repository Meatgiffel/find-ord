import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { makePuzzle } from "../shared/game.js";
import { migrateGameData } from "./migrations.js";

function legacyDatabase(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE user (id TEXT PRIMARY KEY);
    INSERT INTO user (id) VALUES ('alice');
    CREATE TABLE profile (user_id TEXT PRIMARY KEY, child INTEGER NOT NULL DEFAULT 0);
    INSERT INTO profile (user_id, child) VALUES ('alice', 1);
    CREATE TABLE game (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, category TEXT NOT NULL, level TEXT NOT NULL,
      puzzle TEXT NOT NULL, found TEXT NOT NULL DEFAULT '[]', hints TEXT NOT NULL DEFAULT '[]',
      completed INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE game_event (
      id TEXT PRIMARY KEY, game_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL,
      word TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const puzzle = makePuzzle("old-game", "dyr", "let", 29, true);
  const { wordListVersion: _words, categoryTagVersion: _category, validationVersion: _validation, ...legacy } = puzzle;
  db.prepare("INSERT INTO game (id, user_id, category, level, puzzle) VALUES (?, ?, ?, ?, ?)")
    .run(puzzle.id, "alice", puzzle.category, puzzle.level, JSON.stringify(legacy));
  return db;
}

describe("versionerede servermigrationer", () => {
  it("opretter tomt skema og kan køres igen uden at ændre data", () => {
    const db = new Database(":memory:");
    try {
      db.exec("CREATE TABLE user (id TEXT PRIMARY KEY)");
      migrateGameData(db);
      expect(db.prepare("SELECT version FROM app_schema_migration ORDER BY version").all()).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
      const columns = db.pragma("table_info(game)") as Array<{ name: string }>;
      expect(columns.some((column) => column.name === "revision")).toBe(true);
      migrateGameData(db);
      expect((db.prepare("SELECT COUNT(*) AS count FROM app_schema_migration").get() as { count: number }).count).toBe(4);
    } finally { db.close(); }
  });

  it("bevarer og genvaliderer eksisterende konti og baner", () => {
    const db = legacyDatabase();
    try {
      migrateGameData(db);
      const row = db.prepare("SELECT puzzle, revision FROM game WHERE id = 'old-game'").get() as { puzzle: string; revision: number };
      expect(row.revision).toBe(0);
      expect(JSON.parse(row.puzzle).validationVersion).toBe(1);
      expect((db.prepare("SELECT child FROM profile WHERE user_id = 'alice'").get() as { child: number }).child).toBe(1);
    } finally { db.close(); }
  });

  it("ruller en konfliktfyldt migration tilbage og kan genoptage efter rettelse", () => {
    const db = legacyDatabase();
    try {
      const insert = db.prepare("INSERT INTO game_event (id, game_id, user_id, kind, word) VALUES (?, 'old-game', 'alice', 'find', 'HUND')");
      insert.run("find-1");
      insert.run("find-2");
      expect(() => migrateGameData(db)).toThrow();
      expect((db.pragma("table_info(game)") as Array<{ name: string }>).some((column) => column.name === "revision")).toBe(false);
      expect((db.prepare("SELECT MAX(version) AS version FROM app_schema_migration").get() as { version: number }).version).toBe(1);
      expect((db.prepare("SELECT COUNT(*) AS count FROM game_event").get() as { count: number }).count).toBe(2);
      db.prepare("DELETE FROM game_event WHERE id = 'find-2'").run();
      migrateGameData(db);
      expect((db.prepare("SELECT MAX(version) AS version FROM app_schema_migration").get() as { version: number }).version).toBe(4);
      expect(() => insert.run("find-3")).toThrow();
    } finally { db.close(); }
  });
});
