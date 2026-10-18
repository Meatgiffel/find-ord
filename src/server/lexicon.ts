import { createHash } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import type Database from "better-sqlite3";
import { normalizedWord } from "../shared/words.js";

export const COR_VERSION = "1.5.1.0";
// SHA-256 of the bundled gzip file. The uncompressed source TSV checksum is in the README.
export const COR_SHA256 = "9f845f54acc19da4acdb44e3d690e811f0c595ef7f9d3d7c23cc027e60ad7a46";
const bundledSource = resolve("assets/cor1.5.1.0.tsv.gz");

export type ImportReport = {
  sourceVersion: string;
  sourceRows: number;
  imported: number;
  merged: number;
  excluded: Record<string, number>;
};

// Why a COR row does not become a playable word form. The grid only has A–Z and ÆØÅ,
// so other spellings are excluded with a reason instead of being rewritten.
export function exclusionReason(corId: string | undefined, form: string | undefined, flag: string | undefined): string | null {
  if (!corId?.startsWith("COR.") || !form) return "ugyldig linje";
  if (flag !== "N") return `ikke normeret form (COR-markering ${flag || "mangler"})`;
  if (/\s/.test(form)) return "mellemrum";
  if (form.includes("-")) return "bindestreg";
  if (form.includes(".")) return "forkortelse";
  if (/\d/.test(form)) return "tal";
  const word = normalizedWord(form);
  if (/[^\p{L}]/u.test(word)) return "andet tegn";
  if (!/^[A-ZÆØÅ]+$/.test(word)) return "accent eller fremmed bogstav";
  if (word.length < 3) return "under 3 bogstaver";
  if (word.length > 20) return "over 20 bogstaver";
  return null;
}

// Imports one COR version in a single transaction. A failed checksum, unreadable file or
// interrupted import leaves the previously completed version active and untouched.
export async function importCor(db: Database.Database, source: string, version: string, sha256: string | null): Promise<ImportReport & { alreadyPresent: boolean }> {
  db.exec(`CREATE TABLE IF NOT EXISTS lexicon_import (
    source_version TEXT PRIMARY KEY,
    report TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS lexicon_form (
    source_version TEXT NOT NULL,
    word TEXT NOT NULL,
    length INTEGER NOT NULL,
    PRIMARY KEY (source_version, word)
  );
  CREATE TABLE IF NOT EXISTS lexicon_source (
    source_version TEXT NOT NULL,
    cor_id TEXT NOT NULL,
    word TEXT NOT NULL,
    lemma TEXT NOT NULL,
    form TEXT NOT NULL,
    pos TEXT NOT NULL,
    PRIMARY KEY (source_version, cor_id, form)
  )`);
  const completed = db.prepare("SELECT report FROM lexicon_import WHERE source_version = ?").get(version) as { report: string } | undefined;
  if (completed) return { ...JSON.parse(completed.report) as ImportReport, alreadyPresent: true };
  if (!existsSync(source)) throw new Error(`Mangler ordgrundlag: ${source}`);
  if (sha256) {
    const actual = createHash("sha256").update(readFileSync(source)).digest("hex");
    if (actual !== sha256) throw new Error(`Ordgrundlaget ${source} har en forkert checksum (${actual}).`);
  }

  const sources: Array<[string, string, string, string, string]> = [];
  const forms = new Set<string>();
  const report: ImportReport = { sourceVersion: version, sourceRows: 0, imported: 0, merged: 0, excluded: {} };
  const lines = createInterface({ input: createReadStream(source).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    if (!line) continue;
    report.sourceRows++;
    const [corId, lemma, , pos, form, flag] = line.split("\t");
    const reason = exclusionReason(corId, form, flag);
    if (reason) { report.excluded[reason] = (report.excluded[reason] ?? 0) + 1; continue; }
    const word = normalizedWord(form);
    // The same spelling can come from several lemmas or inflections; keep every source.
    if (forms.has(word)) report.merged++;
    forms.add(word);
    sources.push([corId, word, lemma, form, pos ?? ""]);
  }
  report.imported = forms.size;
  if (!report.imported) throw new Error(`Ordgrundlaget ${source} indeholder ingen spilbare ord.`);

  db.transaction(() => {
    db.prepare("DELETE FROM lexicon_source WHERE source_version = ?").run(version);
    db.prepare("DELETE FROM lexicon_form WHERE source_version = ?").run(version);
    const form = db.prepare("INSERT INTO lexicon_form (source_version, word, length) VALUES (?, ?, ?)");
    for (const word of forms) form.run(version, word, [...word].length);
    const row = db.prepare("INSERT OR IGNORE INTO lexicon_source (source_version, cor_id, word, lemma, form, pos) VALUES (?, ?, ?, ?, ?, ?)");
    for (const [corId, word, lemma, text, pos] of sources) row.run(version, corId, word, lemma, text, pos);
    db.prepare("INSERT INTO lexicon_import (source_version, report) VALUES (?, ?)").run(version, JSON.stringify(report));
    // Tables from the first import format; the bundled file is the source of truth.
    db.exec("DROP TABLE IF EXISTS cor_word; DROP TABLE IF EXISTS cor_import");
  })();
  return { ...report, alreadyPresent: false };
}

export function importBundledCor(db: Database.Database) {
  return importCor(db, bundledSource, COR_VERSION, COR_SHA256);
}

export function formatImportReport(report: ImportReport): string {
  const excluded = Object.entries(report.excluded).sort(([, a], [, b]) => b - a).map(([reason, count]) => `  ${reason}: ${count}`);
  return [`COR ${report.sourceVersion}: ${report.sourceRows} kilderækker.`,
    `Spilbare ordformer: ${report.imported} (${report.merged} rækker lagt sammen med en eksisterende stavemåde).`,
    `Udelukket: ${Object.values(report.excluded).reduce((sum, count) => sum + count, 0)}`, ...excluded].join("\n");
}
