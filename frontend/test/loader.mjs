// frontend/test/loader.mjs
// Node ESM loader that lets the frontend source (which uses Vite-style
// extensionless relative imports and `import.meta.env`) run under `node --test`.
//
// Usage: node --import ./test/loader.mjs --test test/authTimeout.test.js
//
// Two responsibilities:
//  1. Resolve extensionless relative specifiers to .js/.jsx files.
//  2. Provide a stub `import.meta.env` so modules reading VITE_* don't crash.

import { register } from "node:module";
import { pathToFileURL } from "node:url";

register("./extension-resolver.mjs", pathToFileURL("./test/"));
