import { DIRECTIONS } from "../shared/words.js";
import type { Point } from "../shared/game.js";

// Snap a pointer position to the nearest legal end cell instead of dropping the
// preview whenever a finger drifts slightly away from an exact diagonal.
export function snapDragEnd(
  start: Point,
  pointer: { row: number; col: number },
  size: number,
  directions: number,
  previous?: Point | null
): Point {
  let best = start;
  let bestDistance = (pointer.row - start.row) ** 2 + (pointer.col - start.col) ** 2;
  const previousDirection = previous && (previous.row !== start.row || previous.col !== start.col)
    ? [Math.sign(previous.row - start.row), Math.sign(previous.col - start.col)]
    : null;

  for (const [dr, dc] of DIRECTIONS.slice(0, directions)) {
    for (let step = 1; step < size; step++) {
      const row = start.row + dr * step;
      const col = start.col + dc * step;
      if (row < 0 || col < 0 || row >= size || col >= size) break;
      const directionChange = previousDirection &&
        (previousDirection[0] !== dr || previousDirection[1] !== dc) ? 0.12 : 0;
      const distance = (pointer.row - row) ** 2 + (pointer.col - col) ** 2 + directionChange;
      if (distance < bestDistance) { bestDistance = distance; best = { row, col }; }
    }
  }
  return best;
}
