import { importBundledCor } from "../src/server/lexicon.js";

const result = await importBundledCor();
console.log(`COR 1.5.1.0: ${result.imported} spilbare ordformer i lokal database${result.alreadyPresent ? " (allerede indlæst)" : ""}.`);
