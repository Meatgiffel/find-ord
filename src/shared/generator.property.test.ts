import { describe, expect, it } from "vitest";
import { findWord, makePuzzle, wordAt, type Puzzle } from "./game.js";
import { blockedFragment, CHILD_POLICY_VERSION } from "./safety.js";
import { validatePuzzle } from "./validation.js";
import { CATEGORIES, DIRECTIONS, LEVELS, categoryWords, levelsCoveredBy, type CategoryId, type LevelId } from "./words.js";

const categories = Object.keys(CATEGORIES) as CategoryId[];
const levels = Object.keys(LEVELS) as LevelId[];

// Location and direction of every target word, found by scanning the grid.
function placements(puzzle: Puzzle) {
  return puzzle.words.map((word) => {
    const { start, end } = findWord(puzzle, word)!;
    return { word, start, end, dr: Math.sign(end.row - start.row), dc: Math.sign(end.col - start.col) };
  });
}

function write(grid: string[][], word: string, row: number, col: number, dr: number, dc: number) {
  [...word].forEach((letter, index) => { grid[row + dr * index][col + dc * index] = letter; });
}

describe("egenskaber for banegeneratoren", () => {
  it("bruger alle niveauets retninger og kun dem, rammer alle kanter og lader ord krydse", () => {
    for (const level of levels) {
      const allowed = DIRECTIONS.slice(0, LEVELS[level].directions).map(([dr, dc]) => `${dr},${dc}`);
      const used = new Set<string>();
      const edges = new Set<string>();
      let crossings = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const puzzle = makePuzzle("p", "dyr", level, seed);
        const last = puzzle.grid.length - 1;
        const owners = new Map<string, number>();
        for (const { word, start, dr, dc } of placements(puzzle)) {
          used.add(`${dr},${dc}`);
          for (let index = 0; index < word.length; index++) {
            const row = start.row + dr * index, col = start.col + dc * index;
            if (row === 0) edges.add("top"); if (row === last) edges.add("bottom");
            if (col === 0) edges.add("left"); if (col === last) edges.add("right");
            owners.set(`${row},${col}`, (owners.get(`${row},${col}`) ?? 0) + 1);
          }
        }
        crossings += [...owners.values()].filter((count) => count > 1).length;
      }
      expect([...used].sort()).toEqual([...allowed].sort());
      expect(edges.size).toBe(4);
      expect(crossings).toBeGreaterThan(0);
    }
  }, 30000);

  it("holder ordlængder, unikke mål og danske bogstaver som ét tegn", () => {
    let danish = 0;
    for (const level of levels) for (const child of [false, true]) for (let seed = 1; seed <= 25; seed++) {
      const puzzle = makePuzzle("p", "mad", level, seed, child);
      const setting = LEVELS[level];
      expect(new Set(puzzle.words).size).toBe(setting.words);
      expect(puzzle.words.every((word) => word.length >= setting.min && word.length <= setting.max)).toBe(true);
      expect(puzzle.grid.flat().every((cell) => /^[A-ZÆØÅ]$/.test(cell) && cell === cell.normalize("NFC"))).toBe(true);
      danish += puzzle.words.filter((word) => /[ÆØÅ]/.test(word)).length;
    }
    expect(danish).toBeGreaterThan(0);
  }, 30000);

  it("bruger kun ord fra banens ene kategori, også for ord i flere kategorier", () => {
    for (const category of categories) for (const child of [false, true]) for (let seed = 1; seed <= 10; seed++) {
      const puzzle = makePuzzle("p", category, "normal", seed, child);
      const allowed = new Set(categoryWords(category, child));
      expect(puzzle.words.every((word) => allowed.has(word))).toBe(true);
    }
    // FISK is listed in both Dyr and Mad; a game in one is still only valid in the categories that list its words.
    expect(categoryWords("dyr")).toContain("FISK");
    expect(categoryWords("mad")).toContain("FISK");
    const puzzle = makePuzzle("p", "dyr", "let", 4);
    const other = categories.find((category) => puzzle.words.some((word) => !categoryWords(category).includes(word)))!;
    expect(validatePuzzle({ ...puzzle, category: other })).toBe("Et målord hører ikke til kategorien.");
  });

  it("afviser ulovlige kombinationer før generering og kender små puljers niveauer", () => {
    expect(() => makePuzzle("p", "ukendt" as CategoryId, "let", 1)).toThrow("ikke nok ord");
    expect(() => makePuzzle("p", "dyr", "umuligt" as LevelId, 1)).toThrow("ikke nok ord");
    expect(levelsCoveredBy([])).toEqual([]);
    expect(levelsCoveredBy(["HUND", "KAT", "MUS", "GRIS", "HEST"])).toEqual([]);
    expect(levelsCoveredBy(["HUND", "KAT", "MUS", "GRIS", "HEST", "GED"])).toEqual(["let"]);
    // Farver has the smallest pool for Let; it still generates.
    expect(categoryWords("farver").filter((word) => word.length <= LEVELS.let.max).length).toBeLessThan(25);
    for (let seed = 1; seed <= 20; seed++) expect(validatePuzzle(makePuzzle("p", "farver", "let", seed, true))).toBeNull();
  });

  it("stopper inden for budgettet i stedet for at udlevere et ukontrolleret gitter", () => {
    // Every candidate contains a blocked sequence that is not part of an approved word.
    const pool = ["APORN", "BPORN", "CPORN", "DPORN", "EPORN", "FPORN", "GPORN"];
    expect(() => makePuzzle("p", "dyr", "let", 1, true, pool)).toThrow("genereringsbudgettet");
    // Words outside the category list never pass the final validation either.
    expect(() => makePuzzle("p", "dyr", "let", 1, false, ["ABCD", "BCDE", "CDEF", "DEFG", "EFGH", "FGHI"])).toThrow("genereringsbudgettet");
  });

  it("finder palindromer og gentagne ord ét sted og afviser dublerede mål", () => {
    const puzzle = makePuzzle("p", "dyr", "normal", 7);
    const grid = puzzle.grid.map((row) => [...row]);
    write(grid, "AKKA", 11, 0, 0, 1);
    const palindrome: Puzzle = { ...puzzle, grid, words: [...puzzle.words.slice(1), "AKKA"] };
    expect(wordAt(palindrome, { row: 11, col: 0 }, { row: 11, col: 3 })).toBe("AKKA");
    expect(wordAt(palindrome, { row: 11, col: 3 }, { row: 11, col: 0 })).toBe("AKKA");
    const twice = puzzle.grid.map((row) => [...row]);
    write(twice, puzzle.words[0], 0, 0, 1, 0);
    expect(findWord({ ...puzzle, grid: twice }, puzzle.words[0])).not.toBeNull();
    expect(validatePuzzle({ ...puzzle, words: [puzzle.words[0], ...puzzle.words.slice(0, -1)] })).toBe("Mållisten er ugyldig.");
  });
});

describe("egenskaber for børnefiltret", () => {
  it("udleverer aldrig et børnegitter med en blokeret sekvens", () => {
    for (const category of categories) for (const level of levels) for (let seed = 1; seed <= 8; seed++) {
      const puzzle = makePuzzle("barn", category, level, seed, true);
      expect(blockedFragment(puzzle.grid)).toBeNull();
      expect(puzzle.childPolicyVersion).toBe(CHILD_POLICY_VERSION);
    }
  }, 60000);

  it("fanger injicerede sekvenser som mål, fyld, krydsning, delstreng og baglæns", () => {
    const base = makePuzzle("barn", "dyr", "svaer", 3, true);
    const cases: Array<[string, (grid: string[][]) => void]> = [
      ["mål", (grid) => write(grid, "PORNO", 0, 0, 0, 1)],
      ["fyld", (grid) => write(grid, "KNEP", 15, 0, 0, 1)],
      ["krydsning", (grid) => { write(grid, "XPXX", 0, 5, 0, 1); write(grid, "PORN", 0, 6, 1, 0); }],
      ["delstreng", (grid) => write(grid, "ALUDERE", 8, 0, 0, 1)],
      ["baglæns", (grid) => write(grid, "DLOV", 4, 4, 1, 1)],
      // PIS is excused inside SPISEBORD only along the same line, not when it crosses it.
      ["krydser godkendt ord", (grid) => { write(grid, "SPISEBORD", 2, 0, 0, 1); write(grid, "PIS", 1, 2, 1, 0); }]
    ];
    for (const [name, inject] of cases) {
      const grid = base.grid.map((row) => [...row]);
      inject(grid);
      expect(blockedFragment(grid), name).not.toBeNull();
      expect(validatePuzzle({ ...base, grid }), name).not.toBeNull();
    }
  });

  it("afviser børnebaner efter skift af ord- eller sikkerhedsversion", () => {
    const puzzle = makePuzzle("barn", "dyr", "let", 9, true);
    expect(validatePuzzle({ ...puzzle, childPolicyVersion: CHILD_POLICY_VERSION - 1 })).not.toBeNull();
    expect(validatePuzzle({ ...puzzle, childPolicyVersion: null })).not.toBeNull();
    expect(validatePuzzle({ ...puzzle, wordListVersion: puzzle.wordListVersion + 1 })).toBe("Banens version er udgået.");
    expect(validatePuzzle({ ...puzzle, child: false })).toBe("Banens profilversion er ugyldig.");
  });
});
