import { mkdirSync, writeFileSync } from "node:fs";
import { makePuzzle } from "../src/shared/game.js";
import { validatePuzzle } from "../src/shared/validation.js";
import { CATEGORIES, availableLevels, type CategoryId } from "../src/shared/words.js";

const requested = process.argv.find((arg) => arg.startsWith("--seeds="));
const seeds = requested ? Number(requested.slice("--seeds=".length)) : 1000;
if (!Number.isInteger(seeds) || seeds < 1) throw new Error("Brug --seeds med et positivt heltal.");

type Failure = { category: CategoryId; level: string; profile: "barn" | "voksen"; seed: number; error: string };
const failures: Failure[] = [];
let checked = 0;
const start = performance.now();

for (const category of Object.keys(CATEGORIES) as CategoryId[]) {
  for (const level of availableLevels(category)) {
    for (const child of [false, true]) {
      const profile = child ? "barn" : "voksen";
      for (let seed = 1; seed <= seeds; seed++) {
        try {
          const puzzle = makePuzzle(`ci-${category}-${level}-${profile}-${seed}`, category, level, seed, child);
          const problem = validatePuzzle(puzzle);
          if (problem) throw new Error(problem);
          checked++;
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          failures.push({ category, level, profile, seed, error });
          console.error(`FAIL category=${category} level=${level} profile=${profile} seed=${seed}: ${error}`);
        }
      }
    }
    console.log(`Kontrolleret ${category}/${level}: ${seeds} seeds pr. profil.`);
  }
}

const report = {
  seedsPerCombination: seeds,
  checked,
  failures,
  durationSeconds: Math.round((performance.now() - start) / 1000)
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/generator.json", JSON.stringify(report, null, 2) + "\n");
console.log(`Generator: ${checked} gyldige baner, ${failures.length} fejl. Rapport: reports/generator.json`);
if (failures.length) process.exitCode = 1;
