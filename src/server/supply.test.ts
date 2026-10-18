import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { makePuzzle, type Puzzle } from "../shared/game.js";
import { migrateGameData } from "./migrations.js";
import { inlineGenerator, PuzzleSupply, SupplyBusyError, workerGenerator, type GenerateRequest, type Generator } from "./supply.js";

let db: Database.Database;
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const cached = () => (db.prepare("SELECT COUNT(*) AS count FROM puzzle_cache").get() as { count: number }).count;

// A generator the test releases by hand, to hold jobs in the queue.
function gatedGenerator() {
  const waiting: Array<() => void> = [];
  let runs = 0;
  const generator: Generator = {
    run: (request: GenerateRequest) => new Promise<Puzzle>((resolve) => {
      runs++;
      waiting.push(() => resolve(makePuzzle(request.id, request.category, request.level, request.seed, request.child)));
    }),
    close: async () => {}
  };
  return { generator, release: () => waiting.splice(0).forEach((go) => go()), runs: () => runs };
}

describe("baneforsyning", () => {
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec("CREATE TABLE user (id TEXT PRIMARY KEY)");
    migrateGameData(db);
  });
  afterEach(() => db.close());

  it("danner en bane ved tom cache og genopfylder bagefter, adskilt pr. profil og version", async () => {
    const supply = new PuzzleSupply(db, inlineGenerator(), { perKey: 2 });
    const first = await supply.take("dyr", "let", true);
    expect(first.child).toBe(true);
    await settle();
    expect(supply.cachedCount("dyr", "let", true)).toBe(2);
    expect(supply.cachedCount("dyr", "let", false)).toBe(0);
    const second = await supply.take("dyr", "let", true);
    expect(second.id).not.toBe(first.id);
    expect(supply.takeCached("dyr", "let", false)).toBeNull();
    expect(PuzzleSupply.key("dyr", "let", true)).not.toBe(PuzzleSupply.key("dyr", "let", false));
  });

  it("fjerner cachede baner fra ældre versioner og springer ugyldige over", async () => {
    const supply = new PuzzleSupply(db, inlineGenerator(), { perKey: 1 });
    await supply.prepare(["mad"], "normal", false, 1);
    db.prepare("UPDATE puzzle_cache SET cache_key = replace(cache_key, '|w', '|w0')").run();
    expect(supply.prune()).toBe(1);
    await supply.prepare(["mad"], "normal", false, 1);
    db.prepare("UPDATE puzzle_cache SET puzzle = json_set(puzzle, '$.words[0]', 'MOSSE')").run();
    expect(supply.takeCached("mad", "normal", false)).toBeNull();
    expect(cached()).toBe(0);
  });

  it("begrænser køen, så samtidige bestillinger ikke skaber ubegrænset arbejde", async () => {
    const gate = gatedGenerator();
    const supply = new PuzzleSupply(db, gate.generator, { queueLimit: 2, perKey: 0 });
    const requests = Array.from({ length: 6 }, () => supply.take("dyr", "let", false).then(() => "ok", (error) => error));
    await settle();
    gate.release();
    await settle(); gate.release();
    await settle(); gate.release();
    const results = await Promise.all(requests);
    expect(results.filter((result) => result === "ok")).toHaveLength(3);
    expect(results.filter((result) => result instanceof SupplyBusyError)).toHaveLength(3);
    expect(gate.runs()).toBe(3);
  });

  it("lader en spillers bestilling skubbe en baggrundsgenopfyldning ud af en fuld kø", async () => {
    const gate = gatedGenerator();
    const supply = new PuzzleSupply(db, gate.generator, { queueLimit: 2, perKey: 3 });
    // The first take starts one job and queues refills until the queue is full.
    const first = supply.take("dyr", "let", false);
    await settle();
    expect(supply.status().queued).toBe(2);
    const second = supply.take("mad", "let", false);
    expect(supply.status().queued).toBe(2);
    for (let round = 0; round < 6; round++) { gate.release(); await settle(); }
    expect((await first).category).toBe("dyr");
    expect((await second).category).toBe("mad");
  });

  it("forsøger igen med nyt seed og giver en forklarlig fejl, når alle forsøg fejler", async () => {
    let calls = 0;
    const flaky: Generator = { run: async (request) => { if (++calls < 2) throw new Error("budget"); return makePuzzle(request.id, request.category, request.level, request.seed, request.child); }, close: async () => {} };
    expect((await new PuzzleSupply(db, flaky, { perKey: 0, retries: 1 }).take("dyr", "let", false)).level).toBe("let");
    const broken: Generator = { run: async () => { throw new Error("Banen tog for lang tid at danne."); }, close: async () => {} };
    await expect(new PuzzleSupply(db, broken, { perKey: 0, retries: 2 }).take("dyr", "let", false)).rejects.toThrow("for lang tid");
    // Results that fail validation are never delivered or cached.
    const wrong: Generator = { run: async (request) => ({ ...makePuzzle(request.id, "mad", request.level, request.seed), category: "dyr" }), close: async () => {} };
    await expect(new PuzzleSupply(db, wrong, { perKey: 1, retries: 0 }).take("dyr", "let", false)).rejects.toThrow("valideres");
    expect(cached()).toBe(0);
  });

  it("bevarer cachen efter genstart og holder den inden for loftet", async () => {
    const supply = new PuzzleSupply(db, inlineGenerator(), { maxCached: 3 });
    await supply.prepare(["dyr", "mad", "natur", "sport"], "let", false, 4);
    expect(cached()).toBe(3);
    await supply.close();
    const restarted = new PuzzleSupply(db, inlineGenerator());
    expect(restarted.prune()).toBe(0);
    expect(restarted.status().cached).toBe(3);
  });

  it("stopper en worker, der overskrider tidsgrænsen, og starter en ny til næste job", async () => {
    const generator = workerGenerator(1);
    await expect(generator.run({ id: "x", category: "dyr", level: "ekspert", seed: 1, child: true })).rejects.toThrow("for lang tid");
    await generator.close();
  });
});
