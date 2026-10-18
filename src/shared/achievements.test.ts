import { describe, expect, it } from "vitest";
import { achievementsFor, type Progress } from "./achievements.js";

const empty: Progress = {
  completed: 0, found: 0, unique: 0,
  byLevel: {}, withoutHints: 0, danishLetters: 0,
  activeDays: 0, categories: 0,
  mostCompletedInCategory: 0, mostFoundInCategory: 0,
  campaignCompleted: 0, campaignCategories: 0, campaignWithoutHints: 0, longestCampaignRun: 0
};

describe("achievement-katalog", () => {
  it("har 47 unikke mål med tydelig progression, heraf 7 kampagnemål", () => {
    const items = achievementsFor(empty);
    expect(items).toHaveLength(47);
    expect(new Set(items.map((item) => item.id)).size).toBe(47);
    expect(items.filter((item) => item.group === "kampagne")).toHaveLength(7);
    expect(items.every((item) => !item.unlocked && item.current === 0 && item.target > 0)).toBe(true);
  });

  it("låser kun mål op ved deres egen tærskel", () => {
    const items = achievementsFor({ ...empty, completed: 5, found: 10, byLevel: { let: 1 }, categories: 1 });
    expect(items.find((item) => item.id === "completed-5")?.unlocked).toBe(true);
    expect(items.find((item) => item.id === "completed-10")?.unlocked).toBe(false);
    expect(items.find((item) => item.id === "found-10")?.unlocked).toBe(true);
    expect(items.find((item) => item.id === "let-1")?.unlocked).toBe(true);
    expect(items.find((item) => item.id === "normal-1")?.unlocked).toBe(false);
  });
});
