// backend/test/unit/pythonPriceFailure.test.js
//
// Every stock price on the platform went silently dead. The watchlist showed a
// perpetual "Refreshing prices" with no numbers, and nothing anywhere recorded
// a failure.
//
// The chain:
//
//   1. requirements.txt pinned yfinance==0.2.40 (Sep 2024). Yahoo now requires
//      a cookie+crumb handshake that the 0.2.x line does not perform, so every
//      chart request is rejected.
//   2. fetch_prices.py wraps its work in try/except and prints
//      {"error": "..."} — then exits 0.
//   3. index.js never inspected that payload. It looked up yfPrices[symbol],
//      found nothing, and substituted {price: null}. A total provider outage
//      was therefore indistinguishable from "the market had no data".
//   4. The route then reported stale_reason "prices_empty_from_provider",
//      which reads like a benign empty result.
//
// These tests pin the two code-level guards. The version pin itself is
// verified by installing the file and fetching real quotes.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(here, "../..");

const indexSource = readFileSync(join(backendRoot, "index.js"), "utf8");
const requirements = readFileSync(join(backendRoot, "requirements.txt"), "utf8");
const fetchPrices = readFileSync(join(backendRoot, "fetch_prices.py"), "utf8");

test("the Python error payload is inspected, not silently discarded", () => {
  // Without this check a caught exception reaches the route as "no prices".
  assert.match(indexSource, /yfPrices\.error/, "the error key must be checked");
  assert.match(
    indexSource,
    /\[prices\] fetch_prices\.py reported an error/,
    "the failure must reach the logs"
  );
});

test("the Python script's contract is what the Node side assumes", () => {
  // If fetch_prices.py ever stops printing {"error": ...} on failure, the
  // guard above becomes dead code. Pin the two halves together.
  assert.match(fetchPrices, /print\(json\.dumps\(\{"error": str\(e\)\}\)\)/);
});

test("an unavailable provider is not reported as an empty result", () => {
  // These need different handling: one means "retry / we are down", the other
  // means "these symbols genuinely have no quote".
  assert.match(indexSource, /prices_provider_unavailable/);
  assert.match(indexSource, /prices_empty_from_provider/);
});

test("yfinance is not pinned to a version that cannot read Yahoo", () => {
  const match = requirements.match(/^yfinance==(.+)$/m);
  assert.ok(match, "yfinance must stay pinned");
  const [major, minor] = match[1].split(".").map(Number);
  // 0.2.x cannot complete Yahoo's crumb handshake and returns nothing.
  assert.ok(
    major > 0 || minor >= 3,
    `yfinance ${match[1]} cannot read Yahoo's current endpoints; needs >= 0.2.50 or 1.x`
  );
});

test("pandas is new enough for the yfinance release beside it", () => {
  // Mixing a 2023 pandas with a 2024+ yfinance fails as silent NaN/dtype
  // trouble rather than a clean import error.
  const match = requirements.match(/^pandas==(.+)$/m);
  assert.ok(match, "pandas must stay pinned");
  const [major, minor] = match[1].split(".").map(Number);
  assert.ok(major > 2 || (major === 2 && minor >= 2), `pandas ${match[1]} is too old`);
});

test("requirements.txt carries no bare unpinned installs", () => {
  // An unpinned dependency silently resolves to whatever is newest on build,
  // which is how this class of outage recurs.
  const lines = requirements
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  for (const line of lines) {
    assert.match(line, /==/, `${line} must be pinned to an exact version`);
  }
});
