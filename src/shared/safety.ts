import { DIRECTIONS } from "./words.js";

// A conservative starter list, not a substitute for editorial review of child content.
export const CHILD_POLICY_VERSION = 2;
const BLOCKED_FRAGMENTS = [
  "FUCK", "PORN", "SEX", "LORT", "PIS", "HAD", "VOLD",
  "DRAB", "KNEP", "KUK", "FISSE", "LUDER", "NARKO", "ALKOHOL"
] as const;
const MAX_FRAGMENT_LENGTH = Math.max(...BLOCKED_FRAGMENTS.map((word) => word.length));

export function blockedFragment(grid: string[][]): string | null {
  const size = grid.length;
  for (let row = 0; row < size; row++) for (let col = 0; col < size; col++) {
    for (const [dr, dc] of DIRECTIONS) {
      let text = "";
      for (let index = 0; index < MAX_FRAGMENT_LENGTH; index++) {
        const r = row + dr * index, c = col + dc * index;
        if (r < 0 || c < 0 || r >= size || c >= size) break;
        if (!grid[r][c]) break;
        text += grid[r][c];
        const match = BLOCKED_FRAGMENTS.find((fragment) => text.endsWith(fragment));
        if (match) return match;
      }
    }
  }
  return null;
}

export function currentChildPuzzle(puzzle: { child: boolean; childPolicyVersion: number | null; grid: string[][] }): boolean {
  return puzzle.child && puzzle.childPolicyVersion === CHILD_POLICY_VERSION && blockedFragment(puzzle.grid) === null;
}
