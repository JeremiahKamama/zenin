// Check frontmatter on all Markdown under docs-site/ (public portal).
// Enforces required fields and a freshness rule for provider/portfolio/notification pages.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const REQUIRED = ["title", "description", "audience", "status", "last_verified"];
const PUBLIC_FRESHNESS_TARGETS = [
  "connect-data-sources",
  "first-portfolio-sync",
  "portfolio-and-connected-accounts",
  "notifications",
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return null;
  const fm = {};
  for (const line of m[1].split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    val = val.replace(/^["']|["']$/g, "");
    fm[key] = val;
  }
  return fm;
}

let failures = 0;
const files = walk(root).filter((f) => !f.includes(join("node_modules")));

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const fm = parseFrontmatter(src);
  const rel = file.replace(root + "/", "");
  if (!fm) {
    console.error(`FAIL (frontmatter missing): ${rel}`);
    failures++;
    continue;
  }
  for (const key of REQUIRED) {
    if (!fm[key]) {
      console.error(`FAIL (missing "${key}"): ${rel}`);
      failures++;
    }
  }
  // Freshness rule: public provider/portfolio/notification pages must carry a recent last_verified.
  if (PUBLIC_FRESHNESS_TARGETS.some((t) => rel.includes(t))) {
    const dv = fm.last_verified || "";
    if (!/^2026-\d{2}-\d{2}$/.test(dv)) {
      console.error(`FAIL (stale/old last_verified "${dv}"): ${rel}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n${failures} frontmatter issue(s) found.`);
  process.exit(1);
}
console.log(`OK: frontmatter valid across ${files.length} public doc file(s).`);
