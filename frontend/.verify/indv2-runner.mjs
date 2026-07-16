import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { pathToFileURL } from "url";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dom = new JSDOM("<!doctype html><html><body></body></html>", { url: "http://localhost/" });
globalThis.window = dom.window; globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);

const OUT = resolve(__dirname, "indv2-bundle.cjs");
await build({
  entryPoints: [resolve(__dirname, "indv2-entry.jsx")],
  bundle: true, platform: "node", format: "cjs", outfile: OUT, jsx: "automatic",
  loader: { ".js": "jsx", ".jsx": "jsx" }, logLevel: "error",
  plugins: [{ name: "lwc-stub", setup(b){ b.onResolve({ filter: /^lightweight-charts$/ }, () => ({ path: resolve(__dirname, "lwc-stub.js") })); } }],
});
const mod = await import(pathToFileURL(OUT).href);
const { withData, noData } = mod.run();

const checks = [
  ["V2 shell class", withData.includes("indicator-v2")],
  ["Two-column workspace", withData.includes("imv2-workspace")],
  ["Chart column", withData.includes("imv2-chart-col")],
  ["Right intelligence rail", withData.includes("imv2-rail")],
  ["Hero big number 143.8", withData.includes("143.8")],
  ["Transmission chain", withData.includes("imv2-chain")],
  ["Related indicators grid", withData.includes("imv2-related-grid")],
  ["Cross-asset table", withData.includes("imv2-cross-table")],
  ["Scenario laboratory", withData.includes("Scenario Laboratory")],
  ["Release timeline", withData.includes("imv2-timeline")],
  ["Footer actions", withData.includes("imv2-footer")],
  ["Source=FRED", withData.includes("FRED")],
  ["Confidence 96%", withData.includes("96%")],
  ["Inflation chain node", withData.includes("Inflation")],
  ["Related PPI/Core CPI", withData.includes("PPI") || withData.includes("Core CPI")],
];
const emptyChecks = [
  ["No-series honest empty", noData.includes("No historical series returned from FRED")],
  ["No transmission path mapped", noData.includes("No transmission path mapped")],
];
let pass = 0; const fail = [];
for (const [n, ok] of [...checks, ...emptyChecks]) { if (ok) pass++; else fail.push(n); }
console.log(JSON.stringify({ pass, total: checks.length + emptyChecks.length, fail, withDataLen: withData.length, noDataLen: noData.length }, null, 2));
