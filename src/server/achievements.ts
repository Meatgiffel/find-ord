import type Database from "better-sqlite3";
import { ACHIEVEMENT_CATALOG_VERSION, achievementsFor, type Achievement, type Progress } from "../shared/achievements.js";
import { CATEGORY_TAG_VERSION } from "../shared/words.js";

// Everything is derived from server-validated games and events, never from client counters.
// A word counts under the category of the game it was found in.
export function progressForUser(db: Database.Database, userId: string): Progress {
  const scalar = (sql: string) => (db.prepare(sql).get(userId) as { count: number }).count;
  const byLevel = Object.fromEntries((db.prepare("SELECT level, COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1 GROUP BY level").all(userId) as Array<{ level: string; count: number }>).map(({ level, count }) => [level, count]));
  return {
    completed: scalar("SELECT COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1"),
    found: scalar("SELECT COUNT(*) AS count FROM game_event WHERE user_id = ? AND kind = 'find'"),
    unique: scalar("SELECT COUNT(DISTINCT word) AS count FROM game_event WHERE user_id = ? AND kind = 'find'"),
    byLevel,
    withoutHints: scalar("SELECT COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1 AND hints = '[]'"),
    danishLetters: scalar("SELECT COUNT(*) AS count FROM game_event WHERE user_id = ? AND kind = 'find' AND (word LIKE '%Æ%' OR word LIKE '%Ø%' OR word LIKE '%Å%')"),
    activeDays: scalar("SELECT COUNT(DISTINCT date(created_at, 'localtime')) AS count FROM game_event WHERE user_id = ? AND kind = 'find'"),
    categories: scalar("SELECT COUNT(DISTINCT category) AS count FROM game WHERE user_id = ? AND completed = 1"),
    mostCompletedInCategory: scalar("SELECT COALESCE(MAX(count), 0) AS count FROM (SELECT COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1 GROUP BY category)"),
    mostFoundInCategory: scalar("SELECT COALESCE(MAX(count), 0) AS count FROM (SELECT COUNT(*) AS count FROM game_event e JOIN game g ON g.id = e.game_id WHERE e.user_id = ? AND e.kind = 'find' GROUP BY g.category)"),
    ...campaignProgress(db, userId)
  };
}

const CAMPAIGN_GAMES = "FROM campaign_game cg JOIN campaign c ON c.id = cg.campaign_id JOIN game g ON g.id = cg.game_id WHERE c.user_id = ?";

function campaignProgress(db: Database.Database, userId: string) {
  const scalar = (sql: string) => (db.prepare(sql).get(userId) as { count: number }).count;
  // A run continues through completed games in queue order and ends at an abandoned one.
  // Unplayed or retired games are skipped; they were never finished either way.
  const rows = db.prepare(`SELECT cg.campaign_id AS campaign, g.completed, g.abandoned ${CAMPAIGN_GAMES} ORDER BY cg.campaign_id, cg.position`).all(userId) as Array<{ campaign: string; completed: number; abandoned: number }>;
  let longest = 0, run = 0, current = "";
  for (const row of rows) {
    if (row.campaign !== current) { current = row.campaign; run = 0; }
    if (row.abandoned) run = 0;
    else if (row.completed) longest = Math.max(longest, ++run);
  }
  return {
    campaignCompleted: scalar(`SELECT COUNT(*) AS count ${CAMPAIGN_GAMES} AND g.completed = 1`),
    campaignCategories: scalar(`SELECT COUNT(DISTINCT g.category) AS count ${CAMPAIGN_GAMES} AND g.completed = 1`),
    campaignWithoutHints: scalar(`SELECT COUNT(*) AS count ${CAMPAIGN_GAMES} AND g.completed = 1 AND g.hints = '[]'`),
    longestCampaignRun: longest
  };
}

// Stores newly reached goals once per account and achievement. Call it inside the same
// transaction as the events that may unlock something. Awards are never removed.
export function awardAchievements(db: Database.Database, userId: string): void {
  const insert = db.prepare("INSERT OR IGNORE INTO achievement_award (user_id, achievement_id, catalog_version) VALUES (?, ?, ?)");
  for (const item of achievementsFor(progressForUser(db, userId))) {
    if (item.unlocked) insert.run(userId, item.id, ACHIEVEMENT_CATALOG_VERSION);
  }
}

export function achievementsForUser(db: Database.Database, userId: string): Achievement[] {
  db.transaction(() => awardAchievements(db, userId))();
  const awarded = new Map((db.prepare("SELECT achievement_id, awarded_at FROM achievement_award WHERE user_id = ?").all(userId) as Array<{ achievement_id: string; awarded_at: string }>)
    .map((row) => [row.achievement_id, row.awarded_at]));
  // An award stays unlocked even if the current progress would no longer reach it.
  return achievementsFor(progressForUser(db, userId)).map((item) => {
    const at = awarded.get(item.id);
    return at ? { ...item, unlocked: true, current: item.target, unlockedAt: `${at.replace(" ", "T")}Z` } : { ...item, unlockedAt: null };
  });
}

export function statsForUser(db: Database.Database, userId: string) {
  const progress = progressForUser(db, userId);
  const byCategory = db.prepare(`SELECT g.category,
      SUM(CASE WHEN g.completed = 1 THEN 1 ELSE 0 END) AS completed,
      (SELECT COUNT(*) FROM game_event e JOIN game h ON h.id = e.game_id WHERE e.user_id = g.user_id AND e.kind = 'find' AND h.category = g.category) AS found
    FROM game g WHERE g.user_id = ? GROUP BY g.category ORDER BY g.category`).all(userId) as Array<{ category: string; completed: number; found: number }>;
  return {
    completed: progress.completed, found: progress.found, unique: progress.unique, withoutHints: progress.withoutHints,
    activeDays: progress.activeDays, byLevel: progress.byLevel,
    categoryTagVersion: CATEGORY_TAG_VERSION, byCategory
  };
}
