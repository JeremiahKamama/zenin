// Link + boundary check for the public docs-site.
// 1) Every internal Markdown link must resolve to a real file (no broken links).
// 2) Public docs must never link into docs/internal/ (internal-only content).
//    (The public build also excludes internal sources via config + buildEnd guard.)
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

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

const files = walk(root).filter((f) => !f.includes(join("node_modules")));
let failures = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  const rel = file.replace(root + "/", "");
  const links = [...src.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((m) => m[1]);

  for (const link of links) {
    // Skip external, anchors, and pure hashes.
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    // Strip hash/query.
    const target = link.split("#")[0].split("?")[0];
    if (!target) continue;

    // Boundary rule: public docs must not reference internal-only content.
    if (target.includes("docs/internal") || target.includes("/internal/")) {
      console.error(`FAIL (public doc links to internal content): ${rel} -> ${link}`);
      failures++;
      continue;
    }

    // Resolve relative to the current file's directory.
    const base = target.startsWith("/")
      ? join(root, target)
      : resolve(dirname(file), target);
    const candidates = [base, base + ".md", join(base, "index.md")];
    if (!candidates.some((c) => existsSync(c))) {
      console.error(`FAIL (broken link): ${rel} -> ${link}`);
      failures++;
    }
  }
}

if (failures) {
  console.error(`\n${failures} link/boundary issue(s) found.`);
  process.exit(1);
}
console.log(`OK: ${files.length} public doc file(s) checked, no broken links or internal references.`);
