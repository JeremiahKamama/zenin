// frontend/test/extension-resolver.mjs
// Resolve Vite-style extensionless imports + inject a stub import.meta.env.

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CANDIDATE_EXTENSIONS = ["", ".js", ".jsx", ".mjs", "/index.js", "/index.jsx"];

export async function resolve(specifier, context, nextResolve) {
  // Only help with relative specifiers that lack an extension.
  if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
    try {
      const base = new URL(specifier, context.parentURL);
      const basePath = fileURLToPath(base);
      for (const ext of CANDIDATE_EXTENSIONS) {
        const candidate = basePath + ext;
        if (existsSync(candidate)) {
          return nextResolve(specifier + ext, context);
        }
      }
    } catch {
      // Fall through to the default resolver.
    }
  }
  return nextResolve(specifier, context);
}

// Vite injects `import.meta.env` at build time. Under plain Node it is
// undefined, so modules that read VITE_* would throw on import. Rewrite it to
// a global stub for the modules under test.
const ENV_SHIM = `const __zeninEnv = globalThis.__ZENIN_TEST_ENV__ ?? {};\n`;

export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.includes("/src/") || result.format !== "module" || !result.source) {
    return result;
  }
  const source = result.source.toString();
  if (!source.includes("import.meta.env")) {
    return result;
  }
  return {
    ...result,
    source: ENV_SHIM + source.replaceAll("import.meta.env", "__zeninEnv"),
    format: "module"
  };
}
