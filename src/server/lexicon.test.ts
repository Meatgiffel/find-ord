import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importCor } from "./lexicon.js";

let root: string;
let db: Database.Database;
const rows = [
  "COR.1.110.01\thund\t\tsb.fk.sg.ubest\thund\tN",
  "COR.1.111.01\thund\t\tsb.fk.sg.best\thunden\tN",
  "COR.2.110.01\tkat\t\tsb.fk.sg.ubest\tKat\tN",
  "COR.3.110.01\tkate\t\tsb.fk.sg.ubest\tkat\tN",
  "COR.4.110.01\tå\t\tsb.fk.sg.ubest\tå\tN",
  "COR.5.110.01\tcafé\t\tsb.fk.sg.ubest\tcafé\tN",
  "COR.6.110.01\tE-mail\t\tsb.fk.sg.ubest\te-mail\tN",
  "COR.7.400.01\tblandt andet\t\tfork\tbl.a.\tN",
  "COR.8.110.01\tbog\t\tsb.fk.sg.ubest.gen\tbogs\tK",
  "COR.9.110.01\tsmuk\t\tadj\tsmukkere\tU",
  "ikke en COR-linje"
];

function write(name: string, lines: string[]): { path: string; sha: string } {
  const path = join(root, name);
  writeFileSync(path, gzipSync(`${lines.join("\n")}\n`));
  return { path, sha: createHash("sha256").update(readFileSync(path)).digest("hex") };
}

describe("COR-import", () => {
  beforeEach(() => { root = mkdtempSync(join(tmpdir(), "find-ord-lexicon-")); db = new Database(":memory:"); });
  afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });

  it("normaliserer, sammenlægger uden at miste kilder og udelukker med begrundelse", async () => {
    const { path, sha } = write("cor.tsv.gz", rows);
    const report = await importCor(db, path, "t1", sha);
    expect(report).toMatchObject({ sourceRows: 11, imported: 3, merged: 1, alreadyPresent: false, excluded: {
      "under 3 bogstaver": 1, "accent eller fremmed bogstav": 1, bindestreg: 1, forkortelse: 1,
      "ikke normeret form (COR-markering K)": 1, "ikke normeret form (COR-markering U)": 1, "ugyldig linje": 1
    } });
    expect(db.prepare("SELECT word, length FROM lexicon_form ORDER BY word").all()).toEqual([
      { word: "HUND", length: 4 }, { word: "HUNDEN", length: 6 }, { word: "KAT", length: 3 }]);
    expect(db.prepare("SELECT cor_id, lemma, form FROM lexicon_source WHERE word = 'KAT' ORDER BY cor_id").all()).toEqual([
      { cor_id: "COR.2.110.01", lemma: "kat", form: "Kat" }, { cor_id: "COR.3.110.01", lemma: "kate", form: "kat" }]);
    const again = await importCor(db, path, "t1", sha);
    expect({ ...again, alreadyPresent: false }).toEqual(report);
    expect(again.alreadyPresent).toBe(true);
    expect((db.prepare("SELECT COUNT(*) AS count FROM lexicon_source").get() as { count: number }).count).toBe(4);
  });

  it("lader den seneste fuldførte version være aktiv ved forkert checksum eller tom fil", async () => {
    const { path, sha } = write("cor.tsv.gz", rows);
    await importCor(db, path, "t1", sha);
    const before = db.prepare("SELECT * FROM lexicon_form").all();
    await expect(importCor(db, path, "t2", "0".repeat(64))).rejects.toThrow("forkert checksum");
    const empty = write("empty.tsv.gz", ["ikke en COR-linje"]);
    await expect(importCor(db, empty.path, "t2", empty.sha)).rejects.toThrow("ingen spilbare ord");
    expect(db.prepare("SELECT * FROM lexicon_form").all()).toEqual(before);
    expect(db.prepare("SELECT source_version FROM lexicon_import").all()).toEqual([{ source_version: "t1" }]);
  });
});
