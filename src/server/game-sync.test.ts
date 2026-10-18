import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyGameEvents, loadGameForUser, type GameRow } from "./game-sync.js";
import { migrateGameData } from "./migrations.js";
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
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY); INSERT INTO user (id) VALUES ('alice'), ('bob')");
    migrateGameData(db);
  });
  afterEach(() => db.close());

  for (const level of ["let", "normal", "svaer", "ekspert"] as LevelId[]) {
    it(`håndhæver ${level} grænsen, også ved direkte kald og retry`, () => {
      const puzzle = insertPuzzle(level);
      const moves = puzzle.words.slice(0, HINT_LIMIT[level]).map((word) => event("hint", word));
      const result = apply(puzzle.id, moves);
      expect(result.hints).toEqual(moves.map((move) => move.word));
      expect(result.acknowledged).toEqual(moves.map((move) => move.id));
      const retry = apply(puzzle.id, moves);
      expect(retry).toMatchObject({ hints: result.hints, revision: result.revision, acknowledged: result.acknowledged, rejected: [] });
      const again = event("hint", puzzle.words[0]);
      expect(apply(puzzle.id, [again])).toMatchObject({ acknowledged: [again.id], rejected: [] });
      const over = event("hint", puzzle.words[HINT_LIMIT[level]]);
      expect(apply(puzzle.id, [over]).rejected).toEqual([{ id: over.id, error: "Alle hints på denne bane er brugt." }]);
      expect(row(puzzle.id).hints).toBe(JSON.stringify(result.hints));
    });
  }

  it("gemmer gyldige træk og afviser kun det ugyldige i samme batch", () => {
    const puzzle = insertPuzzle("let");
    apply(puzzle.id, [event("hint", puzzle.words[0])]);
    const word = puzzle.words[1];
    const find = { ...event("find", word), ...findWord(puzzle, word)! };
    const overBudget = event("hint", puzzle.words[2]);
    const badFind = { ...event("find", puzzle.words[3]), start: { row: 0, col: 0 }, end: { row: 0, col: 0 } };
    const result = apply(puzzle.id, [find, overBudget, badFind]);
    expect(result.found).toEqual([word]);
    expect(result.acknowledged).toEqual([find.id]);
    expect(result.rejected.map((item) => item.id)).toEqual([overBudget.id, badFind.id]);
    expect(JSON.parse(row(puzzle.id).found)).toEqual([word]);
  });

  it("afviser genbrug af et hændelses-ID med anden payload", () => {
    const puzzle = insertPuzzle("let");
    const hint = event("hint", puzzle.words[0]);
    apply(puzzle.id, [hint]);
    const reused = { ...hint, word: puzzle.words[1] };
    expect(apply(puzzle.id, [reused]).rejected).toEqual([{ id: hint.id, error: "Hændelses-ID'et er allerede brugt til en anden hændelse." }]);
    expect(JSON.parse(row(puzzle.id).hints)).toEqual([puzzle.words[0]]);
  });

  it("gennemfører kun, når alle fund er modtaget, og afviser træk efter afslutning", () => {
    const puzzle = insertPuzzle("let");
    const finds = puzzle.words.map((word) => ({ ...event("find", word), ...findWord(puzzle, word)! }));
    const early = event("complete");
    expect(apply(puzzle.id, [finds[0], early]).rejected).toEqual([{ id: early.id, error: "Der mangler stadig ord." }]);
    const complete = event("complete");
    const late = event("hint", puzzle.words[0]);
    const result = apply(puzzle.id, [...finds.slice(1), complete, late]);
    expect(result.completed).toBe(true);
    expect(result.rejected).toEqual([{ id: late.id, error: "Banen er allerede afsluttet." }]);
    expect(JSON.parse(row(puzzle.id).hints)).toEqual([]);
  });

  it("opgiver en bane uden gennemførelse og afviser senere træk", () => {
    const puzzle = insertPuzzle("let");
    const word = puzzle.words[0];
    const find = { ...event("find", word), ...findWord(puzzle, word)! };
    const giveUp = event("abandon");
    const result = apply(puzzle.id, [find, giveUp]);
    expect(result).toMatchObject({ found: [word], completed: false, abandoned: true, rejected: [] });
    expect(apply(puzzle.id, [giveUp])).toMatchObject({ acknowledged: [giveUp.id], rejected: [] });
    const late = event("hint", puzzle.words[1]);
    expect(apply(puzzle.id, [late]).rejected).toEqual([{ id: late.id, error: "Banen er opgivet." }]);
    expect(row(puzzle.id)).toMatchObject({ completed: 0, abandoned: 1 });
  });

  it("bevarer gamle baner over grænsen og afviser kun nye hints", () => {
    const puzzle = insertPuzzle("let");
    const previous = puzzle.words.slice(0, 2);
    db.prepare("UPDATE game SET hints = ? WHERE id = ?").run(JSON.stringify(previous), puzzle.id);
    expect(apply(puzzle.id, [event("hint", puzzle.words[2])]).rejected[0]?.error).toBe("Alle hints på denne bane er brugt.");
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
