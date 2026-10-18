import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CATEGORIES, LEMMA_GROUPS, adultOnlyReason, categoryWords, type CategoryId } from "./words.js";

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

  it("kender alle ord i samme kategori, der er bøjninger af samme COR-lemma", () => {
    // The second part of a COR ID (COR.<lemma>.<form>.<variant>) identifies the lemma.
    const rows = readFileSync("content/ordkilder.tsv", "utf8").trim().split("\n").slice(1).map((line) => line.split("\t"));
    const groups = new Map<string, Set<string>>();
    for (const [word, category, , , ids] of rows) for (const id of ids.split(",")) {
      const key = `${category}/${id.split(".")[1]}`;
      groups.set(key, (groups.get(key) ?? new Set()).add(word));
    }
    const found = new Set([...groups.values()].filter((words) => words.size > 1).map((words) => [...words].sort().join("+")));
    expect([...found].sort()).toEqual(LEMMA_GROUPS.map((group) => [...group].sort().join("+")).sort());
  });
});
