import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(__dirname, "..");
const distHtmlPath = path.join(projectRoot, "dist", "index.html");
const tempModulePath = path.join(os.tmpdir(), `zenin-prerender-${Date.now()}.cjs`);

try {
  await build({
    absWorkingDir: projectRoot,
    entryPoints: [path.join(projectRoot, "src", "entry-prerender.jsx")],
    bundle: true,
    format: "cjs",
    platform: "node",
    outfile: tempModulePath,
    logLevel: "silent",
    define: {
      "import.meta.env.VITE_SITE_URL": JSON.stringify(process.env.VITE_SITE_URL || "https://www.zenin.capital"),
      "import.meta.env.VITE_API_URL": JSON.stringify(process.env.VITE_API_URL || "")
    },
    loader: {
      ".css": "text"
    }
  });

  const template = await fs.readFile(distHtmlPath, "utf8");
  const { renderPublicHomepage } = require(tempModulePath);
  const appHtml = await renderPublicHomepage();
  const rendered = template.replace('<div id="root"></div>', `<div id="root">${appHtml}</div>`);
  await fs.writeFile(distHtmlPath, rendered, "utf8");
} finally {
  await fs.rm(tempModulePath, { force: true });
}
