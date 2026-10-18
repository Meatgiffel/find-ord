import { mkdirSync, writeFileSync } from "node:fs";
import { makePuzzle } from "../src/shared/game.js";
import { CHILD_POLICY_VERSION } from "../src/shared/safety.js";
import { VALIDATION_VERSION, validatePuzzle } from "../src/shared/validation.js";
import { CATEGORIES, CATEGORY_TAG_VERSION, LEVELS, WORD_LIST_VERSION, availableLevels, categoryWords, type CategoryId, type LevelId } from "../src/shared/words.js";

const requested = process.argv.find((arg) => arg.startsWith("--seeds="));
const seeds = requested ? Number(requested.slice("--seeds=".length)) : 1000;
if (!Number.isInteger(seeds) || seeds < 1) throw new Error("Brug --seeds med et positivt heltal.");

const versions = { words: WORD_LIST_VERSION, categories: CATEGORY_TAG_VERSION, childPolicy: CHILD_POLICY_VERSION, validation: VALIDATION_VERSION };
type Profile = "barn" | "voksen";
type Failure = { category: CategoryId; level: LevelId; profile: Profile; seed: number; error: string; versions: typeof versions };
type Combination = { category: CategoryId; level: LevelId; profile: Profile; seeds: number; valid: number; successRate: number; averageMs: number; maxMs: number };
const failures: Failure[] = [];
const combinations: Combination[] = [];
const unavailable: Array<{ category: CategoryId; level: LevelId; profile: Profile; words: number; needed: number }> = [];
let checked = 0;
const start = performance.now();

for (const category of Object.keys(CATEGORIES) as CategoryId[]) {
  for (const child of [false, true]) {
    const profile: Profile = child ? "barn" : "voksen";
    for (const level of Object.keys(LEVELS) as LevelId[]) {
      if (availableLevels(category, child).includes(level)) continue;
      const setting = LEVELS[level];
      unavailable.push({ category, level, profile, needed: setting.words,
        words: categoryWords(category, child).filter((word) => word.length >= setting.min && word.length <= setting.max).length });
    }
    for (const level of availableLevels(category, child)) {
      let valid = 0, total = 0, max = 0;
      const allowed = new Set(categoryWords(category, child));
      for (let seed = 1; seed <= seeds; seed++) {
        const began = performance.now();
        try {
          const puzzle = makePuzzle(`ci-${category}-${level}-${profile}-${seed}`, category, level, seed, child);
          const problem = validatePuzzle(puzzle);
          if (problem) throw new Error(problem);
          if (!puzzle.words.every((word) => allowed.has(word))) throw new Error("Et målord hører ikke til banens kategori og profil.");
          valid++;
          checked++;
        } catch (cause) {
          const error = cause instanceof Error ? cause.message : String(cause);
          failures.push({ category, level, profile, seed, error, versions });
          console.error(`FAIL category=${category} level=${level} profile=${profile} seed=${seed} versions=${JSON.stringify(versions)}: ${error}`);
        }
        const elapsed = performance.now() - began;
        total += elapsed;
        max = Math.max(max, elapsed);
      }
      combinations.push({ category, level, profile, seeds, valid, successRate: valid / seeds,
        averageMs: Math.round(total / seeds * 10) / 10, maxMs: Math.round(max * 10) / 10 });
      console.log(`Kontrolleret ${category}/${level}/${profile}: ${valid}/${seeds} gyldige, maks ${Math.round(max)} ms.`);
    }
  }
}

const slowest = combinations.reduce((worst, item) => item.maxMs > worst.maxMs ? item : worst, combinations[0]);
const report = {
  seedsPerCombination: seeds,
  versions,
  checked,
  successRate: checked / (checked + failures.length),
  maxMs: slowest?.maxMs ?? 0,
  slowest: slowest ? `${slowest.category}/${slowest.level}/${slowest.profile}` : null,
  unavailable,
  combinations,
  failures,
  durationSeconds: Math.round((performance.now() - start) / 1000)
};
mkdirSync("reports", { recursive: true });
writeFileSync("reports/generator.json", JSON.stringify(report, null, 2) + "\n");
console.log(`Generator: ${checked} gyldige baner, ${failures.length} fejl, maks ${report.maxMs} ms (${report.slowest}). ` +
  `${unavailable.length} utilgængelige kombinationer. Rapport: reports/generator.json`);
if (failures.length) process.exitCode = 1;
