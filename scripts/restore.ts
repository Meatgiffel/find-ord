import { resolve } from "node:path";
import { restoreBackup } from "../src/server/backup.js";

const source = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!source) throw new Error("Angiv backupmappe: npm run restore -- <backupmappe> [--replace]");
const dataFile = resolve(process.env.DATA_FILE || "data/find-ord.sqlite");
const manifest = restoreBackup(resolve(source), dataFile, { replace: process.argv.includes("--replace") });
console.log(`Gendannet backup fra ${manifest.createdAt}: ${manifest.counts.users} konti, ${manifest.counts.games} baner, ${manifest.counts.events} hændelser. Start servicen igen.`);
