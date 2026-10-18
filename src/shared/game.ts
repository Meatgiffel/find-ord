import { CATEGORIES, CATEGORY_TAG_VERSION, DIRECTIONS, LEVELS, WORD_LIST_VERSION, availableLevels, categoryWords, lemmaKey, type CategoryId, type LevelId } from "./words.js";
import { blockedFragment, CHILD_POLICY_VERSION } from "./safety.js";
import { VALIDATION_VERSION, validatePuzzle } from "./validation.js";

export type Point = { row: number; col: number };
export type Puzzle = {
  id: string;
  category: CategoryId;
  level: LevelId;
  grid: string[][];
  words: string[];
  seed: number;
  version: 1;
  wordListVersion: number;
  categoryTagVersion: number;
  validationVersion: number;
  child: boolean;
  childPolicyVersion: number | null;
};
export type Move = { id: string; kind: "find" | "hint" | "complete" | "abandon"; word?: string; start?: Point; end?: Point };

export const HINT_LIMIT: Record<LevelId, number> = { let: 1, normal: 2, svaer: 3, ekspert: 4 };

export function hintsRemaining(level: LevelId, hints: readonly string[]): number {
  return Math.max(0, HINT_LIMIT[level] - new Set(hints).size);
}

export function hintError(puzzle: Puzzle, found: readonly string[], hints: readonly string[], word: string | undefined): string | null {
  if (!word || !puzzle.words.includes(word) || found.includes(word)) return "Hintet er ugyldigt.";
  if (hints.includes(word)) return "Ordet har allerede fået et hint.";
  if (hintsRemaining(puzzle.level, hints) === 0) return "Alle hints på denne bane er brugt.";
  return null;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function shuffle<T>(items: T[], next: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

const LETTERS = "AAAAAAAEEEEEEEEEIIIIINNNNNNRRRRRRSSSSSTTTTTDDDDLLLKKKMMMOOOØØÆÅBBBFFGGHHJPUVY";

// pool replaces the category list in tests; the result must still pass validatePuzzle.
// Words in avoid (e.g. from the player's recent boards) are only used when needed.
export function makePuzzle(id: string, category: CategoryId, level: LevelId, seed: number, child = false, pool?: readonly string[], avoid?: ReadonlySet<string>): Puzzle {
  if (!Object.hasOwn(CATEGORIES, category) || !Object.hasOwn(LEVELS, level) || (!pool && !availableLevels(category, child).includes(level))) throw new Error("Kategorien har ikke nok ord til niveauet.");
  const setting = LEVELS[level];
  const next = random(seed);
  for (let layoutAttempt = 0; layoutAttempt < 30; layoutAttempt++) {
    const shuffled = shuffle([...(pool ?? categoryWords(category, child))]
      .filter((word) => word.length >= setting.min && word.length <= setting.max), next);
    const candidates = avoid?.size ? [...shuffled.filter((word) => !avoid.has(word)), ...shuffled.filter((word) => avoid.has(word))] : shuffled;
    const lemmas = new Set<string>();
    const grid = Array.from({ length: setting.size }, () => Array<string>(setting.size).fill(""));
    const chosen: string[] = [];
    for (const word of candidates) {
      if (lemmas.has(lemmaKey(word))) continue;
      const positions = shuffle(
        Array.from({ length: setting.size * setting.size * setting.directions }, (_, index) => {
          const direction = DIRECTIONS[index % setting.directions];
          const cell = Math.floor(index / setting.directions);
          return { row: Math.floor(cell / setting.size), col: cell % setting.size, dr: direction[0], dc: direction[1] };
        }), next
      );
      for (const p of positions) {
        const endRow = p.row + p.dr * (word.length - 1);
        const endCol = p.col + p.dc * (word.length - 1);
        if (endRow < 0 || endCol < 0 || endRow >= setting.size || endCol >= setting.size) continue;
        let fits = true;
        for (let i = 0; i < word.length; i++) {
          const value = grid[p.row + p.dr * i][p.col + p.dc * i];
          if (value && value !== word[i]) { fits = false; break; }
        }
        if (!fits) continue;
        for (let i = 0; i < word.length; i++) grid[p.row + p.dr * i][p.col + p.dc * i] = word[i];
        chosen.push(word);
        lemmas.add(lemmaKey(word));
        break;
      }
      if (chosen.length === setting.words) break;
    }
    if (chosen.length !== setting.words) continue;
    // A blocked term formed by placed words cannot be removed by changing filler letters.
    if (child && blockedFragment(grid)) continue;
    const fixed = grid.map((row) => [...row]);
    for (let fillAttempt = 0; fillAttempt < (child ? 30 : 1); fillAttempt++) {
      for (let row = 0; row < grid.length; row++) for (let col = 0; col < grid.length; col++) {
        grid[row][col] = fixed[row][col] || LETTERS[Math.floor(next() * LETTERS.length)];
      }
      if (child && blockedFragment(grid)) continue;
      const puzzle: Puzzle = {
        id, category, level, grid, words: chosen, seed, version: 1,
        wordListVersion: WORD_LIST_VERSION, categoryTagVersion: CATEGORY_TAG_VERSION,
        validationVersion: VALIDATION_VERSION, child, childPolicyVersion: child ? CHILD_POLICY_VERSION : null
      };
      if (validatePuzzle(puzzle) === null) return puzzle;
    }
  }
  throw new Error("Banen kunne ikke valideres inden for genereringsbudgettet. Prøv igen.");
}

export function cellsBetween(start: Point, end: Point): Point[] | null {
  const rowDiff = end.row - start.row;
  const colDiff = end.col - start.col;
  const length = Math.max(Math.abs(rowDiff), Math.abs(colDiff)) + 1;
  if (rowDiff !== 0 && colDiff !== 0 && Math.abs(rowDiff) !== Math.abs(colDiff)) return null;
  const dr = Math.sign(rowDiff), dc = Math.sign(colDiff);
  return Array.from({ length }, (_, i) => ({ row: start.row + i * dr, col: start.col + i * dc }));
}

export function wordAt(puzzle: Puzzle, start: Point, end: Point): string | null {
  const cells = cellsBetween(start, end);
  if (!cells || cells.some(({ row, col }) => row < 0 || col < 0 || row >= puzzle.grid.length || col >= puzzle.grid.length)) return null;
  const direction = [Math.sign(end.row - start.row), Math.sign(end.col - start.col)];
  if (!DIRECTIONS.slice(0, LEVELS[puzzle.level].directions).some(([dr, dc]) => dr === direction[0] && dc === direction[1])) return null;
  const word = cells.map(({ row, col }) => puzzle.grid[row][col]).join("");
  return puzzle.words.includes(word) ? word : null;
}

export function findWord(puzzle: Puzzle, word: string): { start: Point; end: Point } | null {
  for (let row = 0; row < puzzle.grid.length; row++) for (let col = 0; col < puzzle.grid.length; col++) {
    for (const [dr, dc] of DIRECTIONS.slice(0, LEVELS[puzzle.level].directions)) {
      const end = { row: row + dr * (word.length - 1), col: col + dc * (word.length - 1) };
      if (wordAt(puzzle, { row, col }, end) === word) return { start: { row, col }, end };
    }
  }
  return null;
}

export function visibleHint(puzzle: Puzzle, found: readonly string[], hints: readonly string[]): { word: string; start: Point } | null {
  const word = hints.at(-1);
  if (!word || found.includes(word)) return null;
  const location = findWord(puzzle, word);
  return location ? { word, start: location.start } : null;
}
