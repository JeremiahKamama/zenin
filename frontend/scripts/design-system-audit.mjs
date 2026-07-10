#!/usr/bin/env node
/**
 * design-system-audit.mjs — Phase 8 engineering guardrail.
 *
 * Measures the design-system Quality Metrics and enforces them as a
 * CI gate. Two layers:
 *
 *   1. REGRESSION GATE (hard): the total count of hardcoded colors / font
 *      sizes in component-authored code must NEVER exceed the committed
 *      baseline (`scripts/.design-baseline.json`). New features may not add
 *      drift; the existing legacy backlog is frozen but not allowed to grow.
 *      Any NEW file that introduces violations also fails immediately.
 *
 *   2. NEW-DRIFT GUARD (hard): a file not present in the baseline that
 *      introduces hardcoded color/type violations fails outright, even if
 *      the global total stayed flat.
 *
 * This is the pragmatic, achievable form of "CI fails on hardcoded colors"
 * from the plan: it stops drift from accumulating while the legacy
 * src/styles.css migration is completed separately.
 *
 * Run locally:
 *   node scripts/design-system-audit.mjs            # check against baseline
 *   node scripts/design-system-audit.mjs --write    # (re)store baseline
 *
 * Exit codes: 0 = within baseline, 1 = regression / new drift.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const SRC = join(process.cwd(), "src");
const BASELINE_PATH = join(process.cwd(), "scripts", ".design-baseline.json");

// Files where raw color literals are expected/allowed (token definitions and
// the legacy stylesheet, which are migrated out-of-band).
const ALLOWED_COLOR_FILES = new Set(["styles.css", "public.css", "index.css"]);

const HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RGB = /\brgba?\(\s*\d{1,3}\s*,/g;
const VAR_TOKEN = /var\(\s*--[\w-]+\s*\)/g;
const FONT_SIZE_PX = /(?:fontSize\s*:\s*['"]?\d+(?:\.\d+)?px)|(?:text-\[(\d+)px\])/g;

const SOURCE_EXT = new Set([".js", ".jsx", ".ts", ".tsx", ".css"]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (SOURCE_EXT.has(extname(name))) out.push(full);
  }
  return out;
}

function readIfExists(p) {
  try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function measure() {
  const files = walk(SRC);
  let colors = 0;
  let types = 0;
  const perFile = {};
  for (const file of files) {
    const rel = file.replace(SRC + "/", "");
    const base = rel.split("/").pop();
    if (ALLOWED_COLOR_FILES.has(base) && rel.split("/").length === 1) continue;
    const src = readIfExists(file);
    const stripped = src.replace(VAR_TOKEN, "");
    const c = (stripped.match(HEX) || []).length + (stripped.match(RGB) || []).length;
    const t = (src.match(FONT_SIZE_PX) || []).length;
    if (c > 0 || t > 0) {
      perFile[rel] = { colors: c, types: t };
      colors += c;
      types += t;
    }
  }
  return { totalColors: colors, totalTypes: types, perFile };
}

const args = process.argv.slice(2);
const writeMode = args.includes("--write");

if (writeMode) {
  const m = measure();
  writeFileSync(BASELINE_PATH, JSON.stringify(m, null, 2) + "\n");
  console.log(`Baseline written: ${m.totalColors} colors, ${m.totalTypes} font-sizes across ${Object.keys(m.perFile).length} files.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.error("No baseline found. Run `node scripts/design-system-audit.mjs --write` once to establish it.");
  process.exit(0); // do not fail CI on first run without a baseline
}

const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const current = measure();

console.log("── Zenin Design-System Audit ──────────────────────────────");
console.log(`Hardcoded colors : ${current.totalColors}  (baseline ${baseline.totalColors})`);
console.log(`Hardcoded types  : ${current.totalTypes}  (baseline ${baseline.totalTypes})`);

let regressed = false;
const problems = [];

// 1. Global regression.
if (current.totalColors > baseline.totalColors) {
  regressed = true;
  problems.push(`Color literals increased ${baseline.totalColors} → ${current.totalColors}`);
}
if (current.totalTypes > baseline.totalTypes) {
  regressed = true;
  problems.push(`Font-size literals increased ${baseline.totalTypes} → ${current.totalTypes}`);
}

// 2. New-file drift: a file absent from baseline that now has violations.
for (const [file, { colors, types }] of Object.entries(current.perFile)) {
  if (!baseline.perFile[file] && (colors > 0 || types > 0)) {
    regressed = true;
    problems.push(`NEW file with drift: ${file} (${colors} color, ${types} type)`);
  }
  // 3. Per-file regression beyond baseline.
  const b = baseline.perFile[file];
  if (b) {
    if (colors > b.colors) { regressed = true; problems.push(`${file}: colors ${b.colors} → ${colors}`); }
    if (types > b.types) { regressed = true; problems.push(`${file}: types ${b.types} → ${types}`); }
  }
}

console.log("───────────────────────────────────────────────────────────");
if (regressed) {
  console.error("AUDIT FAILED — design-system drift detected:");
  for (const p of problems) console.error("  ✗ " + p);
  console.error("Fix the new hardcoded values (use var(--tokens) / shared components) or, if the baseline is stale, run with --write after review.");
  process.exit(1);
}
console.log("AUDIT PASSED — no new design-system drift.");
process.exit(0);
