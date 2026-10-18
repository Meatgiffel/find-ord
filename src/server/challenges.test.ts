import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTIVE_CHALLENGES, MAX_CREDITS, START_CREDITS } from "../shared/challenges.js";
import { findWord, makePuzzle, type Move, type Puzzle } from "../shared/game.js";
import type { CategoryId, LevelId } from "../shared/words.js";
import { challengeState, creditBalance } from "./challenges.js";
import { applyGameEvents, NO_CREDITS, type GameRow } from "./game-sync.js";
import { migrateGameData } from "./migrations.js";

let db: Database.Database;
let serial = 0;

function game(category: CategoryId = "dyr", level: LevelId = "let", child = false): Puzzle {
  const puzzle = makePuzzle(`g-${++serial}`, category, level, serial, child);
  db.prepare("INSERT INTO game (id, user_id, category, level, puzzle) VALUES (?, 'alice', ?, ?, ?)").run(puzzle.id, category, level, JSON.stringify(puzzle));
  return puzzle;
}
const row = (id: string) => db.prepare("SELECT * FROM game WHERE id = ?").get(id) as GameRow;
const play = (puzzle: Puzzle, events: Move[]) => applyGameEvents(db, row(puzzle.id), "alice", events);
const find = (puzzle: Puzzle, word: string): Move => ({ id: `e-${++serial}`, kind: "find", word, ...findWord(puzzle, word)! });
const hint = (word: string): Move => ({ id: `e-${++serial}`, kind: "hint", word });
const finishAll = (puzzle: Puzzle): Move[] => [...puzzle.words.map((word) => find(puzzle, word)), { id: `e-${++serial}`, kind: "complete" }];
// Replaces alice's open challenges with one known challenge.
function only(kind: string, target: number, param: string | null = null) {
  challengeState(db, "alice", false);
  db.prepare("DELETE FROM challenge WHERE user_id = 'alice'").run();
  const after = (db.prepare("SELECT COALESCE(MAX(rowid), 0) AS id FROM game_event").get() as { id: number }).id;
  for (let index = 0; index < ACTIVE_CHALLENGES; index++) {
    db.prepare("INSERT INTO challenge (id, user_id, kind, param, target, after_event, created_at) VALUES (?, 'alice', ?, ?, ?, ?, datetime('now', ?))")
      .run(`c-${kind}-${index}`, index ? "find" : kind, index ? null : param, index ? 1000 : target, after, `-${10 - index} seconds`);
  }
}

describe("miniudfordringer og hintkreditter", () => {
  beforeEach(() => {
    serial = 0;
    db = new Database(":memory:");
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY); INSERT INTO user (id) VALUES ('alice')");
    migrateGameData(db);
  });
  afterEach(() => db.close());

  it("starter med to kreditter og tre forskellige aktive mål uden tidsfrist", () => {
    const state = challengeState(db, "alice", true);
    expect(state.balance).toBe(START_CREDITS);
    expect(state.max).toBe(MAX_CREDITS);
    expect(state.challenges).toHaveLength(ACTIVE_CHALLENGES);
    expect(new Set(state.challenges.map((item) => item.kind)).size).toBe(ACTIVE_CHALLENGES);
    expect(state.challenges.every((item) => item.progress === 0 && !item.completed && item.title)).toBe(true);
  });

  it("trækker én kredit pr. vist hint, aldrig to gange og aldrig under nul", () => {
    const puzzle = game("dyr", "svaer");
    const first = hint(puzzle.words[0]);
    play(puzzle, [first]);
    play(puzzle, [first]);
    expect(creditBalance(db, "alice")).toBe(1);
    play(puzzle, [hint(puzzle.words[1])]);
    expect(creditBalance(db, "alice")).toBe(0);
    const third = hint(puzzle.words[2]);
    const result = play(puzzle, [third, find(puzzle, puzzle.words[3])]);
    expect(result.rejected).toEqual([{ id: third.id, error: NO_CREDITS }]);
    expect(result.found).toEqual([puzzle.words[3]]);
    expect(result.hints).toEqual(puzzle.words.slice(0, 2));
    expect(creditBalance(db, "alice")).toBe(0);
  });

  it("giver én kredit pr. klaret mål, også ved gentaget sync og genspil", () => {
    only("find", 3);
    const puzzle = game();
    const moves = puzzle.words.slice(0, 3).map((word) => find(puzzle, word));
    play(puzzle, moves);
    play(puzzle, moves);
    // Finding the same word again is a no-op and does not count.
    play(puzzle, [find(puzzle, puzzle.words[0])]);
    const state = challengeState(db, "alice", false);
    expect(state.balance).toBe(START_CREDITS + 1);
    expect(state.recent.map((item) => item.id)).toEqual(["c-find-0"]);
    expect(state.challenges).toHaveLength(ACTIVE_CHALLENGES);
    expect(state.challenges.map((item) => item.id)).not.toContain("c-find-0");
  });

  it("lader et klaret mål vente ved fuld saldo og udbetaler, når der bliver plads", () => {
    db.prepare("INSERT INTO hint_credit (user_id, ref, delta) VALUES ('alice', 'test', ?)").run(MAX_CREDITS - START_CREDITS);
    only("complete-nohint", 1);
    const puzzle = game();
    play(puzzle, finishAll(puzzle));
    let state = challengeState(db, "alice", false);
    expect(state.balance).toBe(MAX_CREDITS);
    expect(state.challenges[0]).toMatchObject({ id: "c-complete-nohint-0", completed: true, progress: 1 });
    const next = game("dyr", "normal");
    play(next, [hint(next.words[0])]);
    state = challengeState(db, "alice", false);
    expect(state.balance).toBe(MAX_CREDITS);
    expect(state.challenges.map((item) => item.id)).not.toContain("c-complete-nohint-0");
  });

  it("tæller kategori, niveau, Æ/Ø/Å og lange ord fra validerede fund efter målets start", () => {
    const before = game("natur");
    play(before, finishAll(before));
    only("complete-category", 1, "mad");
    play(game("natur"), []);
    expect(challengeState(db, "alice", false).challenges[0].progress).toBe(0);
    const food = game("mad");
    play(food, finishAll(food));
    expect(challengeState(db, "alice", false).recent[0]?.id).toBe("c-complete-category-0");

    only("danish", 1);
    const insert = db.prepare("INSERT INTO game_event (id, game_id, user_id, kind, word) VALUES (?, ?, 'alice', 'find', ?)");
    const holder = game();
    insert.run("x1", holder.id, "HUND");
    expect(challengeState(db, "alice", false).challenges[0].progress).toBe(0);
    insert.run("x2", holder.id, "BJØRN");
    expect(challengeState(db, "alice", false).recent[0]?.id).toBe("c-danish-0");

    only("long-word", 1);
    insert.run("x3", holder.id, "GIRAF");
    expect(challengeState(db, "alice", false).challenges[0].progress).toBe(0);
    insert.run("x4", holder.id, "SOMMERFUGL");
    expect(challengeState(db, "alice", false).recent[0]?.id).toBe("c-long-word-0");
  });

  it("vælger kun kategorier og niveauer, profilen kan spille", () => {
    for (let round = 0; round < 30; round++) {
      db.prepare("DELETE FROM challenge").run();
      for (const item of challengeState(db, "alice", true).challenges) {
        if (item.kind === "complete-level") expect(["normal", "svaer", "ekspert"]).toContain(item.param);
        if (item.kind === "complete-category") expect(item.param).toBeTruthy();
      }
    }
  });
});
