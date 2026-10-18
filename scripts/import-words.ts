import { db } from "../src/server/database.js";
import { formatImportReport, importBundledCor } from "../src/server/lexicon.js";

const result = await importBundledCor(db);
console.log(formatImportReport(result));
if (result.alreadyPresent) console.log("Versionen var allerede indlæst; rapporten er fra den første import.");
