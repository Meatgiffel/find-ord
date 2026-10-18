import { randomInt, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import { ACTIVE_CHALLENGES, LONG_WORD, MAX_CREDITS, START_CREDITS, challengeTitle, type Challenge, type ChallengeKind, type ChallengeState } from "../shared/challenges.js";
import { CATEGORIES, availableLevels, campaignLevels, type CategoryId } from "../shared/words.js";

type ChallengeRow = { id: string; kind: ChallengeKind; param: string | null; target: number; after_event: number; completed_at: string | null; claimed_at: string | null };

export function creditBalance(db: Database.Database, userId: string): number {
  return START_CREDITS + (db.prepare("SELECT COALESCE(SUM(delta), 0) AS total FROM hint_credit WHERE user_id = ?").get(userId) as { total: number }).total;
}

// Charges one credit for a hint event. Returns false when the balance is empty; the
// event ID makes a repeated sync of the same hint free.
export function spendCredit(db: Database.Database, userId: string, eventId: string): boolean {
  if (db.prepare("SELECT 1 FROM hint_credit WHERE user_id = ? AND ref = ?").get(userId, `hint:${eventId}`)) return true;
  if (creditBalance(db, userId) < 1) return false;
  db.prepare("INSERT INTO hint_credit (user_id, ref, delta) VALUES (?, ?, -1)").run(userId, `hint:${eventId}`);
  return true;
}

// Progress counts only validated events stored after the challenge was created.
function progress(db: Database.Database, userId: string, row: ChallengeRow): number {
  const count = (sql: string, ...params: unknown[]) => (db.prepare(sql).get(userId, row.after_event, ...params) as { count: number }).count;
  const finds = "SELECT COUNT(*) AS count FROM game_event WHERE user_id = ? AND rowid > ? AND kind = 'find'";
  const completions = `SELECT COUNT(*) AS count FROM game_event e JOIN game g ON g.id = e.game_id
    WHERE e.user_id = ? AND e.rowid > ? AND e.kind = 'complete'`;
  switch (row.kind) {
    case "find": return count(finds);
    case "danish": return count(`${finds} AND (word LIKE '%Æ%' OR word LIKE '%Ø%' OR word LIKE '%Å%')`);
    case "long-word": return count(`${finds} AND length(word) >= ?`, LONG_WORD);
    case "complete-nohint": return count(`${completions} AND g.hints = '[]'`);
    case "complete-category": return count(`${completions} AND g.category = ?`, row.param);
    case "complete-level": return count(`${completions} AND g.level = ?`, row.param);
  }
}

// A new challenge of a kind that is not already active, using only categories and levels
// the profile can play. Nothing has a deadline.
function newChallenge(db: Database.Database, userId: string, child: boolean, active: ChallengeKind[], random: (max: number) => number) {
  const categories = (Object.keys(CATEGORIES) as CategoryId[]).filter((category) => availableLevels(category, child).length);
  const levels = campaignLevels(child).filter((level) => level !== "let");
  type Option = { kind: ChallengeKind; param: string | null; target: number };
  const options: Option[] = [
    { kind: "find", param: null, target: [10, 15, 20][random(3)] },
    { kind: "danish", param: null, target: 3 },
    { kind: "long-word", param: null, target: 2 },
    { kind: "complete-nohint", param: null, target: 1 }
  ];
  if (categories.length) options.push({ kind: "complete-category", param: categories[random(categories.length)], target: 1 });
  if (levels.length) options.push({ kind: "complete-level", param: levels[random(levels.length)], target: 1 });
  const open = options.filter((option) => !active.includes(option.kind));
  const choice = open[random(open.length)];
  const after = (db.prepare("SELECT COALESCE(MAX(rowid), 0) AS id FROM game_event").get() as { id: number }).id;
  db.prepare("INSERT INTO challenge (id, user_id, kind, param, target, after_event) VALUES (?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, choice.kind, choice.param, choice.target, after);
}

// Marks finished challenges, pays credits while there is room, and replaces paid
// challenges so ACTIVE_CHALLENGES are always open. Call inside the event transaction.
export function updateChallenges(db: Database.Database, userId: string, child: boolean, random: (max: number) => number = randomInt): void {
  const rows = () => db.prepare("SELECT * FROM challenge WHERE user_id = ? AND claimed_at IS NULL ORDER BY created_at, rowid").all(userId) as ChallengeRow[];
  for (const row of rows()) {
    if (!row.completed_at && progress(db, userId, row) >= row.target) {
      db.prepare("UPDATE challenge SET completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
    }
  }
  for (const row of rows()) {
    if (!(db.prepare("SELECT completed_at FROM challenge WHERE id = ?").get(row.id) as { completed_at: string | null }).completed_at) continue;
    if (creditBalance(db, userId) >= MAX_CREDITS) break;
    db.prepare("INSERT OR IGNORE INTO hint_credit (user_id, ref, delta) VALUES (?, ?, 1)").run(userId, `challenge:${row.id}`);
    db.prepare("UPDATE challenge SET claimed_at = CURRENT_TIMESTAMP WHERE id = ?").run(row.id);
  }
  let open = rows();
  while (open.length < ACTIVE_CHALLENGES) {
    newChallenge(db, userId, child, open.map((row) => row.kind), random);
    open = rows();
  }
}

export function challengeState(db: Database.Database, userId: string, child: boolean): ChallengeState {
  db.transaction(() => updateChallenges(db, userId, child))();
  const rows = db.prepare("SELECT * FROM challenge WHERE user_id = ? AND claimed_at IS NULL ORDER BY created_at, rowid").all(userId) as ChallengeRow[];
  const challenges: Challenge[] = rows.map((row) => ({
    id: row.id, kind: row.kind, param: row.param, target: row.target,
    progress: Math.min(row.target, progress(db, userId, row)), completed: Boolean(row.completed_at), claimed: false,
    title: challengeTitle(row.kind, row.param, row.target)
  }));
  return { balance: creditBalance(db, userId), max: MAX_CREDITS, challenges, recent: recentlyClaimed(db, userId) };
}

// The most recently paid challenges, so the client can announce them.
export function recentlyClaimed(db: Database.Database, userId: string, limit = 5): Challenge[] {
  return (db.prepare("SELECT * FROM challenge WHERE user_id = ? AND claimed_at IS NOT NULL ORDER BY claimed_at DESC, rowid DESC LIMIT ?").all(userId, limit) as ChallengeRow[])
    .map((row) => ({ id: row.id, kind: row.kind, param: row.param, target: row.target, progress: row.target, completed: true, claimed: true, title: challengeTitle(row.kind, row.param, row.target) }));
}
