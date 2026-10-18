import { randomBytes, randomUUID } from "node:crypto";
import { Worker } from "node:worker_threads";
import type Database from "better-sqlite3";
import { makePuzzle, type Puzzle } from "../shared/game.js";
import { CHILD_POLICY_VERSION } from "../shared/safety.js";
import { VALIDATION_VERSION, validatePuzzle } from "../shared/validation.js";
import { CATEGORIES, CATEGORY_TAG_VERSION, WORD_LIST_VERSION, availableLevels, type CategoryId, type LevelId } from "../shared/words.js";

export type GenerateRequest = { id: string; category: CategoryId; level: LevelId; seed: number; child: boolean };
export type Generator = { run(request: GenerateRequest): Promise<Puzzle>; close(): Promise<void> };

export class SupplyBusyError extends Error {
  constructor() { super("Serveren danner mange baner lige nu. Prøv igen om et øjeblik."); }
}

// Runs one generation at a time in a worker thread, so login and word marking are not
// blocked. A job that runs past the time limit stops the worker; the next job starts a new one.
export function workerGenerator(timeoutMs = 3000): Generator {
  let worker: Worker | null = null;
  let jobs = 0;
  const pending = new Map<number, { resolve: (puzzle: Puzzle) => void; reject: (error: Error) => void }>();
  // Built code runs puzzle-worker.js; from source (tsx) the worker inherits tsx's loader.
  const file = new URL(import.meta.url.endsWith(".ts") ? "./puzzle-worker.ts" : "./puzzle-worker.js", import.meta.url);
  const failAll = (error: Error) => { for (const job of pending.values()) job.reject(error); pending.clear(); };
  const start = () => {
    const created = new Worker(file);
    created.on("message", ({ jobId, puzzle, error }: { jobId: number; puzzle?: Puzzle; error?: string }) => {
      const job = pending.get(jobId);
      pending.delete(jobId);
      if (puzzle) job?.resolve(puzzle); else job?.reject(new Error(error));
    });
    created.on("error", (error) => { worker = null; failAll(error); });
    created.on("exit", () => { if (worker === created) { worker = null; failAll(new Error("Banegeneratoren stoppede.")); } });
    created.unref();
    return created;
  };
  return {
    run(request) {
      worker ??= start();
      const current = worker;
      const jobId = ++jobs;
      return new Promise<Puzzle>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(jobId);
          worker = null;
          void current.terminate();
          reject(new Error("Banen tog for lang tid at danne."));
        }, timeoutMs);
        pending.set(jobId, {
          resolve: (puzzle) => { clearTimeout(timer); resolve(puzzle); },
          reject: (error) => { clearTimeout(timer); reject(error); }
        });
        current.postMessage({ jobId, request });
      });
    },
    async close() {
      const current = worker;
      worker = null;
      failAll(new Error("Banegeneratoren er lukket."));
      if (current) await current.terminate();
    }
  };
}

// Generates in the calling thread; for tests and scripts.
export function inlineGenerator(): Generator {
  return {
    run: async (request) => makePuzzle(request.id, request.category, request.level, request.seed, request.child),
    close: async () => {}
  };
}

export type SupplyOptions = { queueLimit?: number; perKey?: number; maxCached?: number; retries?: number };
type Job = { category: CategoryId; level: LevelId; child: boolean; urgent: boolean; resolve: (puzzle: Puzzle) => void; reject: (error: Error) => void };

// Keeps a small cache of validated puzzles per category, level, profile and version, and
// refills it in the background after each use. Cached puzzles are used once, so a player
// never gets the same puzzle twice from the cache.
export class PuzzleSupply {
  private queue: Job[] = [];
  private running = false;
  private refilling = new Map<string, number>();
  private readonly queueLimit: number;
  private readonly perKey: number;
  private readonly maxCached: number;
  private readonly retries: number;

  constructor(private db: Database.Database, private generator: Generator, options: SupplyOptions = {}) {
    this.queueLimit = options.queueLimit ?? 8;
    this.perKey = options.perKey ?? 2;
    this.maxCached = options.maxCached ?? 300;
    this.retries = options.retries ?? 2;
  }

  static key(category: CategoryId, level: LevelId, child: boolean): string {
    return [category, level, child ? "barn" : "voksen", `w${WORD_LIST_VERSION}`, `t${CATEGORY_TAG_VERSION}`,
      `c${CHILD_POLICY_VERSION}`, `v${VALIDATION_VERSION}`].join("|");
  }

  // Removes cached puzzles from older word list, category, policy or validation versions.
  prune(): number {
    const current = new Set((Object.keys(CATEGORIES) as CategoryId[]).flatMap((category) => [false, true].flatMap((child) =>
      availableLevels(category, child).map((level) => PuzzleSupply.key(category, level, child)))));
    const keys = (this.db.prepare("SELECT DISTINCT cache_key AS key FROM puzzle_cache").all() as Array<{ key: string }>).map((row) => row.key);
    let removed = 0;
    for (const key of keys) if (!current.has(key)) removed += this.db.prepare("DELETE FROM puzzle_cache WHERE cache_key = ?").run(key).changes;
    return removed;
  }

  status() {
    return { queued: this.queue.length, running: this.running,
      cached: (this.db.prepare("SELECT COUNT(*) AS count FROM puzzle_cache").get() as { count: number }).count };
  }

  cachedCount(category: CategoryId, level: LevelId, child: boolean): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM puzzle_cache WHERE cache_key = ?")
      .get(PuzzleSupply.key(category, level, child)) as { count: number }).count;
  }

  // Takes a cached puzzle without waiting; null when none is ready.
  takeCached(category: CategoryId, level: LevelId, child: boolean): Puzzle | null {
    const key = PuzzleSupply.key(category, level, child);
    const take = this.db.transaction(() => {
      for (;;) {
        const row = this.db.prepare("SELECT id, puzzle FROM puzzle_cache WHERE cache_key = ? ORDER BY created_at, id LIMIT 1").get(key) as { id: string; puzzle: string } | undefined;
        if (!row) return null;
        this.db.prepare("DELETE FROM puzzle_cache WHERE id = ?").run(row.id);
        const puzzle = JSON.parse(row.puzzle) as Puzzle;
        if (puzzle.child === child && puzzle.category === category && puzzle.level === level && validatePuzzle(puzzle) === null) return puzzle;
      }
    });
    const puzzle = take();
    this.refill(category, level, child);
    return puzzle;
  }

  // A cached puzzle, or a newly generated one when the cache is empty.
  async take(category: CategoryId, level: LevelId, child: boolean): Promise<Puzzle> {
    if (!availableLevels(category, child).includes(level)) throw new Error("Dette niveau er ikke tilgængeligt i kategorien.");
    return this.takeCached(category, level, child) ?? await this.enqueue(category, level, child, true);
  }

  // Makes sure at least count puzzles are cached across the given categories, e.g. before
  // a campaign refill takes them inside a database transaction.
  async prepare(categories: CategoryId[], level: LevelId, child: boolean, count: number): Promise<void> {
    const ready = () => categories.reduce((sum, category) => sum + this.cachedCount(category, level, child), 0);
    const missing = count - ready();
    const jobs: Array<Promise<Puzzle>> = [];
    for (let index = 0; index < missing; index++) {
      const category = categories[index % categories.length];
      jobs.push(this.enqueue(category, level, child, true).then((puzzle) => { this.store(puzzle); return puzzle; }));
    }
    await Promise.all(jobs);
  }

  async close(): Promise<void> {
    for (const job of this.queue.splice(0)) job.reject(new Error("Serveren lukker."));
    await this.generator.close();
  }

  private store(puzzle: Puzzle): void {
    const key = PuzzleSupply.key(puzzle.category, puzzle.level, puzzle.child);
    this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO puzzle_cache (id, cache_key, puzzle) VALUES (?, ?, ?)").run(puzzle.id, key, JSON.stringify(puzzle));
      // Keep the cache bounded; the oldest puzzles go first.
      this.db.prepare("DELETE FROM puzzle_cache WHERE id IN (SELECT id FROM puzzle_cache ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?)").run(this.maxCached);
    })();
  }

  private refill(category: CategoryId, level: LevelId, child: boolean): void {
    const key = PuzzleSupply.key(category, level, child);
    const cachedNow = this.cachedCount(category, level, child);
    while (cachedNow + (this.refilling.get(key) ?? 0) < this.perKey && this.queue.length < this.queueLimit) {
      this.refilling.set(key, (this.refilling.get(key) ?? 0) + 1);
      this.enqueue(category, level, child, false)
        .then((puzzle) => this.store(puzzle))
        .catch(() => { /* A refill is best effort; the next request tries again. */ })
        .finally(() => {
          const left = (this.refilling.get(key) ?? 1) - 1;
          if (left > 0) this.refilling.set(key, left); else this.refilling.delete(key);
        });
    }
  }

  private enqueue(category: CategoryId, level: LevelId, child: boolean, urgent: boolean): Promise<Puzzle> {
    if (this.queue.length >= this.queueLimit) {
      // A player request may push out a background refill, but never another player request.
      let refill = -1;
      if (urgent) for (let index = this.queue.length - 1; index >= 0 && refill < 0; index--) if (!this.queue[index].urgent) refill = index;
      if (refill < 0) return Promise.reject(new SupplyBusyError());
      this.queue.splice(refill, 1)[0].reject(new SupplyBusyError());
    }
    return new Promise<Puzzle>((resolve, reject) => {
      const job = { category, level, child, urgent, resolve, reject };
      // Player requests go before background refills.
      const index = urgent ? this.queue.findIndex((item) => !item.urgent) : -1;
      if (index >= 0) this.queue.splice(index, 0, job); else this.queue.push(job);
      void this.drain();
    });
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (let job = this.queue.shift(); job; job = this.queue.shift()) {
        let lastError: Error = new Error("Banen kunne ikke dannes.");
        let made: Puzzle | null = null;
        for (let attempt = 0; attempt <= this.retries && !made; attempt++) {
          try {
            const puzzle = await this.generator.run({ id: randomUUID(), category: job.category, level: job.level, seed: randomBytes(4).readUInt32BE(), child: job.child });
            // The worker's result is checked again here before it can be stored or delivered.
            if (puzzle.category !== job.category || puzzle.level !== job.level || puzzle.child !== job.child || validatePuzzle(puzzle)) throw new Error("Banen kunne ikke valideres.");
            made = puzzle;
          } catch (cause) { lastError = cause instanceof Error ? cause : new Error(String(cause)); }
        }
        if (made) job.resolve(made); else job.reject(lastError);
      }
    } finally { this.running = false; }
  }
}
