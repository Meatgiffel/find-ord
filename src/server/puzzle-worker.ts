import { parentPort } from "node:worker_threads";
import { makePuzzle } from "../shared/game.js";
import type { GenerateRequest } from "./supply.js";

// Generates puzzles off the main thread. It has no database access; the main thread
// validates and stores what it returns.
parentPort!.on("message", ({ jobId, request }: { jobId: number; request: GenerateRequest }) => {
  try {
    parentPort!.postMessage({ jobId, puzzle: makePuzzle(request.id, request.category, request.level, request.seed, request.child, undefined, new Set(request.avoid)) });
  } catch (cause) {
    parentPort!.postMessage({ jobId, error: cause instanceof Error ? cause.message : String(cause) });
  }
});
