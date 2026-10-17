import type Database from "better-sqlite3";
import { hintError, wordAt, type Move, type Puzzle } from "../shared/game.js";

export type GameRow = { id: string; user_id: string; category: string; level: string; puzzle: string; found: string; hints: string; completed: number; revision: number };
export type GameState = { found: string[]; hints: string[]; completed: boolean; revision: number };

export class GameSyncError extends Error {
  constructor(message: string, readonly rejectedHintId?: string) { super(message); }
}

export function loadGameForUser(db: Database.Database, gameId: string, userId: string): GameRow | undefined {
  return db.prepare("SELECT * FROM game WHERE id = ? AND user_id = ?").get(gameId, userId) as GameRow | undefined;
}

export function applyGameEvents(db: Database.Database, row: GameRow, userId: string, events: Move[]): GameState {
  if (row.user_id !== userId) throw new GameSyncError("Banen blev ikke fundet.");
  const puzzle = JSON.parse(row.puzzle) as Puzzle;
  const found = new Set(JSON.parse(row.found) as string[]);
  const hints = new Set(JSON.parse(row.hints) as string[]);
  let completed = Boolean(row.completed);
  let applied = 0;
  db.transaction(() => {
    for (const event of events) {
      if (db.prepare("SELECT 1 FROM game_event WHERE id = ?").get(event.id)) continue;
      if (completed) throw new GameSyncError("Banen er allerede afsluttet.");
      if (event.kind === "find") {
        if (!event.start || !event.end || !event.word || wordAt(puzzle, event.start, event.end) !== event.word) throw new GameSyncError("Ordmarkeringen er ugyldig.");
        if (found.has(event.word)) continue;
        found.add(event.word);
      } else if (event.kind === "hint") {
        if (event.word && hints.has(event.word)) continue;
        const problem = hintError(puzzle, [...found], [...hints], event.word);
        if (problem) throw new GameSyncError(problem, problem === "Alle hints på denne bane er brugt." ? event.id : undefined);
        hints.add(event.word!);
      } else {
        if (found.size !== puzzle.words.length) throw new GameSyncError("Der mangler stadig ord.");
        completed = true;
      }
      db.prepare("INSERT INTO game_event (id, game_id, user_id, kind, word) VALUES (?, ?, ?, ?, ?)")
        .run(event.id, row.id, userId, event.kind, event.word ?? null);
      applied++;
    }
    if (applied) db.prepare("UPDATE game SET found = ?, hints = ?, completed = ?, revision = revision + 1 WHERE id = ?")
      .run(JSON.stringify([...found]), JSON.stringify([...hints]), completed ? 1 : 0, row.id);
  })();
  return { found: [...found], hints: [...hints], completed, revision: row.revision + (applied ? 1 : 0) };
}
