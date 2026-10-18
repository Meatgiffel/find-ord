import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES, adultOnlyReason, categoryWords, type CategoryId } from "./words.js";

describe("ordindhold", () => {
  it("har en COR-kilde og en ajourført kildefil for hvert ord i hver kategori", () => {
    // content/ordkilder.tsv is written by npm run report:words; rerun it after changing the lists.
    const rows = readFileSync("content/ordkilder.tsv", "utf8").trim().split("\n").slice(1).map((line) => line.split("\t"));
    const expected = (Object.keys(CATEGORIES) as CategoryId[]).flatMap((category) => categoryWords(category).map((word) => {
      const reason = adultOnlyReason(category, word);
      return `${word}/${category}/${reason ? `nej: ${reason}` : "ja"}`;
    }));
    expect(rows.map(([word, category, child]) => `${word}/${category}/${child}`)).toEqual(expected);
    expect(rows.every((row) => /^COR\./.test(row[4]))).toBe(true);
  });

  it("indeholder kun spilbare ordformer og mindst 500 børnegodkendte ord", () => {
    const words = (Object.keys(CATEGORIES) as CategoryId[]).flatMap((category) => categoryWords(category));
    expect(words.every((word) => /^[A-ZÆØÅ]{3,16}$/.test(word))).toBe(true);
    const child = new Set((Object.keys(CATEGORIES) as CategoryId[]).flatMap((category) => categoryWords(category, true)));
    expect(child.size).toBeGreaterThanOrEqual(500);
  });
});
