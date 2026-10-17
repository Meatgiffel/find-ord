import { describe, expect, it } from "vitest";
import { makePuzzle, type Puzzle } from "./game.js";
import { blockedFragment } from "./safety.js";
import { DIRECTIONS } from "./words.js";
import { revalidateLegacyPuzzle, validatePuzzle } from "./validation.js";

function changed(puzzle: Puzzle): Puzzle {
  return { ...puzzle, grid: puzzle.grid.map((row) => [...row]), words: [...puzzle.words] };
}

describe("slutvalidering af baner", () => {
  it("godkender genererede baner og afviser manglende løsninger", () => {
    const puzzle = makePuzzle("test", "dyr", "let", 29);
    expect(validatePuzzle(puzzle)).toBeNull();
    const missing = changed(puzzle);
    missing.grid = missing.grid.map((row) => row.map(() => "X"));
    expect(validatePuzzle(missing)).toBe("Et målord mangler i gitteret.");
  });

  it("afviser forkert kategori, ugyldigt gitter og udgåede versioner", () => {
    const puzzle = makePuzzle("test", "dyr", "let", 29);
    expect(validatePuzzle({ ...puzzle, category: "mad" })).toBe("Et målord hører ikke til kategorien.");
    expect(validatePuzzle({ ...puzzle, categoryTagVersion: puzzle.categoryTagVersion + 1 })).toBe("Banens version er udgået.");
    expect(validatePuzzle({ ...puzzle, wordListVersion: puzzle.wordListVersion + 1 })).toBe("Banens version er udgået.");
    expect(validatePuzzle({ ...puzzle, validationVersion: puzzle.validationVersion + 1 })).toBe("Banens version er udgået.");
    const malformed = changed(puzzle);
    malformed.grid[0][0] = "A\u030a";
    expect(validatePuzzle(malformed)).toBe("Gitteret er ugyldigt.");
  });

  it("opgraderer kun ældre baner, der består en fuld ny validering", () => {
    const puzzle = makePuzzle("test", "dyr", "let", 29);
    const { wordListVersion: _words, categoryTagVersion: _category, validationVersion: _validation, ...legacy } = puzzle;
    expect(revalidateLegacyPuzzle(legacy as Puzzle)).toEqual(puzzle);
    expect(revalidateLegacyPuzzle(puzzle)).toBeNull();
    expect(revalidateLegacyPuzzle({ ...legacy, category: "mad" } as Puzzle)).toBeNull();
  });

  it("afviser børnebaner med udgået politik eller blokering i fyld", () => {
    const puzzle = makePuzzle("barn", "dyr", "let", 29, true);
    expect(validatePuzzle(puzzle)).toBeNull();
    expect(validatePuzzle({ ...puzzle, childPolicyVersion: 1 })).toBe("Børnebanen opfylder ikke den aktive sikkerhedspolitik.");
    const unsafe = changed(puzzle);
    // The scan checks the whole grid, including strings that are not target words.
    [..."PORN"].forEach((letter, index) => { unsafe.grid[0][index] = letter; });
    expect(blockedFragment(unsafe.grid)).toBe("PORN");
    expect(validatePuzzle(unsafe)).not.toBeNull();
  });

  it("scanner alle retninger, også omvendte og indlejrede sekvenser", () => {
    for (const [dr, dc] of DIRECTIONS) {
      const grid = Array.from({ length: 8 }, () => Array<string>(8).fill("A"));
      const row = dr < 0 ? 6 : 1;
      const col = dc < 0 ? 6 : 1;
      [..."XPORNY"].forEach((letter, index) => { grid[row + dr * index][col + dc * index] = letter; });
      expect(blockedFragment(grid)).toBe("PORN");
    }
  });

  it("finder et blokeret ord dannet på tværs af andre ord", () => {
    const grid = Array.from({ length: 8 }, () => Array<string>(8).fill("A"));
    for (const [row, word] of ["APE", "BOG", "ORD", "AND"].entries()) {
      [...word].forEach((letter, index) => { grid[row + 1][index + 2] = letter; });
    }
    expect(blockedFragment(grid)).toBe("PORN");
  });
});
