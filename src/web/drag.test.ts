import { describe, expect, it } from "vitest";
import { cellsBetween } from "../shared/game.js";
import { snapDragEnd } from "./drag.js";

describe("forhåndsvisning af træk", () => {
  it("holder en sammenhængende diagonal ved en skæv fingerposition", () => {
    const start = { row: 2, col: 2 };
    const end = snapDragEnd(start, { row: 6.1, col: 5.6 }, 12, 8);
    expect(end).toEqual({ row: 6, col: 6 });
    expect(cellsBetween(start, end)).toEqual([
      { row: 2, col: 2 }, { row: 3, col: 3 }, { row: 4, col: 4 },
      { row: 5, col: 5 }, { row: 6, col: 6 }
    ]);
  });

  it("kan forhåndsvise diagonaler i alle fire retninger", () => {
    const start = { row: 4, col: 4 };
    for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
      const end = snapDragEnd(start, { row: start.row + dr * 3.2, col: start.col + dc * 2.8 }, 10, 8);
      expect(Math.sign(end.row - start.row)).toBe(dr);
      expect(Math.sign(end.col - start.col)).toBe(dc);
      expect(cellsBetween(start, end)).toHaveLength(4);
    }
  });

  it("respekterer niveauets tilladte retninger og gitterets kant", () => {
    const start = { row: 2, col: 2 };
    const pointer = { row: 5, col: 5 };
    const easy = snapDragEnd(start, pointer, 8, 2);
    const normal = snapDragEnd(start, pointer, 8, 4);
    expect(easy.row === start.row || easy.col === start.col).toBe(true);
    expect(normal.row === start.row || normal.col === start.col).toBe(true);
    expect(snapDragEnd({ row: 7, col: 7 }, { row: 12, col: 12 }, 8, 8)).toEqual({ row: 7, col: 7 });
  });

  it("holder en valgt retning stabil ved små bevægelser", () => {
    const start = { row: 1, col: 1 };
    const previous = { row: 4, col: 4 };
    expect(snapDragEnd(start, { row: 4, col: 3.45 }, 8, 8, previous)).toEqual(previous);
  });
});
