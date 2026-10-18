import type { Puzzle } from "./game.js";
import { blockedFragment, CHILD_POLICY_VERSION } from "./safety.js";
import { CATEGORIES, CATEGORY_TAG_VERSION, DIRECTIONS, LEVELS, WORD_LIST_VERSION, categoryWords, type CategoryId, type LevelId } from "./words.js";

export const VALIDATION_VERSION = 1;
const LETTER = /^[A-ZÆØÅ]$/;

// Search the finished grid directly. This does not use the generator's placements or wordAt().
function containsWord(grid: string[][], word: string, directions: number): boolean {
  const size = grid.length;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    for (const [dr, dc] of DIRECTIONS.slice(0, directions)) {
      const endRow = row + dr * (word.length - 1);
      const endCol = col + dc * (word.length - 1);
      if (endRow < 0 || endCol < 0 || endRow >= size || endCol >= size) continue;
      if ([...word].every((letter, index) => grid[row + dr * index][col + dc * index] === letter)) return true;
    }
  }
  return false;
}

function knownVersion(version: unknown, current: number): boolean {
  return Number.isInteger(version) && (version as number) >= 1 && (version as number) <= current;
}

export function validatePuzzle(puzzle: Puzzle): string | null {
  if (!puzzle || !Object.hasOwn(CATEGORIES, puzzle.category) || !Object.hasOwn(LEVELS, puzzle.level)) return "Ukendt kategori eller niveau.";
  if (typeof puzzle.child !== "boolean") return "Banens profil er ugyldig.";
  // Older word list and tag versions stay playable while every target word still
  // belongs to the active category list, which is checked below.
  if (puzzle.version !== 1 || puzzle.validationVersion !== VALIDATION_VERSION ||
    !knownVersion(puzzle.wordListVersion, WORD_LIST_VERSION) || !knownVersion(puzzle.categoryTagVersion, CATEGORY_TAG_VERSION)) return "Banens version er udgået.";
  const setting = LEVELS[puzzle.level as LevelId];
  if (!Array.isArray(puzzle.grid) || puzzle.grid.length !== setting.size ||
    puzzle.grid.some((row) => !Array.isArray(row) || row.length !== setting.size || row.some((cell) => typeof cell !== "string" || !LETTER.test(cell)))) return "Gitteret er ugyldigt.";
  if (!Array.isArray(puzzle.words) || puzzle.words.length !== setting.words || new Set(puzzle.words).size !== setting.words) return "Mållisten er ugyldig.";
  const allowed = new Set(categoryWords(puzzle.category as CategoryId, puzzle.child));
  for (const word of puzzle.words) {
    if (typeof word !== "string" || !allowed.has(word) || word.length < setting.min || word.length > setting.max) return "Et målord hører ikke til kategorien.";
    if (!containsWord(puzzle.grid, word, setting.directions)) return "Et målord mangler i gitteret.";
  }
  if (puzzle.child) {
    if (puzzle.childPolicyVersion !== CHILD_POLICY_VERSION || blockedFragment(puzzle.grid)) return "Børnebanen opfylder ikke den aktive sikkerhedspolitik.";
  } else if (puzzle.childPolicyVersion !== null) return "Banens profilversion er ugyldig.";
  return null;
}

// Older saved puzzles had no explicit word, category or validation version. Recheck
// their complete contents before adding current version markers during migration.
export function revalidateLegacyPuzzle(puzzle: Puzzle): Puzzle | null {
  if (!puzzle || puzzle.version !== 1 || puzzle.validationVersion != null ||
    puzzle.wordListVersion != null || puzzle.categoryTagVersion != null) return null;
  const updated = {
    ...puzzle, validationVersion: VALIDATION_VERSION,
    wordListVersion: WORD_LIST_VERSION, categoryTagVersion: CATEGORY_TAG_VERSION
  };
  return validatePuzzle(updated) === null ? updated : null;
}
