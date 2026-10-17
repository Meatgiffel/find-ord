import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { makePuzzle, findWord } from "../shared/game.js";
import { approveDownloadedGame, clearPendingServerLogout, eraseLocal, local, matchesServerVersions, offlineSignOut, pendingServerLogout, reconcileDownloadedGames, recordMove, removeDownloadedGame, saveCampaign, saveGame, usableOffline } from "./storage.js";

const versions = { rules: 1, validation: 1, words: 1, categories: 1, childPolicy: 2 };

describe("lokal offlinelagring", () => {
  beforeEach(async () => { await eraseLocal(); });

  it("gemmer en bane og et fund sammen med hændelsen", async () => {
    const puzzle = makePuzzle("game-1", "dyr", "let", 17, true);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    const game = (await local.games.get(puzzle.id))!;
    const word = puzzle.words[0];
    const path = findWord(puzzle, word)!;
    await recordMove(game, { id: "event-1", kind: "find", word, ...path }, { found: [word], hints: [], completed: false });
    expect((await local.games.get(puzzle.id))?.found).toEqual([word]);
    expect((await local.moves.get("event-1"))?.owner).toBe("alice");
    expect(await local.moves.where("owner").equals("bob").count()).toBe(0);
  });

  it("bevarer rækkefølgen af fund og afslutning til senere synkronisering", async () => {
    const puzzle = makePuzzle("game-2", "farver", "let", 19);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    let game = (await local.games.get(puzzle.id))!;
    await recordMove(game, { id: "first", kind: "find", word: puzzle.words[0], ...findWord(puzzle, puzzle.words[0])! }, { found: [puzzle.words[0]], hints: [], completed: false });
    game = (await local.games.get(puzzle.id))!;
    await recordMove(game, { id: "second", kind: "hint", word: puzzle.words[1] }, { found: game.found, hints: [puzzle.words[1]], completed: false });
    const outbox = await local.moves.where("gameId").equals(puzzle.id).toArray();
    expect(outbox.map((event) => event.id)).toEqual(["first", "second"]);
    expect(outbox.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("afviser offlinehints over grænsen og lader ikke dubletter ændre outbox", async () => {
    const puzzle = makePuzzle("hint-budget", "dyr", "let", 23);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    const first = (await local.games.get(puzzle.id))!;
    await recordMove(first, { id: "hint-1", kind: "hint", word: puzzle.words[0] }, { found: [], hints: [puzzle.words[0]], completed: false });
    const saved = (await local.games.get(puzzle.id))!;
    await expect(recordMove(saved, { id: "hint-2", kind: "hint", word: puzzle.words[1] }, { found: [], hints: puzzle.words.slice(0, 2), completed: false }))
      .rejects.toThrow("Alle hints på denne bane er brugt.");
    await expect(recordMove(saved, { id: "duplicate", kind: "hint", word: puzzle.words[0] }, { found: [], hints: [], completed: false }))
      .rejects.toThrow("allerede");
    expect((await local.games.get(puzzle.id))?.hints).toEqual([puzzle.words[0]]);
    expect(await local.moves.where("gameId").equals(puzzle.id).count()).toBe(1);
  });

  it("bevarer hintbudgettet, når et ordtræk og et hint gemmes samtidigt", async () => {
    const puzzle = makePuzzle("simultaneous-hint", "dyr", "let", 29);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    const stale = (await local.games.get(puzzle.id))!;
    const word = puzzle.words[0];
    await Promise.all([
      recordMove(stale, { id: "hint", kind: "hint", word: puzzle.words[1] }, { found: [], hints: [puzzle.words[1]], completed: false }),
      recordMove(stale, { id: "find", kind: "find", word, ...findWord(puzzle, word)! }, { found: [word], hints: [], completed: false })
    ]);
    expect((await local.games.get(puzzle.id))?.hints).toEqual([puzzle.words[1]]);
    expect((await local.games.get(puzzle.id))?.found).toEqual([word]);
    expect(await local.moves.where("gameId").equals(puzzle.id).count()).toBe(2);
  });

  it("gemmer en kampagnekø offline uden at overskrive usynkroniserede træk", async () => {
    const first = makePuzzle("campaign-1", "dyr", "let", 61);
    const second = makePuzzle("campaign-2", "mad", "let", 63);
    const bundle = { id: "campaign", level: "let" as const, games: [first, second].map((puzzle, index) => ({
      puzzle, found: [], hints: [], completed: false, revision: 0, campaignId: "campaign", campaignPosition: index + 1
    })) };
    await saveCampaign("alice", bundle);
    expect(await local.campaigns.get("campaign")).toEqual({ id: "campaign", owner: "alice", level: "let" });
    expect(await local.games.where("campaignId").equals("campaign").count()).toBe(2);
    const word = first.words[0];
    await recordMove((await local.games.get(first.id))!, { id: "offline-campaign-move", kind: "find", word, ...findWord(first, word)! },
      { found: [word], hints: [], completed: false });
    await saveCampaign("alice", bundle);
    expect((await local.games.get(first.id))?.found).toEqual([word]);
    await offlineSignOut();
    expect(await local.campaigns.count()).toBe(0);
  });

  it("fortsætter en godkendt børnedownload offline under dens oprindelige politik", async () => {
    const puzzle = makePuzzle("child-download", "dyr", "let", 31, true);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    const downloaded = (await local.games.get(puzzle.id))!;
    expect(downloaded.approvedAtDownload).toBe(true);
    expect(usableOffline(downloaded, true)).toBe(true);
    expect(usableOffline(downloaded, false)).toBe(false);
    const oldPolicy = { ...downloaded, puzzle: { ...puzzle, childPolicyVersion: 1 } };
    expect(usableOffline(oldPolicy, true)).toBe(true);
    expect(matchesServerVersions(oldPolicy.puzzle, versions)).toBe(false);
    expect(usableOffline({ ...oldPolicy, approvedAtDownload: false }, true)).toBe(false);
  });

  it("godkender kun servervaliderede pakker og rydder en afvist bane med dens outbox", async () => {
    const puzzle = makePuzzle("revoked", "dyr", "let", 33, true);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    const game = (await local.games.get(puzzle.id))!;
    await recordMove(game, { id: "pending", kind: "hint", word: puzzle.words[0] }, { found: [], hints: [puzzle.words[0]], completed: false });
    await expect(approveDownloadedGame(puzzle.id, { ...puzzle, childPolicyVersion: 1 })).rejects.toThrow();
    expect((await local.games.get(puzzle.id))?.approvedAtDownload).toBe(true);
    await removeDownloadedGame(puzzle.id);
    expect(await local.games.get(puzzle.id)).toBeUndefined();
    expect(await local.moves.get("pending")).toBeUndefined();
  });

  it("rydder personlige data ved offline logout og bevarer serverudlogning til næste kontakt", async () => {
    const puzzle = makePuzzle("logout", "dyr", "let", 37);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    await local.identity.put({ key: "identity", id: "alice", name: "Alice", child: false });
    await recordMove((await local.games.get(puzzle.id))!, { id: "unsynced", kind: "hint", word: puzzle.words[0] }, { found: [], hints: [puzzle.words[0]], completed: false });
    await offlineSignOut();
    expect(await local.games.count()).toBe(0);
    expect(await local.moves.count()).toBe(0);
    expect(await local.identity.count()).toBe(0);
    expect(await pendingServerLogout()).toBe(true);
    await clearPendingServerLogout();
    expect(await pendingServerLogout()).toBe(false);
  });

  it("fjerner udgåede pakker ved kontakt og genvaliderer ældre downloads", async () => {
    const stale = makePuzzle("stale", "dyr", "let", 41, true);
    const legacy = makePuzzle("legacy-local", "dyr", "let", 43, true);
    await saveGame("alice", { puzzle: stale, found: [], hints: [], completed: false });
    await saveGame("alice", { puzzle: legacy, found: [], hints: [], completed: false });
    await local.games.update(stale.id, { puzzle: { ...stale, childPolicyVersion: 1 } });
    await local.games.update(legacy.id, { approvedAtDownload: false });
    await recordMove((await local.games.get(stale.id))!, { id: "stale-move", kind: "hint", word: stale.words[0] }, { found: [], hints: [stale.words[0]], completed: false });
    const loaded: string[] = [];
    const result = await reconcileDownloadedGames("alice", true, versions, async (id) => {
      loaded.push(id);
      return { puzzle: legacy };
    });
    expect(result).toEqual({ removed: 1, interrupted: false });
    expect(loaded).toEqual([legacy.id]);
    expect(await local.games.get(stale.id)).toBeUndefined();
    expect(await local.moves.get("stale-move")).toBeUndefined();
    expect((await local.games.get(legacy.id))?.approvedAtDownload).toBe(true);
  });

  it("bevarer downloads, hvis genvalidering afbrydes af netværksfejl", async () => {
    const puzzle = makePuzzle("retry", "dyr", "let", 47, true);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    await local.games.update(puzzle.id, { approvedAtDownload: false });
    const result = await reconcileDownloadedGames("alice", true, versions, async () => { throw new Error("offline"); });
    expect(result).toEqual({ removed: 0, interrupted: true });
    expect(await local.games.get(puzzle.id)).toBeDefined();
  });

  it("rydder voksenpakken, når serveren ændrer kontoen til børneprofil", async () => {
    const puzzle = makePuzzle("adult", "dyr", "let", 53);
    await saveGame("alice", { puzzle, found: [], hints: [], completed: false });
    const result = await reconcileDownloadedGames("alice", true, versions, async () => { throw new Error("Bør ikke hentes"); });
    expect(result).toEqual({ removed: 1, interrupted: false });
    expect(await local.games.get(puzzle.id)).toBeUndefined();
  });
});
