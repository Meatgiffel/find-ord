import { createReadStream, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { BLOCKED_SEQUENCES, CHILD_POLICY_VERSION } from "../src/shared/safety.js";
import { CATEGORIES, CATEGORY_TAG_VERSION, LEVELS, WORD_LIST_VERSION, adultOnlyReason, availableLevels, categoryWords, normalizedWord, readingLevel, type CategoryId, type LevelId } from "../src/shared/words.js";

// Writes content/ordkilder.tsv (one row per category word with its COR source) and
// docs/ordrapport.md (coverage per category, level and profile). Fails when a listed
// word has no COR source.
const sources = new Map<string, Array<{ id: string; pos: string }>>();
const lines = createInterface({ input: createReadStream("assets/cor1.5.1.0.tsv.gz").pipe(createGunzip()), crlfDelay: Infinity });
for await (const line of lines) {
  const [id, , , pos, form, normalized] = line.split("\t");
  if (normalized !== "N" || !form) continue;
  const word = normalizedWord(form);
  if (!sources.has(word)) sources.set(word, []);
  sources.get(word)!.push({ id, pos });
}

const categories = Object.keys(CATEGORIES) as CategoryId[];
const levels = Object.keys(LEVELS) as LevelId[];
const rows = ["ord\tkategori\tbørn\tlæseniveau\tcor_id\tordklasse"];
const missing: string[] = [];
for (const category of categories) for (const word of categoryWords(category)) {
  const found = sources.get(word) ?? [];
  if (!found.length) missing.push(`${category}/${word}`);
  const reason = adultOnlyReason(category, word);
  rows.push([word, category, reason ? `nej: ${reason}` : "ja", readingLevel(word), found.map((item) => item.id).join(","),
    [...new Set(found.map((item) => item.pos.split(".")[0]))].join(",")].join("\t"));
}
if (missing.length) throw new Error(`Ord uden COR-kilde: ${missing.join(" ")}`);
mkdirSync("content", { recursive: true });
writeFileSync("content/ordkilder.tsv", `${rows.join("\n")}\n`);

const all = new Set(categories.flatMap((category) => categoryWords(category)));
const child = new Set(categories.flatMap((category) => categoryWords(category, true)));
const count = (words: string[], level: LevelId) => words.filter((word) => word.length >= LEVELS[level].min && word.length <= LEVELS[level].max).length;
const lengths = new Map<number, number>();
for (const word of all) lengths.set(word.length, (lengths.get(word.length) ?? 0) + 1);
const report = [
  "# Ordrapport",
  "",
  "Genereret af `npm run report:words`. Ret ikke filen i hånden.",
  "",
  `Ordliste v${WORD_LIST_VERSION} · kategorier v${CATEGORY_TAG_VERSION} · børnepolitik v${CHILD_POLICY_VERSION} · kilde COR 1.5.1.0`,
  "",
  `- Unikke ordformer: ${all.size}, heraf ${child.size} godkendt til børn.`,
  `- Tilknytninger (ord × kategori): ${rows.length - 1}. Alle har en COR-kilde.`,
  `- Blokerede sekvenser i børnegitre: ${BLOCKED_SEQUENCES.length} (listen står i \`src/shared/safety.ts\`).`,
  "",
  "## Dækning pr. kategori og niveau",
  "",
  "Tallene er antal ord med niveauets tilladte længde, voksen / barn. Et niveau tilbydes, når der er mindst så mange ord, som en bane bruger.",
  "",
  `| Kategori | Ord (voksen / barn) | ${levels.map((level) => `${LEVELS[level].name} (${LEVELS[level].words} ord, ${LEVELS[level].min}–${LEVELS[level].max} bogstaver)`).join(" | ")} |`,
  `|---|---|${levels.map(() => "---").join("|")}|`,
  ...categories.map((category) => {
    const adultWords = categoryWords(category), childWords = categoryWords(category, true);
    return `| ${CATEGORIES[category].name} | ${adultWords.length} / ${childWords.length} | ${levels.map((level) => {
      const open = availableLevels(category).includes(level) && availableLevels(category, true).includes(level);
      return `${count(adultWords, level)} / ${count(childWords, level)}${open ? "" : " (lukket)"}`;
    }).join(" | ")} |`;
  }),
  "",
  "## Ordlængder",
  "",
  "| Bogstaver | Ord |",
  "|---|---|",
  ...[...lengths].sort(([a], [b]) => a - b).map(([length, total]) => `| ${length} | ${total} |`),
  "",
  "## Kun for voksne",
  "",
  ...categories.flatMap((category) => categoryWords(category).filter((word) => adultOnlyReason(category, word))
    .map((word) => `- ${word} (${CATEGORIES[category].name}): ${adultOnlyReason(category, word)}`)),
  ""
];
writeFileSync("docs/ordrapport.md", report.join("\n"));
console.log(`${all.size} ord, ${child.size} børnegodkendt. Skrev content/ordkilder.tsv og docs/ordrapport.md.`);
