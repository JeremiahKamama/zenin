import { pathToFileURL } from "url";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(resolve(__dirname, "indv2-bundle.cjs")).href);
const { withData } = mod.run();
// extract related grid block
const m = withData.match(/imv2-related-grid[\s\S]*?<\/div>\s*<\/section>/);
console.log("RELATED BLOCK:\n", m ? m[0].slice(0, 1200) : "NOT FOUND");
// list all imv2-related-label texts
const labels = [...withData.matchAll(/imv2-related-label">([^<]+)</g)].map(x=>x[1]);
console.log("RELATED LABELS:", JSON.stringify(labels));
