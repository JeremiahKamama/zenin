// frontend/test/notificationStreamCredentials.test.js
//
// Guards a one-line omission with an outsized symptom.
//
// The notifications SSE endpoint is cross-origin (www.zenin.capital ->
// zenin-mx6w.onrender.com). `EventSource` defaults to `withCredentials: false`,
// which omits cookies, so the session cookie never reached the server and
// `requireSignedIn` rejected every attempt. Because EventSource auto-retries, the
// console filled with a permanent loop of
//   GET /api/notifications/stream 401 (Unauthorized)
// and realtime notifications silently never worked.
//
// These tests read the hook source and assert the credentialed constructor is
// used, so a future edit cannot quietly drop it again.

"use strict";

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOOK_PATH = path.resolve(__dirname, "../src/hooks/useNotificationStream.js");
const source = fs.readFileSync(HOOK_PATH, "utf8");

test("notification stream opens EventSource with credentials", () => {
  const constructions = [...source.matchAll(/new EventSource\(([\s\S]*?)\)\s*;/g)].map((m) => m[1]);
  assert.ok(constructions.length > 0, "expected an EventSource construction in the hook");
  for (const args of constructions) {
    assert.match(
      args,
      /withCredentials:\s*true/,
      `EventSource must pass { withCredentials: true } or cookies are omitted cross-origin: ${args}`
    );
  }
});

test("the cross-origin reason is documented at the call site", () => {
  // A future reader should not "simplify" the option away; the comment explains
  // why it is load-bearing.
  assert.match(source, /withCredentials` is REQUIRED|withCredentials: true/);
  assert.match(source, /401|Unauthorized|cross-origin/i);
});

test("no bare EventSource construction remains anywhere in src", () => {
  const root = path.resolve(__dirname, "../src");
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(entry.name)) continue;
      const text = fs.readFileSync(full, "utf8");
      text.split("\n").forEach((line, index) => {
        if (!line.includes("new EventSource")) return;
        // Allow multi-line calls only if the option appears on the same line;
        // otherwise require the option within the file's construction.
        if (/new EventSource\([^)]*\)\s*;/.test(line) && !/withCredentials/.test(line)) {
          offenders.push(`${path.relative(root, full)}:${index + 1}: ${line.trim()}`);
        }
      });
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], `EventSource without withCredentials:\n${offenders.join("\n")}`);
});
