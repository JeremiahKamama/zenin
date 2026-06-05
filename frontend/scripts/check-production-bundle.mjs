import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const distRoot = path.join(projectRoot, "dist");

const TEXT_EXTENSIONS = new Set([".html", ".js", ".css", ".json"]);
const FORBIDDEN_CONTENT = [
  { label: "loopback URL", pattern: /http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i },
  { label: "loopback websocket URL", pattern: /ws:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?/i },
  { label: "loopback host literal", pattern: /(?:localhost|127\.0\.0\.1|\[::1\])(?=[:/])/i }
];
const FORBIDDEN_FILENAME = /supabaseAuth/i;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else files.push(fullPath);
  }
  return files;
}

function formatRelative(filePath) {
  return path.relative(projectRoot, filePath).split(path.sep).join("/");
}

let files;
try {
  files = await walk(distRoot);
} catch (error) {
  console.error(`[bundle-check] Could not read ${formatRelative(distRoot)}. Run the production build first.`);
  process.exit(1);
}

const failures = [];
for (const filePath of files) {
  const relative = formatRelative(filePath);
  if (FORBIDDEN_FILENAME.test(path.basename(filePath))) {
    failures.push(`${relative}: stale Supabase auth chunk name`);
  }
  if (!TEXT_EXTENSIONS.has(path.extname(filePath))) continue;
  const content = await fs.readFile(filePath, "utf8");
  for (const rule of FORBIDDEN_CONTENT) {
    if (rule.pattern.test(content)) {
      failures.push(`${relative}: ${rule.label}`);
    }
  }
}

if (failures.length) {
  console.error("[bundle-check] Production bundle contains forbidden local/stale auth artifacts:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("[bundle-check] Production bundle passed local fallback and stale auth checks.");
