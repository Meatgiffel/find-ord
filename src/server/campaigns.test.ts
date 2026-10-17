import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrateGameData } from "./migrations.js";
import { campaignsForUser, refillCampaign, startCampaign } from "./campaigns.js";

function database(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE user (id TEXT PRIMARY KEY); INSERT INTO user (id) VALUES ('alice'), ('bob')");
  migrateGameData(db);
  return db;
}

describe("kampagnekø", () => {
  it("genbruger kampagnen og fylder kun en begrænset kø efter afslutning", () => {
    const db = database();
    try {
      const first = startCampaign(db, "alice", "let", false);
      expect(first.games).toHaveLength(3);
      expect(first.games.map((game) => game.campaignPosition)).toEqual([1, 2, 3]);
      expect(first.games.every((game) => game.puzzle.level === "let")).toBe(true);
      expect(first.games.every((game, i) => i === 0 || game.puzzle.category !== first.games[i - 1].puzzle.category)).toBe(true);
      expect(startCampaign(db, "alice", "let", false).games.map((game) => game.puzzle.id))
        .toEqual(first.games.map((game) => game.puzzle.id));
      expect(refillCampaign(db, first.id, "alice", false)?.games).toHaveLength(3);
      expect(refillCampaign(db, first.id, "bob", false)).toBeNull();
      expect(campaignsForUser(db, "bob", false)).toEqual([]);

      db.prepare("UPDATE game SET completed = 1 WHERE id = ?").run(first.games[0].puzzle.id);
      const next = refillCampaign(db, first.id, "alice", false)!;
      expect(next.games.map((game) => game.campaignPosition)).toEqual([2, 3, 4]);
      expect(next.games[2].puzzle.category).not.toBe(first.games[2].puzzle.category);
      expect(refillCampaign(db, first.id, "alice", false)?.games.map((game) => game.puzzle.id))
        .toEqual(next.games.map((game) => game.puzzle.id));
      expect((db.prepare("SELECT COUNT(*) AS count FROM campaign_game WHERE campaign_id = ?").get(first.id) as { count: number }).count).toBe(4);
    } finally { db.close(); }
  });

  it("holder sværhedsgrader og ejere adskilt", () => {
    const db = database();
    try {
      const easy = startCampaign(db, "alice", "let", false);
      const normal = startCampaign(db, "alice", "normal", false);
      const other = startCampaign(db, "bob", "let", false);
      expect(new Set([easy.id, normal.id, other.id]).size).toBe(3);
      expect(normal.games.every((game) => game.puzzle.level === "normal")).toBe(true);
      expect(campaignsForUser(db, "alice", false).map((campaign) => campaign.id).sort()).toEqual([easy.id, normal.id].sort());
    } finally { db.close(); }
  });
});
