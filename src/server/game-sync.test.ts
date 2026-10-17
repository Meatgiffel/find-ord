import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGameEvents, GameSyncError, loadGameForUser, type GameRow } from "./game-sync.js";
import { findWord, HINT_LIMIT, makePuzzle, type Move, type Puzzle } from "../shared/game.js";
import { CATEGORIES, availableLevels, type CategoryId, type LevelId } from "../shared/words.js";

let db: Database.Database;
let serial = 0;
const event = (kind: Move["kind"], word?: string): Move => ({ id: `event-${++serial}`, kind, word });

function insertPuzzle(level: LevelId): Puzzle {
  // No built-in category currently has enough words for Expert. Exercise the
  // shared limit with an Expert-level fixture until that level is playable.
  const generatedLevel = level === "ekspert" ? "svaer" : level;
  const category = (Object.keys(CATEGORIES) as CategoryId[]).find((id) => availableLevels(id).includes(generatedLevel))!;
  const puzzle = { ...makePuzzle(`game-${level}`, category, generatedLevel, 91), level };
  db.prepare("INSERT INTO game (id, user_id, category, level, puzzle, found, hints, completed, revision) VALUES (?, 'alice', ?, ?, ?, '[]', '[]', 0, 0)")
    .run(puzzle.id, category, level, JSON.stringify(puzzle));
  return puzzle;
}
function row(id: string): GameRow { return db.prepare("SELECT * FROM game WHERE id = ?").get(id) as GameRow; }
function apply(id: string, events: Move[]) { return applyGameEvents(db, row(id), "alice", events); }

describe("serverens hintbudget", () => {
  beforeEach(() => {
    serial = 0;
    db = new Database(":memory:");
    db.exec("CREATE TABLE game (id TEXT PRIMARY KEY, user_id TEXT, category TEXT, level TEXT, puzzle TEXT, found TEXT, hints TEXT, completed INTEGER, revision INTEGER); CREATE TABLE game_event (id TEXT PRIMARY KEY, game_id TEXT, user_id TEXT, kind TEXT, word TEXT)");
  });
  afterEach(() => db.close());

  for (const level of ["let", "normal", "svaer", "ekspert"] as LevelId[]) {
    it(`håndhæver ${level} grænsen, også ved direkte kald og retry`, () => {
      const puzzle = insertPuzzle(level);
      const moves = puzzle.words.slice(0, HINT_LIMIT[level]).map((word) => event("hint", word));
      const result = apply(puzzle.id, moves);
      expect(result.hints).toEqual(moves.map((move) => move.word));
      expect(apply(puzzle.id, moves)).toEqual(result);
      expect(apply(puzzle.id, [event("hint", puzzle.words[0])])).toEqual(result);
      expect(() => apply(puzzle.id, [event("hint", puzzle.words[HINT_LIMIT[level]])])).toThrow("Alle hints på denne bane er brugt.");
      expect(row(puzzle.id).hints).toBe(JSON.stringify(result.hints));
    });
  }

  it("ruller et batch tilbage ved konflikt, så gyldige fund kan prøves igen", () => {
    const puzzle = insertPuzzle("let");
    const firstHint = event("hint", puzzle.words[0]);
    apply(puzzle.id, [firstHint]);
    const word = puzzle.words[1];
    const find = { ...event("find", word), ...findWord(puzzle, word)! };
    const rejected = event("hint", puzzle.words[2]);
    try { apply(puzzle.id, [find, rejected]); throw new Error("Forventede konflikt."); }
    catch (cause) {
      expect(cause).toBeInstanceOf(GameSyncError);
      expect((cause as GameSyncError).rejectedHintId).toBe(rejected.id);
    }
    expect(JSON.parse(row(puzzle.id).found)).toEqual([]);
    expect(apply(puzzle.id, [find]).found).toEqual([word]);
  });

  it("bevarer gamle baner over grænsen og afviser kun nye hints", () => {
    const puzzle = insertPuzzle("let");
    const previous = puzzle.words.slice(0, 2);
    db.prepare("UPDATE game SET hints = ? WHERE id = ?").run(JSON.stringify(previous), puzzle.id);
    expect(() => apply(puzzle.id, [event("hint", puzzle.words[2])])).toThrow("Alle hints på denne bane er brugt.");
    expect(JSON.parse(row(puzzle.id).hints)).toEqual(previous);
  });

  it("holder to brugeres baner og hændelser adskilt", () => {
    const puzzle = insertPuzzle("let");
    expect(loadGameForUser(db, puzzle.id, "bob")).toBeUndefined();
    expect(() => applyGameEvents(db, row(puzzle.id), "bob", [event("hint", puzzle.words[0])])).toThrow("Banen blev ikke fundet.");
    expect(JSON.parse(row(puzzle.id).hints)).toEqual([]);
    expect((db.prepare("SELECT COUNT(*) AS count FROM game_event").get() as { count: number }).count).toBe(0);
  });
});
