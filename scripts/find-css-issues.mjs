#!/usr/bin/env node
/**
 * find-css-issues.mjs
 *
 * Scans a hand-rolled CSS file (e.g. frontend/src/styles.css) for two classes
 * of problems that the Brand System v2 migration-overview "Audit Greps" miss:
 *
 *   1. SATURATED COLOR LITERALS — hex / rgb / rgba / hsl values that carry hue
 *      (i.e. are not pure gray and not one of the three approved semantic
 *      colors green/red/amber). The canonical greps only check a fixed set of
 *      legacy hex values and token NAMES, so raw saturated rgba() slips through.
 *
 *   2. UNREFERENCED RULES — selectors whose class/id tokens never appear in the
 *      JSX/HTML source, so the rule is dead and can be deleted during the
 *      Phase 6.2 styles.css drain.
 *
 * Usage:
 *   node scripts/find-css-issues.mjs <styles.css> <srcDir> [--json]
 *
 * Output (default): human-readable grouped reports + summary counts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const cssPath = process.argv[2] || path.join(repoRoot, "frontend", "src", "styles.css");
const srcDir = process.argv[3] || path.join(repoRoot, "frontend", "src");
const asJson = process.argv.includes("--json");

// ---- Approved Brand v2 semantic colors (allowed saturated hues) ----------
// Green = profit/positive, Red = loss/danger, Amber = warning/pending.
// Includes both dark- and light-theme shades so the scanner doesn't flag them.
const SEMANTIC = new Set([
  // greens
  "#10b981", "#34d399", "#22c55e", "#16a34a", "#059669", "#047857", "#15803d", "#15803d",
  // reds
  "#ef4444", "#f87171", "#dc2626", "#b91c1c", "#f87171",
  // ambers
  "#f59e0b", "#fbbf24", "#f97316", "#b45309", "#d97706",
  // raw fn forms
  "rgb(16, 185, 129", "rgb(22, 163, 74", "rgb(5, 150, 105", "rgba(16, 185, 129",
  "rgb(239, 68, 68", "rgba(239, 68, 68",
  "rgb(245, 158, 11", "rgba(245, 158, 11",
  "rgb(34, 197, 94", "rgba(34, 197, 94",   // emerald-500 (success)
  "rgb(248, 113, 113", "rgba(248, 113, 113", // red-400 (danger)
  "rgb(245, 181, 68", "rgba(245, 181, 68",  // amber-400 (warning)
  "rgb(240, 107, 99", "rgba(240, 107, 99",  // red-ish (danger)
  "rgb(127, 29, 29", "rgba(127, 29, 29",    // red-900 soft (danger bg)
  "rgb(34, 197, 94", "rgba(34, 197, 94",
]);

// Tokens that are white-alpha or pure black/white (monochrome, always OK)
function isMonochromeOrApproved(raw) {
  const r = raw.toLowerCase().replace(/\s+/g, "");
  // semantic exact matches
  for (const s of SEMANTIC) if (r.includes(s.toLowerCase().replace(/\s+/g, ""))) return true;
  // hex
  let m = r.match(/^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/);
  if (m) {
    const h = m[1];
    const full = h.length === 3 || h.length === 4
      ? h.split("").map((c) => c + c).join("")
      : h;
    const rr = parseInt(full.slice(0, 2), 16);
    const gg = parseInt(full.slice(2, 4), 16);
    const bb = parseInt(full.slice(4, 6), 16);
    // ignore alpha channel for hue check
    return rr === gg && gg === bb; // pure gray
  }
  // rgb(a)
  m = r.match(/rgba?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((p) => parseFloat(p));
    const [cr, cg, cb] = parts;
    // white or black (any alpha) is monochrome
    if ((cr === 255 && cg === 255 && cb === 255) || (cr === 0 && cg === 0 && cb === 0)) return true;
    // near-white / near-black tolerance
    const near = (v) => v >= 248 || v <= 8;
    if (near(cr) && near(cg) && near(cb)) return true;
    // equal channels => gray
    if (Math.abs(cr - cg) < 6 && Math.abs(cg - cb) < 6) return true;
    return false; // has hue -> saturated
  }
  // hsl(a)
  m = r.match(/hsla?\(([^)]+)\)/);
  if (m) {
    const parts = m[1].split(",").map((p) => p.trim());
    const hue = parseFloat(parts[0]);
    const sat = parseFloat(parts[1]);
    if (sat < 8) return true; // effectively gray
    return false;
  }
  return true; // not a color we recognise; don't flag
}

// ---- 1. Parse CSS into rules ---------------------------------------------
const css = fs.readFileSync(cssPath, "utf8");
// Strip comments
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
// Very small tokenizer: split on balanced braces is hard; use regex for
// top-level rules (selectors { ... }).
const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
const rules = [];
let mm;
while ((mm = ruleRe.exec(cssNoComments)) !== null) {
  const selector = mm[1].trim();
  const body = mm[2];
  if (!selector || selector.startsWith("@")) continue; // skip at-rules/keyframes bodies
  rules.push({ selector, body, line: css.slice(0, mm.index).split("\n").length });
}

// ---- Saturated color scan -------------------------------------------------
const saturated = [];
for (const rule of rules) {
  const colorRe = /(#(?:[0-9a-f]{3,8})\b|rgba?\([^)]*\)|hsla?\([^)]*\))/gi;
  let cm;
  while ((cm = colorRe.exec(rule.body)) !== null) {
    const raw = cm[0];
    if (!isMonochromeOrApproved(raw)) {
      saturated.push({ line: rule.line, selector: rule.selector.slice(0, 80), color: raw });
    }
  }
}

// ---- 2. Unreferenced rule scan -------------------------------------------
// Collect class/id tokens from selectors.
function selectorTokens(sel) {
  const tokens = new Set();
  // classes
  for (const m of sel.matchAll(/\.(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) tokens.add(m[1]);
  // ids
  for (const m of sel.matchAll(/#(-?[_a-zA-Z][_a-zA-Z0-9-]*)/g)) tokens.add(m[1]);
  return [...tokens];
}

// Build a big lowercase blob of all JSX/HTML source for substring checks.
function walk(dir, acc) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(p, acc);
    } else if (/\.(jsx?|tsx?|html|svg)$/.test(entry.name)) {
      acc.push(p);
    }
  }
}
const srcFiles = [];
walk(srcDir, srcFiles);
// also include public + index.html for completeness
const publicDir = path.join(repoRoot, "frontend", "public");
if (fs.existsSync(publicDir)) walk(publicDir, srcFiles);
const indexHtml = path.join(repoRoot, "frontend", "index.html");
if (fs.existsSync(indexHtml)) srcFiles.push(indexHtml);

const haystack = srcFiles
  .map((f) => {
    try { return fs.readFileSync(f, "utf8"); } catch { return ""; }
  })
  .join("\n")
  .toLowerCase();

const unreferenced = [];
for (const rule of rules) {
  const tokens = selectorTokens(rule.selector);
  if (tokens.length === 0) continue; // pseudo/element-only selectors
  // Rule is "referenced" if ANY token appears in source.
  const referenced = tokens.some((t) => haystack.includes(t.toLowerCase()));
  if (!referenced) {
    unreferenced.push({ line: rule.line, selector: rule.selector.slice(0, 100), tokens });
  }
}

// ---- Report ---------------------------------------------------------------
const report = {
  cssPath,
  totalRules: rules.length,
  saturatedCount: saturated.length,
  unreferencedCount: unreferenced.length,
  saturated: saturated.slice(0, 200),
  unreferenced: unreferenced.slice(0, 400),
};
if (asJson) {
  process.stdout.write(JSON.stringify(report, null, 2));
} else {
  process.stdout.write(`\n=== CSS ISSUE SCAN: ${path.basename(cssPath)} ===\n`);
  process.stdout.write(`Total rules parsed: ${rules.length}\n`);
  process.stdout.write(`Saturated color literals (non-gray, non-semantic): ${saturated.length}\n`);
  process.stdout.write(`Unreferenced rules (candidate deletions): ${unreferenced.length}\n\n`);
  if (saturated.length) {
    process.stdout.write("--- SATURATED COLORS (sample) ---\n");
    for (const s of saturated.slice(0, 60)) {
      process.stdout.write(`  L${s.line}: ${s.color}  @ ${s.selector}\n`);
    }
  }
  if (unreferenced.length) {
    process.stdout.write("\n--- UNREFERENCED RULES (sample) ---\n");
    for (const u of unreferenced.slice(0, 80)) {
      process.stdout.write(`  L${u.line}: ${u.selector}\n`);
    }
  }
}
