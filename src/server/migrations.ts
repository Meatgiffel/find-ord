import type Database from "better-sqlite3";
import type { Puzzle } from "../shared/game.js";
import { revalidateLegacyPuzzle } from "../shared/validation.js";

type Migration = { version: number; apply: (db: Database.Database) => void };

const migrations: Migration[] = [
  {
    version: 1,
    apply(db) {
      // These definitions match the first playable release. IF NOT EXISTS adopts
      // installations created before this migration ledger was introduced.
      db.exec(`
        CREATE TABLE IF NOT EXISTS profile (
          user_id TEXT PRIMARY KEY,
          child INTEGER NOT NULL DEFAULT 0 CHECK (child IN (0,1)),
          FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS game (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          category TEXT NOT NULL,
          level TEXT NOT NULL,
          puzzle TEXT NOT NULL,
          found TEXT NOT NULL DEFAULT '[]',
          hints TEXT NOT NULL DEFAULT '[]',
          completed INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS game_user_created ON game(user_id, created_at DESC);
        CREATE TABLE IF NOT EXISTS game_event (
          id TEXT PRIMARY KEY,
          game_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          word TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE,
          FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 2,
    apply(db) {
      db.exec(`
        ALTER TABLE game ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
        CREATE UNIQUE INDEX game_one_find_per_word ON game_event(game_id, word) WHERE kind = 'find';
        CREATE UNIQUE INDEX game_one_completion ON game_event(game_id) WHERE kind = 'complete';
        CREATE INDEX game_event_user_kind ON game_event(user_id, kind);
      `);
    }
  },
  {
    version: 3,
    apply(db) {
      const legacy = db.prepare("SELECT id, puzzle FROM game WHERE json_valid(puzzle) AND json_extract(puzzle, '$.validationVersion') IS NULL").all() as Array<{ id: string; puzzle: string }>;
      const update = db.prepare("UPDATE game SET puzzle = ? WHERE id = ?");
      for (const row of legacy) {
        try {
          const puzzle = revalidateLegacyPuzzle(JSON.parse(row.puzzle) as Puzzle);
          if (puzzle) update.run(JSON.stringify(puzzle), row.id);
        } catch { /* Invalid legacy data stays unavailable for delivery. */ }
      }
    }
  },
  {
    version: 4,
    apply(db) {
      db.exec(`
        CREATE TABLE campaign (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          level TEXT NOT NULL CHECK (level IN ('let', 'normal', 'svaer', 'ekspert')),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (user_id, level),
          FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
        );
        CREATE TABLE campaign_game (
          campaign_id TEXT NOT NULL,
          position INTEGER NOT NULL CHECK (position > 0),
          game_id TEXT NOT NULL UNIQUE,
          retired INTEGER NOT NULL DEFAULT 0 CHECK (retired IN (0,1)),
          PRIMARY KEY (campaign_id, position),
          FOREIGN KEY (campaign_id) REFERENCES campaign(id) ON DELETE CASCADE,
          FOREIGN KEY (game_id) REFERENCES game(id) ON DELETE CASCADE
        );
        CREATE INDEX campaign_game_queue ON campaign_game(campaign_id, retired, position);
      `);
    }
  },
  {
    version: 5,
    apply(db) {
      // An abandoned game is finished without a completion reward.
      db.exec(`
        ALTER TABLE game ADD COLUMN abandoned INTEGER NOT NULL DEFAULT 0 CHECK (abandoned IN (0,1));
        CREATE UNIQUE INDEX game_one_abandon ON game_event(game_id) WHERE kind = 'abandon';
      `);
    }
  },
  {
    version: 6,
    apply(db) {
      // One award per account and achievement, kept with the time it was first reached.
      db.exec(`
        CREATE TABLE achievement_award (
          user_id TEXT NOT NULL,
          achievement_id TEXT NOT NULL,
          catalog_version INTEGER NOT NULL,
          awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, achievement_id),
          FOREIGN KEY (user_id) REFERENCES user(id) ON DELETE CASCADE
        );
      `);
    }
  },
  {
    version: 7,
    apply(db) {
      // A built-in avatar per player, and a version that increases with every child-flag change.
      db.exec(`
        ALTER TABLE profile ADD COLUMN avatar TEXT;
        ALTER TABLE profile ADD COLUMN policy_version INTEGER NOT NULL DEFAULT 1;
      `);
    }
  },
  {
    version: 8,
    apply(db) {
      // Ready, validated puzzles waiting for a player, and client request IDs for new
      // games so a repeated request returns the same game.
      db.exec(`
        CREATE TABLE puzzle_cache (
          id TEXT PRIMARY KEY,
          cache_key TEXT NOT NULL,
          puzzle TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE INDEX puzzle_cache_key ON puzzle_cache (cache_key, created_at);
        CREATE TABLE game_request (
          user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
          request_id TEXT NOT NULL,
          params TEXT NOT NULL,
          game_id TEXT NOT NULL REFERENCES game(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (user_id, request_id)
        );
      `);
    }
  }
];

export const LATEST_MIGRATION = migrations.at(-1)!.version;

export function migrateGameData(db: Database.Database): void {
  db.exec(`CREATE TABLE IF NOT EXISTS app_schema_migration (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const newest = (db.prepare("SELECT MAX(version) AS version FROM app_schema_migration").get() as { version: number | null }).version;
  if (newest !== null && newest > migrations.at(-1)!.version) throw new Error("Databasen er fra en nyere udgave af Find ord.");
  for (const migration of migrations) {
    try {
      db.transaction(() => {
        if (db.prepare("SELECT 1 FROM app_schema_migration WHERE version = ?").get(migration.version)) return;
        migration.apply(db);
        db.prepare("INSERT INTO app_schema_migration (version) VALUES (?)").run(migration.version);
      })();
    } catch (cause) {
      throw new Error(`Databasemigration ${migration.version} mislykkedes; eksisterende data er bevaret.`, { cause });
    }
  }
}
