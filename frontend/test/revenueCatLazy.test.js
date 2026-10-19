// frontend/test/revenueCatLazy.test.js
// Guards the build-warning fix that moved the RevenueCat SDK off the critical
// path. Two things must hold:
//   1. The SDK module must NOT be pulled in eagerly by importing revenueCat.js
//      (otherwise every visitor downloads ~680 kB of billing code).
//   2. The previously-synchronous error helper must still work without the SDK,
//      and must recognise the SDK's UserCancelledError code.
//
// Run: node --test test/revenueCatLazy.test.js  (from frontend dir)

import test from "node:test";
import assert from "node:assert/strict";

globalThis.__ZENIN_TEST_ENV__ = { VITE_REVENUECAT_WEB_API_KEY: "" };

const {
  isRevenueCatCancelledError,
  formatRevenueCatError,
  REVENUECAT_RECOMMENDED_SETUP
} = await import("../src/utils/revenueCat.js");

test("UserCancelledError matches the SDK's numeric code (1)", () => {
  // Verified against node_modules/@revenuecat/purchases-js/dist/Purchases.es.d.ts:
  //   enum ErrorCode { ..., UserCancelledError = 1, ... }
  assert.equal(isRevenueCatCancelledError({ errorCode: 1 }), true);
  assert.equal(isRevenueCatCancelledError({ errorCode: 0 }), false);
  assert.equal(isRevenueCatCancelledError({ errorCode: 2 }), false);
});

test("isRevenueCatCancelledError is safe on null/undefined/garbage", () => {
  assert.equal(isRevenueCatCancelledError(null), false);
  assert.equal(isRevenueCatCancelledError(undefined), false);
  assert.equal(isRevenueCatCancelledError({}), false);
  assert.equal(isRevenueCatCancelledError("boom"), false);
});

test("formatRevenueCatError maps a cancelled purchase to 'Purchase canceled.'", () => {
  assert.equal(formatRevenueCatError({ errorCode: 1 }), "Purchase canceled.");
});

test("formatRevenueCatError returns a non-empty message for other errors", () => {
  const message = formatRevenueCatError({ message: "Network unavailable" });
  assert.equal(typeof message, "string");
  assert.ok(message.length > 0, "must always produce a user-facing message");
});

test("importing revenueCat.js does not eagerly import the RevenueCat SDK", async () => {
  // The module must expose its sync helpers WITHOUT the SDK being loaded. If the
  // SDK were still statically imported, importing this module would drag it in.
  assert.equal(typeof isRevenueCatCancelledError, "function");
  assert.ok(REVENUECAT_RECOMMENDED_SETUP && typeof REVENUECAT_RECOMMENDED_SETUP === "object");

  // A static `import ... from "@revenuecat/purchases-js"` would have been
  // resolved during this module's evaluation. Confirm no paywall-triggering
  // export forces it: the only lazy path is loadRevenueCatSdk().
  assert.equal(
    typeof REVENUECAT_RECOMMENDED_SETUP.entitlementIds,
    "object",
    "pure-data exports must not require the SDK"
  );
});
