import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { achievementsForUser, statsForUser } from "./achievements.js";
import { applyGameEvents, type GameRow } from "./game-sync.js";
import { migrateGameData } from "./migrations.js";
import { findWord, makePuzzle, type Move, type Puzzle } from "../shared/game.js";
import { CATEGORY_TAG_VERSION, type CategoryId, type LevelId } from "../shared/words.js";

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
    expect(stats.categoryTagVersion).toBe(CATEGORY_TAG_VERSION);
    expect(statsForUser(db, "bob").byCategory).toEqual([]);
  });

  it("tæller spilledage som forskellige datoer med fund, uden krav om dage i træk", () => {
    const puzzle = game("alice", "dyr");
    const insert = db.prepare("INSERT INTO game_event (id, game_id, user_id, kind, word, created_at) VALUES (?, ?, 'alice', ?, ?, ?)");
    const days = ["2026-01-02", "2026-01-05", "2026-02-10", "2026-03-01", "2026-04-15", "2026-06-30", "2026-09-09"];
    days.forEach((day, index) => insert.run(`d-${index}`, puzzle.id, "find", `ORD${index}`, `${day} 12:00:00`));
    insert.run("same-day", puzzle.id, "find", "ORDX", "2026-09-09 12:30:00");
    insert.run("hint-day", puzzle.id, "hint", "ORDY", "2026-10-01 12:00:00");
    const items = achievementsForUser(db, "alice");
    expect(items.find((item) => item.id === "days-7")?.unlocked).toBe(true);
    expect(items.find((item) => item.id === "days-30")?.current).toBe(7);
  });

  it("tæller kampagnebaner, kategorier, baner uden hint og længste forløb uden opgivelse", () => {
    db.prepare("INSERT INTO campaign (id, user_id, level) VALUES ('kamp', 'alice', 'let')").run();
    const queue = db.prepare("INSERT INTO campaign_game (campaign_id, position, game_id, retired) VALUES ('kamp', ?, ?, ?)");
    const categories: CategoryId[] = ["dyr", "mad", "natur", "sport", "vejret", "dyr", "mad", "natur"];
    categories.forEach((category, index) => {
      const puzzle = game("alice", category, "let", index + 1);
      queue.run(index + 1, puzzle.id, 0);
      if (index === 3) play("alice", puzzle, [{ id: `quit-${index}`, kind: "abandon" }]);
      else if (index === 7) return; // Still waiting in the queue.
      else complete("alice", puzzle, index === 0 ? [{ id: `h-${index}`, kind: "hint", word: puzzle.words[0] }] : []);
    });
    // A single game outside the campaign does not count.
    complete("alice", game("alice", "skolen"));
    const progress = (id: string) => achievementsForUser(db, "alice").find((item) => item.id === id)!;
    expect(progress("campaign-5")).toMatchObject({ current: 5, unlocked: true });
    expect(progress("campaign-25").current).toBe(6);
    // Sport was abandoned, so dyr, mad, natur and vejret count.
    expect(progress("campaign-categories-5").current).toBe(4);
    expect(progress("campaign-nohint-10").current).toBe(5);
    // Positions 1–3 completed, 4 abandoned, 5–7 completed: the longest run is 3.
    expect(progress("campaign-run-10").current).toBe(3);
    expect(achievementsForUser(db, "bob").find((item) => item.id === "campaign-5")!.current).toBe(0);
  });

  it("fratager aldrig en tildelt achievement", () => {
    complete("alice", game("alice", "dyr"));
    db.prepare("DELETE FROM game").run();
    expect(unlocked("alice")).toContain("completed-1");
    expect(unlocked("bob")).toEqual([]);
  });
});
