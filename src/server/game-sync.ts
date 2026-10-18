import type Database from "better-sqlite3";
import { hintError, wordAt, type Move, type Puzzle } from "../shared/game.js";
import { awardAchievements } from "./achievements.js";

export type GameRow = { id: string; user_id: string; category: string; level: string; puzzle: string; found: string; hints: string; completed: number; abandoned: number; revision: number };
export type GameState = { found: string[]; hints: string[]; completed: boolean; abandoned: boolean; revision: number };
export type SyncResult = GameState & { acknowledged: string[]; rejected: Array<{ id: string; error: string }> };

export class GameSyncError extends Error {}

export function loadGameForUser(db: Database.Database, gameId: string, userId: string): GameRow | undefined {
  return db.prepare("SELECT * FROM game WHERE id = ? AND user_id = ?").get(gameId, userId) as GameRow | undefined;
}

type StoredEvent = { game_id: string; user_id: string; kind: string; word: string | null };

// Each event is acknowledged (stored now or earlier, or a no-op) or rejected with a reason.
// Valid events are kept even when others in the same batch are rejected, so one bad
// offline move cannot block the rest of the outbox.
export function applyGameEvents(db: Database.Database, row: GameRow, userId: string, events: Move[]): SyncResult {
  if (row.user_id !== userId) throw new GameSyncError("Banen blev ikke fundet.");
  const puzzle = JSON.parse(row.puzzle) as Puzzle;
  const found = new Set(JSON.parse(row.found) as string[]);
  const hints = new Set(JSON.parse(row.hints) as string[]);
  let completed = Boolean(row.completed);
  let abandoned = Boolean(row.abandoned);
  let applied = 0;
  const acknowledged: string[] = [];
  const rejected: Array<{ id: string; error: string }> = [];

  function problem(event: Move): string | "noop" | null {
    if (completed) return "Banen er allerede afsluttet.";
    if (abandoned) return "Banen er opgivet.";
    if (event.kind === "find") {
      if (!event.start || !event.end || !event.word || wordAt(puzzle, event.start, event.end) !== event.word) return "Ordmarkeringen er ugyldig.";
      return found.has(event.word) ? "noop" : null;
    }
    if (event.kind === "hint") {
      if (event.word && hints.has(event.word)) return "noop";
      return hintError(puzzle, [...found], [...hints], event.word);
    }
    if (event.kind === "abandon") return null;
    return found.size === puzzle.words.length ? null : "Der mangler stadig ord.";
  }

  db.transaction(() => {
    for (const event of events) {
      const existing = db.prepare("SELECT game_id, user_id, kind, word FROM game_event WHERE id = ?").get(event.id) as StoredEvent | undefined;
      if (existing) {
        const same = existing.game_id === row.id && existing.user_id === userId &&
          existing.kind === event.kind && (existing.word ?? undefined) === event.word;
        if (same) acknowledged.push(event.id);
        else rejected.push({ id: event.id, error: "Hændelses-ID'et er allerede brugt til en anden hændelse." });
        continue;
      }
      const outcome = problem(event);
      if (outcome === "noop") { acknowledged.push(event.id); continue; }
      if (outcome) { rejected.push({ id: event.id, error: outcome }); continue; }
      if (event.kind === "find") found.add(event.word!);
      else if (event.kind === "hint") hints.add(event.word!);
      else if (event.kind === "abandon") abandoned = true;
      else completed = true;
      db.prepare("INSERT INTO game_event (id, game_id, user_id, kind, word) VALUES (?, ?, ?, ?, ?)")
        .run(event.id, row.id, userId, event.kind, event.word ?? null);
      acknowledged.push(event.id);
      applied++;
    }
    if (applied) {
      db.prepare("UPDATE game SET found = ?, hints = ?, completed = ?, abandoned = ?, revision = revision + 1 WHERE id = ?")
        .run(JSON.stringify([...found]), JSON.stringify([...hints]), completed ? 1 : 0, abandoned ? 1 : 0, row.id);
      awardAchievements(db, userId);
    }
  })();
  return { found: [...found], hints: [...hints], completed, abandoned, revision: row.revision + (applied ? 1 : 0), acknowledged, rejected };
}
