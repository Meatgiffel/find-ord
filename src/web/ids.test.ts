import { describe, expect, it } from "vitest";
import { newMoveId } from "./ids.js";

describe("træk-id på HTTP-adressen", () => {
  it("danner unikke UUID'er uden crypto.randomUUID", () => {
    const ids = Array.from({ length: 100 }, newMoveId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
