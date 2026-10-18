import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { achievementsForUser, statsForUser } from "./achievements.js";
import { applyGameEvents, type GameRow } from "./game-sync.js";
import { migrateGameData } from "./migrations.js";
import { findWord, makePuzzle, type Move, type Puzzle } from "../shared/game.js";
import type { CategoryId, LevelId } from "../shared/words.js";

let db: Database.Database;
let serial = 0;

function game(userId: string, category: CategoryId, level: LevelId = "let", seed = 1): Puzzle {
  const puzzle = makePuzzle(`g-${++serial}`, category, level, seed);
  db.prepare("INSERT INTO game (id, user_id, category, level, puzzle) VALUES (?, ?, ?, ?, ?)").run(puzzle.id, userId, category, level, JSON.stringify(puzzle));
  return puzzle;
}
const row = (id: string) => db.prepare("SELECT * FROM game WHERE id = ?").get(id) as GameRow;
const find = (puzzle: Puzzle, word: string): Move => ({ id: `e-${++serial}`, kind: "find", word, ...findWord(puzzle, word)! });
function play(userId: string, puzzle: Puzzle, events: Move[]) { return applyGameEvents(db, row(puzzle.id), userId, events); }
function complete(userId: string, puzzle: Puzzle, extra: Move[] = []) {
  return play(userId, puzzle, [...extra, ...puzzle.words.map((word) => find(puzzle, word)), { id: `e-${++serial}`, kind: "complete" }]);
}
const unlocked = (userId: string) => achievementsForUser(db, userId).filter((item) => item.unlocked).map((item) => item.id).sort();
const awards = () => (db.prepare("SELECT COUNT(*) AS count FROM achievement_award").get() as { count: number }).count;

describe("achievement-motor", () => {
  beforeEach(() => {
    serial = 0;
    db = new Database(":memory:");
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY); INSERT INTO user (id) VALUES ('alice'), ('bob')");
    migrateGameData(db);
  });
  afterEach(() => db.close());

  it("tildeler hvert mål én gang i samme transaktion som hændelsen og bevarer tidspunktet", () => {
    const puzzle = game("alice", "dyr");
    const events = [...puzzle.words.map((word) => find(puzzle, word)), { id: "done", kind: "complete" } as Move];
    play("alice", puzzle, events);
    expect(unlocked("alice")).toEqual(["categories-1", "completed-1", "let-1", "nohint-1"]);
    const first = achievementsForUser(db, "alice").find((item) => item.id === "completed-1")!.unlockedAt;
    expect(first).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const count = awards();
    play("alice", puzzle, events);
    achievementsForUser(db, "alice");
    expect(awards()).toBe(count);
    expect(achievementsForUser(db, "alice").find((item) => item.id === "completed-1")!.unlockedAt).toBe(first);
  });

  it("giver ikke hintfri eller gennemførte mål for baner med hint eller opgivelse", () => {
    const hinted = game("alice", "dyr");
    complete("alice", hinted, [{ id: "h", kind: "hint", word: hinted.words[0] }]);
    expect(unlocked("alice")).not.toContain("nohint-1");
    const given = game("bob", "dyr");
    play("bob", given, [find(given, given.words[0]), { id: "quit", kind: "abandon" }]);
    expect(unlocked("bob")).toEqual([]);
  });

  it("tæller unikke ordformer, Æ/Ø/Å og niveauer fra validerede fund", () => {
    for (let seed = 1; seed <= 2; seed++) complete("alice", game("alice", "dyr", "let", seed));
    const items = achievementsForUser(db, "alice");
    const progress = (id: string) => items.find((item) => item.id === id)!.current;
    const words = (db.prepare("SELECT word FROM game_event WHERE kind = 'find'").all() as Array<{ word: string }>).map((item) => item.word);
    expect(progress("found-10")).toBe(Math.min(10, words.length));
    expect(progress("unique-25")).toBe(new Set(words).size);
    expect(progress("danish-10")).toBe(words.filter((word) => /[ÆØÅ]/.test(word)).length);
    expect(progress("let-10")).toBe(2);
    expect(progress("normal-1")).toBe(0);
  });

  it("tæller et ord i flere kategorier under den spillede banes kategori", () => {
    // FISK belongs to both Dyr and Mad.
    const animals = game("alice", "dyr", "let", 3);
    const food = game("alice", "mad", "let", 3);
    const insert = db.prepare("INSERT INTO game_event (id, game_id, user_id, kind, word) VALUES (?, ?, 'alice', 'find', 'FISK')");
    insert.run("fisk-1", animals.id);
    insert.run("fisk-2", food.id);
    const stats = statsForUser(db, "alice");
    expect(stats.byCategory).toEqual([{ category: "dyr", completed: 0, found: 1 }, { category: "mad", completed: 0, found: 1 }]);
    expect(achievementsForUser(db, "alice").find((item) => item.id === "category-words-100")!.current).toBe(1);
    expect(stats.categoryTagVersion).toBe(1);
    expect(statsForUser(db, "bob").byCategory).toEqual([]);
  });

  it("fratager aldrig en tildelt achievement", () => {
    complete("alice", game("alice", "dyr"));
    db.prepare("DELETE FROM game").run();
    expect(unlocked("alice")).toContain("completed-1");
    expect(unlocked("bob")).toEqual([]);
  });
});
