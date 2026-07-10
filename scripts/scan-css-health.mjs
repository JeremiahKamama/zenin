#!/usr/bin/env node
/**
 * scan-css-health.mjs — Phase 6.2 scanner
 *
 *  1. Saturated‑color audit (brand.md deprecations)
 *  2. Unused‑rule detection in styles.css (by full selector tail)
 *  3. Baseline size / line / selector counts
 *
 * Usage
 *   node scripts/scan-css-health.mjs
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const CSS_FILE = path.join(ROOT, "frontend/src/styles.css");
const SRC = path.join(ROOT, "frontend/src");

/* ── helpers ──────────────────────────────────────────────────────────── */

function walkDir(dir, exts) {
  const results = [];
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith(".") && !entry.name.startsWith("node_modules") && !entry.name.startsWith("dist")) {
        results.push(...walkDir(p, exts));
      } else if (entry.isFile() && exts.some(e => entry.name.endsWith(e))) {
        results.push(p);
      }
    }
  } catch { /* ignore */ }
  return results;
}

const KNOWN_STANDALONE = new Set([
  "body", "html", "svg", "path", "a", "button", "input", "select", "textarea",
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "span", "div", "ul", "ol", "li",
  "table", "thead", "tbody", "tr", "th", "td", "img", "figure", "figcaption",
  "section", "article", "nav", "aside", "header", "footer", "main",
  "form", "label", "fieldset", "legend", "blockquote", "pre", "code",
  "dl", "dt", "dd", "hr", "br", "em", "strong", "small", "sub", "sup",
  "::before", "::after", "::placeholder", "::-webkit-scrollbar",
  "::-webkit-scrollbar-track", "::-webkit-scrollbar-thumb",
  ":root", ":focus-visible", ":hover", ":active", ":disabled", ":checked",
  ":first-child", ":last-child", ":nth-child", ":nth-of-type",
  ":not", ":where", ":is", ":has",
]);

function isHtmlTag(s) { return KNOWN_STANDALONE.has(s); }

/**
 * Extract the "tail" of a selector — the part after the last space/combinator.
 * Remove pseudo-classes, attribute selectors, before/after.
 * If the tail starts with `[` or `:` or is a bare tag, walk left.
 */
function selectorTail(sel) {
  // split on combinators
  const parts = sel.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] || "";
  // strip pseudos and attrs
  let clean = last.replace(/:[\w-]+(\([^)]*\))?/g, "").replace(/\[[\w-]+(="[^"]*")?\]/g, "");
  // strip leading & and .
  const identifiers = clean.match(/[.#][\w-]+/g);
  if (identifiers) return identifiers.join("");  // e.g. ".foo.bar"
  if (isHtmlTag(clean)) return clean;
  return clean;
}

/**
 * Search all files for a substring pattern.
 */
function searchAllFiles(pattern, files) {
  for (const f of files) {
    const content = readFileSync(f, "utf-8");
    if (content.includes(pattern)) return path.relative(ROOT, f);
  }
  return null;
}

/**
 * Quick CSS parser that extracts non‑keyframe, non‑media selectors.
 */
function extractSelectors(cssText) {
  const selectors = [];
  // merge all lines into one string — handle multi-line selectors
  const text = cssText
    .replace(/\/\*[\s\S]*?\*\//g, "")  // strip comments
    .replace(/@media[^{]+{/g, "")       // strip @media blocks
    .replace(/@keyframes\s+\w+\s*{/g, "")
    .replace(/@font-face\s*{/g, "")
    .replace(/@supports[^{]+{/g, "")
    .split("}")
    .filter(Boolean);

  for (let i = 0; i < text.length; i++) {
    const block = text[i].trim();
    if (!block) continue;
    const braceIdx = block.indexOf("{");
    if (braceIdx === -1) continue;
    const selector = block.slice(0, braceIdx).replace(/\n/g, " ").replace(/\s+/g, " ").trim();
    if (selector && !selector.startsWith("@") && !selector.startsWith("}")) {
      selectors.push({ selector, line: 0 });
    }
  }
  return selectors;
}

/* ── 1. Saturated‑color audit (brand.md §Deprecated Colors) ─────── */
function auditSaturated(srcFiles) {
  // Skip comments — only flag actual value usage
  const SAT_HEX = /#00d4ff|#38bdf8|#22d3ee|#a855f7|#a78bfa|#7dd3fc|#4f7cff/gi;
  const DEP_TOKENS = /gradient-brand|--color-brand-|--color-info\b|color-data-sky|color-data-teal|color-data-purple/g;
  const GLOW = /\bglow\b(?!.*\bremoved\b|.*\bRemoved\b)/gi;  // skip "removed per Brand v2"

  const hits = [];

  for (const f of srcFiles) {
    const content = readFileSync(f, "utf-8");
    const rel = path.relative(ROOT, f);
    // skip comments
    const noComments = content.replace(/\/\*[\s\S]*?\*\//g, "");

    let m;
    SAT_HEX.lastIndex = 0;
    while ((m = SAT_HEX.exec(noComments)) !== null) {
      hits.push({ file: rel, match: m[0], kind: "hex", idx: m.index });
    }
    DEP_TOKENS.lastIndex = 0;
    while ((m = DEP_TOKENS.exec(noComments)) !== null) {
      hits.push({ file: rel, match: m[0], kind: "token", idx: m.index });
    }
    GLOW.lastIndex = 0;
    while ((m = GLOW.exec(noComments)) !== null) {
      hits.push({ file: rel, match: m[0], kind: "glow", idx: m.index });
    }
  }
  return hits;
}

/* ── 3. Main ────────────────────────────────────────────────────────── */

function main() {
  console.log("═══ CSS Health Scan ═══\n");

  const css = readFileSync(CSS_FILE, "utf-8");
  const cssLines = css.split("\n").length;
  const cssBytes = Buffer.byteLength(css, "utf-8");
  console.log(`styles.css: ${cssLines} lines, ${(cssBytes / 1024).toFixed(1)} KB\n`);

  const allFiles = walkDir(SRC, [".jsx", ".js", ".tsx", ".ts", ".html", ".css"]);
  const refFiles = allFiles.filter(f => !f.endsWith("styles.css"));  // exclude self from ref search
  console.log(`Source files: ${allFiles.length} (${refFiles.length} for refs)\n`);

  // ── 1. Saturated colors ──
  console.log("── 1. Saturated‑color audit ──");
  const saturatedHits = auditSaturated(allFiles);
  if (saturatedHits.length === 0) {
    console.log("  ✅ Clean — no brand.md violations found\n");
  } else {
    for (const h of saturatedHits) {
      console.log(`  ${h.file}  ${h.match}  (${h.kind})`);
    }
    console.log(`  ${saturatedHits.length} violation(s)\n`);
  }

  // ── 2. Unused CSS ──
  console.log("── 2. Unused‑rule scan (styles.css) ──");
  const selectors = extractSelectors(css);
  console.log(`  Total selectors: ${selectors.length}`);

  const unused = [];
  for (const { selector, line } of selectors) {
    // Split comma-separated selectors and check each
    const parts = selector.split(",").map(s => s.trim()).filter(Boolean);
    let anyFound = false;
    for (const part of parts) {
      const tail = selectorTail(part);
      if (!tail) continue;
      if (tail.startsWith(":") || isHtmlTag(tail)) continue;
      const searchPattern = tail.replace(/^[.#]/, "");
      const found = searchAllFiles(searchPattern, refFiles);
      if (found) { anyFound = true; break; }
    }
    if (!anyFound) {
      unused.push({ selector, line, tail: selector });
    }
  }

  // filter false‑positives: rules matching build‑time only tokens
  const rootHtml = readFileSync(path.join(ROOT, "frontend/index.html"), "utf-8");
  const publicIndex = path.join(ROOT, "frontend/src/public.css");
  const publicCss = readFileSync(publicIndex, "utf-8");
  const extraRefs = [rootHtml, publicCss];

  const trulyUnused = [];
  for (const u of unused) {
    let stillUnused = true;
    const parts = u.selector.split(",").map(s => s.trim());
    for (const part of parts) {
      const cleaned = part.replace(/:[\w-]+(\([^)]*\))?/g, "").replace(/\[[\w-]+(="[^"]*")?\]/g, "");
      const ids = cleaned.match(/[.#][\w-]+/g) || [cleaned];
      for (const id of ids) {
        const bare = id.replace(/^[.#]/, "");
        for (const ref of extraRefs) {
          if (ref.includes(bare)) { stillUnused = false; break; }
        }
        if (!stillUnused) break;
      }
      if (!stillUnused) break;
    }
    if (stillUnused) trulyUnused.push(u);
  }

  if (trulyUnused.length === 0) {
    console.log("  ✅ No clearly unused rules found.\n");
  } else {
    console.log(`  ${trulyUnused.length} potentially unused rule(s):\n`);
    for (const u of trulyUnused) {
      console.log(`  Line ${u.line}: ${u.selector}`);
    }
    console.log();
  }

  // ── 3. Baseline ──
  console.log("── 3. Baseline ──");
  console.log(`  Lines:        ${cssLines}`);
  console.log(`  Size:         ${(cssBytes / 1024).toFixed(1)} KB`);
  console.log(`  Selectors:    ${selectors.length}`);
  console.log(`  Unused:       ${trulyUnused.length}`);
  console.log(`  Saturations:  ${saturatedHits.length}`);
  console.log(`  Source files: ${allFiles.length}`);

  console.log(`\n── Done ──`);
}

main();
