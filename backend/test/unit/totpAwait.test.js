// backend/test/unit/totpAwait.test.js
//
// Guards a bug class that is invisible at runtime and cost us real functionality.
//
// Two separate mistakes were shipping in every TOTP call site:
//
//   1. WRONG SIGNATURE. This @otplib/totp version uses
//      `verify(token, { secret })`. The call sites passed a single object
//      `verify({ token, secret })`, so destructuring read `secret` from an
//      undefined second argument and the call REJECTED with SecretMissingError.
//
//   2. WRONG RETURN SHAPE. `verify()` resolves `{ valid: boolean }`, not a bare
//      boolean. So `if (!isValid)` would be checking an object — always truthy —
//      had the call not rejected first.
//
// Consequences: authenticator enrollment always failed ("Secret is required"),
// and TOTP sign-in always failed (the rejection escaped as a 500).
//
// These tests pin the real signature/return shape, then statically scan the
// source so an un-awaited or mis-shaped call cannot creep back in.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { authenticator } = require("../../utils/otplib-config");

const BACKEND_DIR = path.resolve(__dirname, "../..");
const SECRET = String(authenticator.generateSecret());

test("generateSecret() is synchronous and returns a base32 string", () => {
  const secret = authenticator.generateSecret();
  assert.equal(typeof secret, "string");
  assert.ok(secret.length >= 16, "secret should be reasonably long");
});

test("verify() takes (token, { secret }) and resolves { valid }", async () => {
  const code = await authenticator.generate({ secret: SECRET });
  assert.match(String(code), /^\d{6}$/);

  const ok = await authenticator.verify(code, { secret: SECRET });
  // Object with a boolean `valid`, NOT a bare boolean.
  assert.equal(typeof ok, "object");
  assert.equal(ok.valid, true);

  const wrong = code === "000000" ? "111111" : "000000";
  const bad = await authenticator.verify(wrong, { secret: SECRET });
  assert.equal(bad.valid, false);
});

test("the single-object form is what broke, and still fails loudly", async () => {
  // Regression pin: if a future edit reverts to verify({ token, secret }) this
  // must reject rather than silently pass.
  await assert.rejects(
    async () => authenticator.verify({ token: "000000", secret: SECRET }),
    /Secret is required/i
  );
});

test("an object return is always truthy, which is why the shape matters", async () => {
  const bad = await authenticator.verify("000000", { secret: SECRET });
  // `!bad` would be false even though the code was wrong — callers MUST read .valid.
  assert.equal(Boolean(bad), true);
  assert.equal(bad.valid, false);
});

test("verify() is async, so it must always be awaited", () => {
  const pending = authenticator.verify("000000", { secret: SECRET });
  assert.equal(typeof pending?.then, "function");
  return pending.then((result) => assert.equal(result.valid, false));
});

test("generate() also takes an options object", async () => {
  const code = await authenticator.generate({ secret: SECRET });
  assert.match(String(code), /^\d{6}$/);
});

/** Recursively collect backend .js files, excluding node_modules and tests. */
function collectSourceFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, found);
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

test("no call site uses the broken verify({ token, secret }) form", () => {
  const offenders = [];
  for (const file of collectSourceFiles(BACKEND_DIR)) {
    const rel = path.relative(BACKEND_DIR, file);
    if (rel.split(path.sep).includes("test") || rel.includes("/test/")) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (!line.includes("authenticator.verify")) return;
      // The broken shape passes an object literal containing both token and secret.
      if (/authenticator\.verify\(\s*\{[^}]*token[^}]*secret/.test(line)) {
        offenders.push(`${rel}:${index + 1}: ${trimmed}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `Mis-shaped authenticator.verify call(s):\n${offenders.join("\n")}`);
});

test("every authenticator.verify call site is awaited", () => {
  const offenders = [];
  for (const file of collectSourceFiles(BACKEND_DIR)) {
    const rel = path.relative(BACKEND_DIR, file);
    if (rel.split(path.sep).includes("test") || rel.includes("/test/")) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
      if (!line.includes("authenticator.verify")) return;
      if (/await\s+[^;]*authenticator\.verify/.test(line)) return;
      if (/return\s+authenticator\.verify/.test(line)) return;
      offenders.push(`${rel}:${index + 1}: ${trimmed}`);
    });
  }
  assert.deepEqual(offenders, [], `Un-awaited authenticator.verify call(s):\n${offenders.join("\n")}`);
});
