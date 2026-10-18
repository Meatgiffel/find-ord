import { CATEGORIES, DIRECTIONS, categoryWords, type CategoryId } from "./words.js";

// Child policy (docs/ordindhold.md). Only listed, child-approved words are target words.
// The whole grid is also scanned in all eight directions for these sequences, so
// reversed and embedded occurrences in filler letters are caught too. The list is a
// safety net, not a promise that no offensive reading can ever appear.
export const CHILD_POLICY_VERSION = 3;
export const BLOCKED_SEQUENCES = [
  // Sexual words
  "SEX", "PORN", "KNEP", "KUK", "PIK", "FISSE", "KUSSE", "DILDO", "LUDER", "HORE", "PATTER",
  // Swearing and insults
  "FUCK", "SHIT", "BITCH", "LORT", "PIS", "RØVHUL", "SATAN", "IDIOT", "SPASSER", "KLAPHAT", "TÅBE",
  // Slurs and hateful expressions
  "NEGER", "PERKER", "BØSSE", "NAZI", "HAD",
  // Violence and death
  "DRAB", "DRÆB", "MORD", "VOLD", "TERROR", "BLOD", "LIG",
  // Drugs, alcohol and tobacco
  "NARKO", "KOKAIN", "HASH", "ALKOHOL", "SPRUT", "SMØG"
] as const;

// Known false positives: a sequence that is part of a child-approved word on the same
// line, read either way, is that word, for example PIS in SPISEBORD or PIK in
// SKIPPERLABSKOVS read backwards.
const approvedWords = [...new Set((Object.keys(CATEGORIES) as CategoryId[]).flatMap((category) => categoryWords(category, true))
  .flatMap((word) => [word, [...word].reverse().join("")]))];
const EXCEPTIONS = new Map(BLOCKED_SEQUENCES.map((sequence) => [sequence, approvedWords.flatMap((word) => {
  const offsets: Array<{ word: string; offset: number }> = [];
  for (let offset = word.indexOf(sequence); offset >= 0; offset = word.indexOf(sequence, offset + 1)) offsets.push({ word, offset });
  return offsets;
})]));
const MAX_SEQUENCE_LENGTH = Math.max(...BLOCKED_SEQUENCES.map((word) => word.length));
const SEQUENCES = new Set<string>(BLOCKED_SEQUENCES);
const LENGTHS = [...new Set(BLOCKED_SEQUENCES.map((word) => word.length))];

function spells(grid: string[][], row: number, col: number, dr: number, dc: number, word: string): boolean {
  const size = grid.length;
  for (let index = 0; index < word.length; index++) {
    const r = row + dr * index, c = col + dc * index;
    if (r < 0 || c < 0 || r >= size || c >= size || grid[r][c] !== word[index]) return false;
  }
  return true;
}

export function blockedFragment(grid: string[][]): string | null {
  const size = grid.length;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    for (const [dr, dc] of DIRECTIONS) {
      let text = "";
      for (let index = 0; index < MAX_SEQUENCE_LENGTH; index++) {
        const r = row + dr * index, c = col + dc * index;
        if (r < 0 || c < 0 || r >= size || c >= size) break;
        if (!grid[r][c]) break;
        text += grid[r][c];
        for (const length of LENGTHS) {
          if (length > text.length) continue;
          const sequence = text.slice(-length);
          if (!SEQUENCES.has(sequence)) continue;
          const startRow = r - dr * (sequence.length - 1), startCol = c - dc * (sequence.length - 1);
          const excused = EXCEPTIONS.get(sequence)!.some(({ word, offset }) =>
            spells(grid, startRow - dr * offset, startCol - dc * offset, dr, dc, word));
          if (!excused) return sequence;
        }
      }
    }
  }
  return null;
}

export function currentChildPuzzle(puzzle: { child: boolean; childPolicyVersion: number | null; grid: string[][] }): boolean {
  return puzzle.child && puzzle.childPolicyVersion === CHILD_POLICY_VERSION && blockedFragment(puzzle.grid) === null;
}
