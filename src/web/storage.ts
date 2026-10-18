import Dexie, { type Table } from "dexie";
import { hintError, type Move, type Puzzle } from "../shared/game.js";
import type { Achievement } from "../shared/achievements.js";
import type { ChallengeState } from "../shared/challenges.js";
import { revalidateLegacyPuzzle, validatePuzzle } from "../shared/validation.js";
import type { LevelId } from "../shared/words.js";

export type StoredGame = { id: string; owner: string; puzzle: Puzzle; found: string[]; hints: string[]; completed: boolean; abandoned?: boolean; revision?: number; updatedAt: number; approvedAtDownload?: boolean; retired?: boolean; campaignId?: string; campaignPosition?: number };
export type StoredCampaign = { id: string; owner: string; level: LevelId };
export type DownloadedCampaign = { id: string; level: LevelId; games: Array<Omit<StoredGame, "id" | "owner" | "updatedAt" | "approvedAtDownload">> };
export type StoredMove = Move & { id: string; gameId: string; owner: string; createdAt: number; sequence: number };
export type StoredIdentity = { key: "identity"; id: string; name: string; username?: string | null; role?: string | null; child: boolean; avatar?: string | null };
export type PlayerStats = { completed: number; found: number; unique: number; withoutHints: number; activeDays: number; byLevel: Record<string, number>; categoryTagVersion: number; byCategory: Array<{ category: string; completed: number; found: number }> };
export type StoredAchievements = { owner: string; items: Achievement[]; updatedAt: number; stats?: PlayerStats; challenges?: ChallengeState };
export type PuzzleVersions = { rules: number; validation: number; words: number; categories: number; childPolicy: number };
type LocalMeta = { key: "logout"; pending: true };

class LocalStore extends Dexie {
  games!: Table<StoredGame, string>;
  moves!: Table<StoredMove, string>;
  identity!: Table<StoredIdentity, string>;
  achievements!: Table<StoredAchievements, string>;
  meta!: Table<LocalMeta, string>;
  campaigns!: Table<StoredCampaign, string>;
  constructor() {
    super("find-ord");
    this.version(1).stores({ games: "id,owner,updatedAt", moves: "id,gameId,owner,createdAt", identity: "key" });
    this.version(2).stores({ achievements: "owner" });
    this.version(3).stores({ meta: "key" });
    this.version(4).stores({ campaigns: "id,owner,level", games: "id,owner,updatedAt,campaignId,campaignPosition" });
  }
}

export const local = new LocalStore();

// Keep the offline store small. Only completed games without unsynced moves are pruned.
export const MAX_OFFLINE_GAMES = 30;

export async function pruneOfflineGames(owner: string, max = MAX_OFFLINE_GAMES): Promise<number> {
  return local.transaction("rw", local.games, local.moves, async () => {
    const saved = await local.games.where("owner").equals(owner).toArray();
    if (saved.length <= max) return saved.length;
    const pending = new Set((await local.moves.where("owner").equals(owner).toArray()).map((move) => move.gameId));
    const removable = saved.filter((game) => game.completed && !pending.has(game.id)).sort((a, b) => a.updatedAt - b.updatedAt);
    const excess = removable.slice(0, saved.length - max).map((game) => game.id);
    await local.games.bulkDelete(excess);
    return saved.length - excess.length;
  });
}

export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persisted() || await navigator.storage.persist(); }
  catch { return false; }
}

export function isQuotaError(cause: unknown): boolean {
  const error = cause as { name?: string; inner?: { name?: string } } | null;
  return error?.name === "QuotaExceededError" || error?.inner?.name === "QuotaExceededError";
}

export async function saveGame(owner: string, game: Omit<StoredGame, "id" | "owner" | "updatedAt" | "approvedAtDownload">): Promise<void> {
  if (validatePuzzle(game.puzzle)) throw new Error("Den hentede bane bestod ikke den lokale validering.");
  await local.games.put({ ...game, id: game.puzzle.id, owner, approvedAtDownload: true, updatedAt: Date.now() });
}

// Add server games that are missing on this device. Downloads stop 10 games below the
// offline limit, so the player can always start new games.
export async function saveMissingGames(owner: string, games: Array<Omit<StoredGame, "id" | "owner" | "updatedAt" | "approvedAtDownload">>, max = MAX_OFFLINE_GAMES - 10): Promise<number> {
  let added = 0;
  for (const game of games) {
    if (await local.games.get(game.puzzle.id)) continue;
    if (await local.games.where("owner").equals(owner).count() >= max) break;
    await saveGame(owner, game);
    added++;
  }
  return added;
}

export async function saveCampaign(owner: string, campaign: DownloadedCampaign): Promise<void> {
  if (campaign.games.some((game) => game.campaignId !== campaign.id || game.puzzle.level !== campaign.level ||
    !Number.isInteger(game.campaignPosition) || (game.campaignPosition ?? 0) < 1 || validatePuzzle(game.puzzle))) {
    throw new Error("Kampagnen indeholder en ugyldig bane.");
  }
  await local.transaction("rw", local.campaigns, local.games, local.moves, async () => {
    await local.campaigns.put({ id: campaign.id, owner, level: campaign.level });
    for (const game of campaign.games) {
      if (await local.moves.where("gameId").equals(game.puzzle.id).count()) continue;
      await local.games.put({ ...game, id: game.puzzle.id, owner, approvedAtDownload: true, updatedAt: Date.now() });
    }
  });
}

export function usableOffline(game: StoredGame, child: boolean): boolean {
  if (game.retired || game.puzzle.child !== child) return false;
  if (!child) return true;
  const puzzle = game.puzzle;
  if (game.approvedAtDownload && puzzle.version === 1 &&
    Number.isInteger(puzzle.validationVersion) && Number.isInteger(puzzle.wordListVersion) &&
    Number.isInteger(puzzle.categoryTagVersion) && Number.isInteger(puzzle.childPolicyVersion) &&
    Array.isArray(puzzle.grid) && Array.isArray(puzzle.words)) return true;
  // Unmarked downloads can only be used when they pass today's full policy.
  return validatePuzzle(puzzle) === null || revalidateLegacyPuzzle(puzzle) !== null;
}

export function matchesServerVersions(puzzle: Puzzle, versions: PuzzleVersions): boolean {
  return puzzle.version === versions.rules && puzzle.validationVersion === versions.validation &&
    puzzle.wordListVersion === versions.words && puzzle.categoryTagVersion === versions.categories &&
    puzzle.childPolicyVersion === (puzzle.child ? versions.childPolicy : null);
}

export async function approveDownloadedGame(id: string, puzzle: Puzzle): Promise<void> {
  if (validatePuzzle(puzzle)) throw new Error("Banen bestod ikke den aktuelle validering.");
  await local.games.update(id, { puzzle, approvedAtDownload: true });
}

export async function removeDownloadedGame(id: string): Promise<void> {
  await local.transaction("rw", local.games, local.moves, async () => {
    const pending = await local.moves.where("gameId").equals(id).primaryKeys();
    await local.moves.bulkDelete(pending);
    await local.games.delete(id);
  });
}

// An invalidated game keeps its unsynced moves: it is hidden from play until they are
// uploaded, and only then deleted. Returns true when the game was deleted right away.
export async function retireDownloadedGame(id: string): Promise<boolean> {
  return local.transaction("rw", local.games, local.moves, async () => {
    if (await local.moves.where("gameId").equals(id).count()) {
      await local.games.update(id, { retired: true });
      return false;
    }
    await local.games.delete(id);
    return true;
  });
}

export async function reconcileDownloadedGames(
  owner: string, child: boolean, versions: PuzzleVersions,
  loadGame: (id: string) => Promise<{ puzzle: Puzzle }>
): Promise<{ removed: number; interrupted: boolean }> {
  let removed = 0;
  const saved = await local.games.where("owner").equals(owner).toArray();
  for (const game of saved) {
    if (game.retired) {
      await retireDownloadedGame(game.id);
      continue;
    }
    if (game.puzzle.child !== child ||
      (game.approvedAtDownload && !matchesServerVersions(game.puzzle, versions))) {
      await retireDownloadedGame(game.id);
      removed++;
      continue;
    }
    if (!game.approvedAtDownload) {
      try {
        const current = await loadGame(game.id);
        await approveDownloadedGame(game.id, current.puzzle);
      } catch (cause) {
        if (cause instanceof Error && "status" in cause && (cause.status === 410 || cause.status === 404)) {
          if (cause.status === 410) await retireDownloadedGame(game.id);
          else await removeDownloadedGame(game.id);
          removed++;
        } else return { removed, interrupted: true };
      }
    }
  }
  return { removed, interrupted: false };
}

export async function recordMove(game: StoredGame, move: Move, next: Pick<StoredGame, "found" | "hints" | "completed" | "abandoned">): Promise<void> {
  await local.transaction("rw", local.games, local.moves, async () => {
    const current = await local.games.get(game.id);
    if (!current || current.owner !== game.owner) throw new Error("Banen er ikke længere gemt på denne enhed.");
    if (move.kind === "abandon" && current.completed) throw new Error("Banen er allerede afsluttet.");
    if (move.kind === "hint") {
      if (current.completed) throw new Error("Banen er allerede afsluttet.");
      const problem = hintError(current.puzzle, current.found, current.hints, move.word);
      if (problem) throw new Error(problem);
      next = { ...next, found: current.found, hints: [...current.hints, move.word!] };
    } else {
      // A word selection may have started before a hint finished saving.
      // Keep the newest hint list when either move commits.
      next = { ...next, hints: current.hints };
    }
    const pending = await local.moves.where("gameId").equals(game.id).toArray();
    const sequence = Math.max(0, ...pending.map((event) => event.sequence ?? 0)) + 1;
    await local.moves.put({ ...move, gameId: game.id, owner: game.owner, createdAt: Date.now(), sequence });
    await local.games.update(game.id, { ...next, updatedAt: Date.now() });
  });
}

export async function eraseLocal(): Promise<void> {
  await local.transaction("rw", [local.games, local.moves, local.identity, local.achievements, local.meta, local.campaigns], async () => {
    await Promise.all([local.games.clear(), local.moves.clear(), local.identity.clear(), local.achievements.clear(), local.meta.clear(), local.campaigns.clear()]);
  });
}

export async function offlineSignOut(): Promise<void> {
  await local.transaction("rw", [local.games, local.moves, local.identity, local.achievements, local.meta, local.campaigns], async () => {
    await Promise.all([local.games.clear(), local.moves.clear(), local.identity.clear(), local.achievements.clear(), local.campaigns.clear()]);
    await local.meta.put({ key: "logout", pending: true });
  });
}

export async function pendingServerLogout(): Promise<boolean> {
  return Boolean(await local.meta.get("logout"));
}

export async function clearPendingServerLogout(): Promise<void> {
  await local.meta.delete("logout");
}
