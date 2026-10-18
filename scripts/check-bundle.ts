import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";

// Bundle budget for the PWA (gzip). The word lists ship in the app; the COR dictionary does not.
const BUDGET = { js: 120_000, css: 15_000 };
const sizes = { js: 0, css: 0 };
for (const file of readdirSync("build/assets")) {
  const type = file.endsWith(".js") ? "js" : file.endsWith(".css") ? "css" : null;
  if (type) sizes[type] += gzipSync(readFileSync(join("build/assets", file)), { level: 9 }).length;
}
console.log(`JavaScript ${sizes.js} B, CSS ${sizes.css} B (gzip). Budget: ${BUDGET.js} B og ${BUDGET.css} B.`);
if (sizes.js > BUDGET.js || sizes.css > BUDGET.css) { console.error("Bundlebudgettet er overskredet."); process.exitCode = 1; }
