import { resolve } from "node:path";
import { createBackup } from "../src/server/backup.js";

const target = process.argv[2];
if (!target) throw new Error("Angiv backupmappe: npm run backup -- <mappe>");
const dataFile = resolve(process.env.DATA_FILE || "data/find-ord.sqlite");
const folder = await createBackup(dataFile, target);
console.log(`Backup gemt i ${folder}`);
