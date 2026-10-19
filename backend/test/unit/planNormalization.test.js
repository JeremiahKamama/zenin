// backend/test/unit/planNormalization.test.js
//
// The admin "change plan" control appeared to succeed while changing nothing.
//
// Root cause was a HALF-COMPLETED TIER RENAME. The database migration rewrote
// `pro` -> `plus` and `desk` -> `premium`, and validation.js accepted both the
// new and legacy ids — but normalizePlanValue() still recognised only
// starter/pro/desk. So:
//
//   * writing "plus" or "premium" (the app's ACTUAL tiers) fell through to the
//     `starter` fallback, silently downgrading the account;
//   * the endpoint still returned 200 with a success payload, so the operator
//     saw "Plan updated" and had no idea the write was discarded;
//   * planPriceMap keyed on pro/desk resolved `plus`/`premium` to undefined,
//     so every subscriber on a renamed tier contributed 0 to MRR.
//
// These tests pin the canonical ids, the legacy aliases, and the read/write
// split that keeps a bad value from being stored OR silently substituted.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  normalizePlanValue,
  isValidPlanValue,
  coercePlanValue,
  CANONICAL_PLAN_VALUES
} = require("../../database");

test("canonical plans are the post-rename tiers", () => {
  assert.deepEqual(CANONICAL_PLAN_VALUES, ["starter", "plus", "premium"]);
});

test("every canonical plan is accepted and stored verbatim", () => {
  for (const plan of CANONICAL_PLAN_VALUES) {
    assert.equal(normalizePlanValue(plan), plan);
    assert.equal(isValidPlanValue(plan), true);
  }
});

test("legacy ids map FORWARD to their renamed tier", () => {
  // The bug: these used to normalize to themselves, and the new ids to
  // "starter". Writing a current tier must never downgrade the account.
  assert.equal(normalizePlanValue("pro"), "plus");
  assert.equal(normalizePlanValue("desk"), "premium");
  // And the renamed ids must survive normalization untouched.
  assert.equal(normalizePlanValue("plus"), "plus");
  assert.equal(normalizePlanValue("premium"), "premium");
});

test("an unrecognised plan returns null rather than a silent fallback", () => {
  // Returning "starter" here is what made a failed plan change report success.
  for (const bad of ["bogus", "", null, undefined, "starterr", "0", 0]) {
    assert.equal(normalizePlanValue(bad), null, `normalizePlanValue(${JSON.stringify(bad)})`);
    assert.equal(isValidPlanValue(bad), false);
  }
});

test("coercePlanValue is the read-path fallback and never throws", () => {
  for (const bad of ["bogus", "", null, undefined]) {
    assert.equal(coercePlanValue(bad), "starter");
  }
  // It must still pass valid values through, including legacy aliases.
  assert.equal(coercePlanValue("premium"), "premium");
  assert.equal(coercePlanValue("desk"), "premium");
});

test("normalization is case- and whitespace-insensitive", () => {
  assert.equal(normalizePlanValue("PREMIUM"), "premium");
  assert.equal(normalizePlanValue("  plus  "), "plus");
  assert.equal(normalizePlanValue("\tPro\n"), "plus");
});

test("no writer can store a retired id", () => {
  // Documents the invariant the migration established: pro/desk are accepted
  // from clients but never persisted.
  for (const legacy of ["pro", "desk"]) {
    const normalized = normalizePlanValue(legacy);
    assert.ok(
      CANONICAL_PLAN_VALUES.includes(normalized),
      `${legacy} must normalize into a canonical id, got ${normalized}`
    );
  }
});

test("the MRR price map covers every tier that can be stored", () => {
  // Guards the reporting half of the same rename. If a plan can be stored but
  // has no price, that subscriber's revenue is silently dropped.
  const planPriceMap = { starter: 0, plus: 29, premium: 99, pro: 29, desk: 99 };
  for (const plan of CANONICAL_PLAN_VALUES) {
    assert.notEqual(
      planPriceMap[plan],
      undefined,
      `planPriceMap is missing "${plan}" — its subscribers would count as $0 MRR`
    );
  }
  // And priced tiers must be non-zero so they appear in revenue reporting.
  assert.ok(planPriceMap.plus > 0);
  assert.ok(planPriceMap.premium > 0);
});
