export type Progress = {
  completed: number;
  found: number;
  unique: number;
  byLevel: Record<string, number>;
  withoutHints: number;
  danishLetters: number;
  activeDays: number;
  categories: number;
  mostCompletedInCategory: number;
  mostFoundInCategory: number;
};

// Bump when a definition changes. Awards are never revoked: a changed threshold or rule
// gets a new id, and awards for retired ids stay in the history.
export const ACHIEVEMENT_CATALOG_VERSION = 1;

export type AchievementGroup = "baner" | "ord" | "niveauer" | "hjælp" | "bogstaver" | "dage" | "kategorier";
export type AchievementIcon = "flag" | "magnifier" | "books" | "star" | "bulb" | "letters" | "calendar" | "palette";
export type Achievement = {
  id: string; title: string; description: string; group: AchievementGroup; icon: AchievementIcon;
  current: number; target: number; unlocked: boolean; unlockedAt?: string | null;
};

export const ACHIEVEMENT_ICONS: Record<AchievementIcon, string> = {
  flag: "🏁", magnifier: "🔎", books: "📚", star: "⭐", bulb: "💡", letters: "Æ", calendar: "📅", palette: "🎨"
};

export function achievementsFor(progress: Progress): Achievement[] {
  const result: Achievement[] = [];
  const add = (id: string, group: AchievementGroup, icon: AchievementIcon, title: string, description: string, current: number, target: number) => {
    result.push({ id, group, icon, title, description, current: Math.min(current, target), target, unlocked: current >= target });
  };
  for (const target of [1, 5, 10, 25, 50, 100]) add(`completed-${target}`, "baner", "flag", `${target} ${target === 1 ? "bane" : "baner"}`, `Gennemfør ${target} forskellige baner.`, progress.completed, target);
  for (const target of [10, 50, 100, 250, 500, 1000]) add(`found-${target}`, "ord", "magnifier", `${target} fundne ord`, `Find ${target} ord i alt.`, progress.found, target);
  for (const target of [25, 100, 250, 500]) add(`unique-${target}`, "ord", "books", `${target} forskellige ord`, `Find ${target} forskellige ordformer.`, progress.unique, target);
  for (const [level, name] of [["let", "Let"], ["normal", "Normal"], ["svaer", "Svær"], ["ekspert", "Ekspert"]] as const) {
    for (const target of [1, 10, 50]) add(`${level}-${target}`, "niveauer", "star", `${name} × ${target}`, `Gennemfør ${target} forskellige baner på ${name.toLowerCase()} niveau.`, progress.byLevel[level] ?? 0, target);
  }
  for (const target of [1, 10, 50]) add(`nohint-${target}`, "hjælp", "bulb", `${target} uden hint`, `Gennemfør ${target} baner uden hint.`, progress.withoutHints, target);
  for (const target of [10, 50]) add(`danish-${target}`, "bogstaver", "letters", `Danske bogstaver × ${target}`, `Find ${target} ord med Æ, Ø eller Å.`, progress.danishLetters, target);
  for (const target of [7, 30]) add(`days-${target}`, "dage", "calendar", `${target} spilledage`, `Find ord på ${target} forskellige dage. Dagene behøver ikke ligge i træk.`, progress.activeDays, target);
  for (const target of [1, 3, 5]) add(`categories-${target}`, "kategorier", "palette", `${target} kategorier`, `Gennemfør baner i ${target} forskellige kategorier.`, progress.categories, target);
  add("category-games-10", "kategorier", "palette", "Kategorikender", "Gennemfør 10 forskellige baner i samme kategori.", progress.mostCompletedInCategory, 10);
  add("category-words-100", "kategorier", "palette", "Kategorimester", "Find 100 ord i samme kategori.", progress.mostFoundInCategory, 100);
  return result;
}

// The goals not yet reached that are closest to completion.
export function nextGoals(items: readonly Achievement[], count = 3): Achievement[] {
  return items.filter((item) => !item.unlocked && item.current > 0)
    .sort((a, b) => b.current / b.target - a.current / a.target).slice(0, count);
}
