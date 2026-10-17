import type Database from "better-sqlite3";
import { achievementsFor, type Progress } from "../shared/achievements.js";

export function achievementsForUser(db: Database.Database, userId: string) {
  const scalar = (sql: string) => (db.prepare(sql).get(userId) as { count: number }).count;
  const byLevel = Object.fromEntries((db.prepare("SELECT level, COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1 GROUP BY level").all(userId) as Array<{ level: string; count: number }>).map(({ level, count }) => [level, count]));
  const progress: Progress = {
    completed: scalar("SELECT COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1"),
    found: scalar("SELECT COUNT(*) AS count FROM game_event WHERE user_id = ? AND kind = 'find'"),
    unique: scalar("SELECT COUNT(DISTINCT word) AS count FROM game_event WHERE user_id = ? AND kind = 'find'"),
    byLevel,
    withoutHints: scalar("SELECT COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1 AND hints = '[]'"),
    danishLetters: scalar("SELECT COUNT(*) AS count FROM game_event WHERE user_id = ? AND kind = 'find' AND (word LIKE '%Æ%' OR word LIKE '%Ø%' OR word LIKE '%Å%')"),
    activeDays: scalar("SELECT COUNT(DISTINCT date(created_at, 'localtime')) AS count FROM game_event WHERE user_id = ? AND kind = 'find'"),
    categories: scalar("SELECT COUNT(DISTINCT category) AS count FROM game WHERE user_id = ? AND completed = 1"),
    mostCompletedInCategory: scalar("SELECT COALESCE(MAX(count), 0) AS count FROM (SELECT COUNT(*) AS count FROM game WHERE user_id = ? AND completed = 1 GROUP BY category)"),
    mostFoundInCategory: scalar("SELECT COALESCE(MAX(count), 0) AS count FROM (SELECT COUNT(*) AS count FROM game_event e JOIN game g ON g.id = e.game_id WHERE e.user_id = ? AND e.kind = 'find' GROUP BY g.category)")
  };
  return achievementsFor(progress);
}
