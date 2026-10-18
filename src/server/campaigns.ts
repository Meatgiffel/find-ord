import { randomBytes, randomInt, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { makePuzzle, type Puzzle } from "../shared/game.js";
import { validatePuzzle } from "../shared/validation.js";
import { CATEGORIES, availableLevels, type CategoryId, type LevelId } from "../shared/words.js";

const QUEUE_SIZE = 3;

type CampaignRow = { id: string; user_id: string; level: LevelId };
type QueueRow = { position: number; game_id: string; category: CategoryId; level: LevelId; puzzle: string; found: string; hints: string; completed: number; revision: number; retired: number };

export type CampaignGame = {
  puzzle: Puzzle; found: string[]; hints: string[]; completed: boolean; revision: number;
  campaignId: string; campaignPosition: number;
};
export type CampaignBundle = { id: string; level: LevelId; games: CampaignGame[] };

function queueRows(db: Database.Database, campaignId: string): QueueRow[] {
  return db.prepare(`SELECT cg.position, cg.game_id, cg.retired, g.category, g.level, g.puzzle,
    g.found, g.hints, (g.completed OR g.abandoned) AS completed, g.revision
    FROM campaign_game cg JOIN game g ON g.id = cg.game_id
    WHERE cg.campaign_id = ? ORDER BY cg.position`).all(campaignId) as QueueRow[];
}

function current(row: QueueRow, level: LevelId, child: boolean): boolean {
  if (row.retired || row.completed || row.level !== level) return false;
  try {
    const puzzle = JSON.parse(row.puzzle) as Puzzle;
    return puzzle.child === child && puzzle.category === row.category && puzzle.level === level && validatePuzzle(puzzle) === null;
  } catch { return false; }
}

function bundle(db: Database.Database, campaign: CampaignRow, child: boolean): CampaignBundle {
  const games = queueRows(db, campaign.id).filter((row) => current(row, campaign.level, child)).map((row) => ({
    puzzle: JSON.parse(row.puzzle) as Puzzle,
    found: JSON.parse(row.found) as string[],
    hints: JSON.parse(row.hints) as string[],
    completed: false,
    revision: row.revision,
    campaignId: campaign.id,
    campaignPosition: row.position
  }));
  return { id: campaign.id, level: campaign.level, games };
}

// How many puzzles a refill would add and from which categories, so they can be
// prepared outside the refill transaction.
export function campaignNeeds(db: Database.Database, campaignId: string | null, userId: string, level: LevelId, child: boolean): { count: number; categories: CategoryId[] } {
  const categories = (Object.keys(CATEGORIES) as CategoryId[]).filter((category) => availableLevels(category, child).includes(level));
  if (!campaignId) return { count: QUEUE_SIZE, categories };
  const waiting = queueRows(db, campaignId).filter((row) => current(row, level, child)).length;
  return { count: Math.max(0, QUEUE_SIZE - waiting), categories };
}

export function campaignsForUser(db: Database.Database, userId: string, child: boolean): CampaignBundle[] {
  const rows = db.prepare("SELECT id, user_id, level FROM campaign WHERE user_id = ? ORDER BY created_at, id").all(userId) as CampaignRow[];
  return rows.map((row) => bundle(db, row, child));
}

// next supplies a ready puzzle for a category (from the cache); without one, or when it
// has none, the puzzle is generated here.
export type PuzzleSource = (category: CategoryId, level: LevelId, child: boolean) => Puzzle | null;

export function refillCampaign(db: Database.Database, campaignId: string, userId: string, child: boolean, next?: PuzzleSource): CampaignBundle | null {
  return db.transaction(() => {
    const campaign = db.prepare("SELECT id, user_id, level FROM campaign WHERE id = ? AND user_id = ?").get(campaignId, userId) as CampaignRow | undefined;
    if (!campaign) return null;
    const rows = queueRows(db, campaign.id);
    let waiting = 0;
    for (const row of rows) {
      if (current(row, campaign.level, child)) waiting++;
      else if (!row.completed && !row.retired) db.prepare("UPDATE campaign_game SET retired = 1 WHERE campaign_id = ? AND position = ?").run(campaign.id, row.position);
    }
    let position = rows.at(-1)?.position ?? 0;
    let previous = rows.at(-1)?.category;
    const eligible = (Object.keys(CATEGORIES) as CategoryId[]).filter((category) => availableLevels(category, child).includes(campaign.level));
    if (!eligible.length) throw new Error("Ingen kategorier er tilgængelige på dette niveau.");
    while (waiting < QUEUE_SIZE) {
      const candidates = eligible.filter((category) => eligible.length === 1 || category !== previous);
      let puzzle: Puzzle | null = null;
      const remaining = [...candidates];
      while (remaining.length && !puzzle) {
        const index = randomInt(remaining.length);
        const category = remaining.splice(index, 1)[0];
        const ready = next?.(category, campaign.level, child);
        if (ready && validatePuzzle(ready) === null) { puzzle = ready; break; }
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const made = makePuzzle(randomUUID(), category, campaign.level, randomBytes(4).readUInt32BE(), child);
            if (validatePuzzle(made) === null) { puzzle = made; break; }
          } catch { /* Try another seed or category. */ }
        }
      }
      if (!puzzle) throw new Error("Kampagnebanerne kunne ikke dannes. Prøv igen.");
      position++;
      db.prepare("INSERT INTO game (id, user_id, category, level, puzzle) VALUES (?, ?, ?, ?, ?)")
        .run(puzzle.id, userId, puzzle.category, campaign.level, JSON.stringify(puzzle));
      db.prepare("INSERT INTO campaign_game (campaign_id, position, game_id) VALUES (?, ?, ?)")
        .run(campaign.id, position, puzzle.id);
      previous = puzzle.category;
      waiting++;
    }
    return bundle(db, campaign, child);
  })();
}

export function startCampaign(db: Database.Database, userId: string, level: LevelId, child: boolean, next?: PuzzleSource): CampaignBundle {
  const id = db.transaction(() => {
    const existing = db.prepare("SELECT id FROM campaign WHERE user_id = ? AND level = ?").get(userId, level) as { id: string } | undefined;
    if (existing) return existing.id;
    const created = randomUUID();
    db.prepare("INSERT INTO campaign (id, user_id, level) VALUES (?, ?, ?)").run(created, userId, level);
    return created;
  })();
  const result = refillCampaign(db, id, userId, child, next);
  if (!result) throw new Error("Kampagnen kunne ikke findes.");
  return result;
}
