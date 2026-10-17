import { createReadStream, existsSync } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { resolve } from "node:path";
import { db } from "./database.js";
import { normalizedWord } from "../shared/words.js";

export const COR_VERSION = "1.5.1.0";
const bundledSource = resolve("assets/cor1.5.1.0.tsv.gz");

export async function importBundledCor(): Promise<{ imported: number; alreadyPresent: boolean }> {
  db.exec(`CREATE TABLE IF NOT EXISTS cor_word (
    word TEXT PRIMARY KEY,
    lemma TEXT NOT NULL,
    cor_id TEXT NOT NULL,
    source_version TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS cor_import (
    source_version TEXT PRIMARY KEY,
    imported_count INTEGER NOT NULL,
    completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const completed = db.prepare("SELECT imported_count AS count FROM cor_import WHERE source_version = ?").get(COR_VERSION) as { count: number } | undefined;
  if (completed) return { imported: completed.count, alreadyPresent: true };
  if (!existsSync(bundledSource)) throw new Error(`Mangler ordgrundlag: ${bundledSource}`);
  // A previous process may have stopped after committing a batch. Only the final marker makes an import active.
  db.prepare("DELETE FROM cor_word WHERE source_version = ?").run(COR_VERSION);
  const insert = db.prepare("INSERT OR IGNORE INTO cor_word (word, lemma, cor_id, source_version) VALUES (?, ?, ?, ?)");
  const batch: Array<[string, string, string]> = [];
  const commit = db.transaction((rows: Array<[string, string, string]>) => {
    for (const [word, lemma, corId] of rows) insert.run(word, lemma, corId, COR_VERSION);
  });
  const lines = createInterface({ input: createReadStream(bundledSource).pipe(createGunzip()), crlfDelay: Infinity });
  for await (const line of lines) {
    const [corId, lemma, , , form, normalized] = line.split("\t");
    if (normalized !== "N" || !corId?.startsWith("COR.") || !form) continue;
    const word = normalizedWord(form);
    if (word.length < 3 || word.length > 20 || !/^[A-ZÆØÅ]+$/.test(word)) continue;
    batch.push([word, lemma, corId]);
    if (batch.length >= 5000) { commit(batch); batch.length = 0; }
  }
  if (batch.length) commit(batch);
  const imported = (db.prepare("SELECT COUNT(*) AS count FROM cor_word WHERE source_version = ?").get(COR_VERSION) as { count: number }).count;
  db.prepare("INSERT INTO cor_import (source_version, imported_count) VALUES (?, ?)").run(COR_VERSION, imported);
  return { imported, alreadyPresent: false };
}
