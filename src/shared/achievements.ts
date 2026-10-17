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

export type Achievement = { id: string; title: string; description: string; current: number; target: number; unlocked: boolean };

export function achievementsFor(progress: Progress): Achievement[] {
  const result: Achievement[] = [];
  const add = (id: string, title: string, description: string, current: number, target: number) => {
    result.push({ id, title, description, current: Math.min(current, target), target, unlocked: current >= target });
  };
  for (const target of [1, 5, 10, 25, 50, 100]) add(`completed-${target}`, `${target} ${target === 1 ? "bane" : "baner"}`, `Gennemfør ${target} forskellige baner.`, progress.completed, target);
  for (const target of [10, 50, 100, 250, 500, 1000]) add(`found-${target}`, `${target} fundne ord`, `Find ${target} ord i alt.`, progress.found, target);
  for (const target of [25, 100, 250, 500]) add(`unique-${target}`, `${target} forskellige ord`, `Find ${target} forskellige ordformer.`, progress.unique, target);
  for (const [level, name] of [["let", "Let"], ["normal", "Normal"], ["svaer", "Svær"], ["ekspert", "Ekspert"]] as const) {
    for (const target of [1, 10, 50]) add(`${level}-${target}`, `${name} × ${target}`, `Gennemfør ${target} forskellige baner på ${name.toLowerCase()} niveau.`, progress.byLevel[level] ?? 0, target);
  }
  for (const target of [1, 10, 50]) add(`nohint-${target}`, `${target} uden hint`, `Gennemfør ${target} baner uden hint.`, progress.withoutHints, target);
  for (const target of [10, 50]) add(`danish-${target}`, `Danske bogstaver × ${target}`, `Find ${target} ord med Æ, Ø eller Å.`, progress.danishLetters, target);
  for (const target of [7, 30]) add(`days-${target}`, `${target} spilledage`, `Find ord på ${target} forskellige dage. Dagene behøver ikke ligge i træk.`, progress.activeDays, target);
  for (const target of [1, 3, 5]) add(`categories-${target}`, `${target} kategorier`, `Gennemfør baner i ${target} forskellige kategorier.`, progress.categories, target);
  add("category-games-10", "Kategorikender", "Gennemfør 10 forskellige baner i samme kategori.", progress.mostCompletedInCategory, 10);
  add("category-words-100", "Kategorimester", "Find 100 ord i samme kategori.", progress.mostFoundInCategory, 100);
  return result;
}
