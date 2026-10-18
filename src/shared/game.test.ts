import { describe, expect, it } from "vitest";
import { CATEGORIES, DIRECTIONS, LEVELS, availableLevels, surpriseCategory, type CategoryId } from "./words.js";
import { cellsBetween, findWord, makePuzzle, visibleHint, wordAt } from "./game.js";
import { blockedFragment, currentChildPuzzle } from "./safety.js";

describe("banegenerator", () => {
  it("danner løsbare, tematiske og reproducerbare baner på annoncerede niveauer", () => {
    for (const category of Object.keys(CATEGORIES) as CategoryId[]) {
      for (const level of availableLevels(category)) {
        for (let seed = 1; seed <= 30; seed++) {
          const puzzle = makePuzzle("test", category, level, seed);
          expect(puzzle).toEqual(makePuzzle("test", category, level, seed));
          expect(puzzle.grid).toHaveLength(LEVELS[level].size);
          expect(puzzle.grid.every((row) => row.length === LEVELS[level].size)).toBe(true);
          expect(puzzle.words).toHaveLength(LEVELS[level].words);
          expect(new Set(puzzle.words).size).toBe(puzzle.words.length);
          for (const word of puzzle.words) {
            expect(CATEGORIES[category].words.includes(word as never)).toBe(true);
            const path = findWord(puzzle, word);
            expect(path).not.toBeNull();
            expect(wordAt(puzzle, path!.start, path!.end)).toBe(word);
          }
        }
      }
    }
  }, 30000);

  it("vælger kun en kategori, der kan danne det valgte niveau, ved 'Overrask mig'", () => {
    for (const level of ["let", "normal", "svaer"] as const) {
      for (const draw of [0, 0.5, 0.999]) {
        const category = surpriseCategory(level, () => draw);
        expect(category && availableLevels(category).includes(level)).toBe(true);
      }
    }
    expect(surpriseCategory("ekspert")).toBeNull();
  });

  it("afviser markeringer med knæk og uden for gitteret", () => {
    const puzzle = makePuzzle("test", "dyr", "let", 1234);
    expect(cellsBetween({ row: 0, col: 0 }, { row: 1, col: 2 })).toBeNull();
    expect(wordAt(puzzle, { row: -1, col: 0 }, { row: 2, col: 0 })).toBeNull();
  });

  it("genskaber kun det seneste aktive hint fra gemt fremdrift", () => {
    const puzzle = makePuzzle("hint-view", "dyr", "let", 1234);
    const first = puzzle.words[0], second = puzzle.words[1];
    expect(visibleHint(puzzle, [], [first])?.start).toEqual(findWord(puzzle, first)?.start);
    expect(visibleHint(puzzle, [], [first, second])?.word).toBe(second);
    expect(visibleHint(puzzle, [second], [first, second])).toBeNull();
    expect(visibleHint(puzzle, [], [])).toBeNull();
  });

  it("understøtter alle otte retninger på svære baner", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      const puzzle = makePuzzle("test", "dyr", "svaer", seed);
      for (const word of puzzle.words) {
        const path = findWord(puzzle, word)!;
        const direction = [Math.sign(path.end.row - path.start.row), Math.sign(path.end.col - path.start.col)];
        seen.add(direction.join(","));
      }
    }
    expect(seen).toEqual(new Set(DIRECTIONS.map((direction) => direction.join(","))));
  });

  it("scanner børnebaner også i fyldbogstaver og baglæns diagonaler", () => {
    const injected = Array.from({ length: 8 }, () => Array<string>(8).fill("A"));
    for (const [i, letter] of [..."PORN"].entries()) injected[7 - i][i] = letter;
    expect(blockedFragment(injected)).toBe("PORN");
    for (const [i, letter] of [..."ALKOHOL"].entries()) injected[0][i] = letter;
    expect(blockedFragment(injected)).toBe("ALKOHOL");
    for (const category of Object.keys(CATEGORIES) as CategoryId[]) {
      for (const level of availableLevels(category)) {
        for (let seed = 1; seed <= 8; seed++) {
          const puzzle = makePuzzle("barn", category, level, seed, true);
          expect(puzzle.child).toBe(true);
          expect(blockedFragment(puzzle.grid)).toBeNull();
          expect(currentChildPuzzle(puzzle)).toBe(true);
        }
      }
    }
  }, 30000);

  it("skjuler tidligere og ikke-validerede børnebaner", () => {
    const puzzle = makePuzzle("barn", "dyr", "let", 17, true);
    expect(currentChildPuzzle({ ...puzzle, childPolicyVersion: 1 })).toBe(false);
    expect(currentChildPuzzle({ ...puzzle, child: false })).toBe(false);
    const unsafe = puzzle.grid.map((row) => [...row]);
    [..."ALKOHOL"].forEach((letter, index) => { unsafe[0][index] = letter; });
    expect(currentChildPuzzle({ ...puzzle, grid: unsafe })).toBe(false);
  });
});
