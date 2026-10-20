// admin/test/plans.test.js
//
// The tier rename (pro -> plus, desk -> premium) left the admin console sending
// RETIRED ids from three separate hardcoded <option> lists. The server no longer
// recognised them, the write fell through to a fallback while still returning
// 200, and so changing a plan appeared to succeed while doing nothing — or
// silently moved the user to Starter.
//
// These tests pin the canonical ids and the legacy mapping, and assert the
// change description the new modal renders from.

import test from "node:test";
import assert from "node:assert/strict";

const {
  PLAN_IDS,
  PLANS,
  normalizePlanId,
  getPlan,
  planLabel,
  planOptionLabel,
  describePlanChange,
  isValidPlanId
} = await import("../src/utils/plans.js");

test("the canonical plan ids are starter, plus, premium", () => {
  assert.deepEqual(PLAN_IDS, ["starter", "plus", "premium"]);
});

test("no retired id appears in the canonical list", () => {
  // `pro` and `desk` are exactly what the console used to send.
  assert.equal(PLAN_IDS.includes("pro"), false);
  assert.equal(PLAN_IDS.includes("desk"), false);
});

test("legacy ids resolve forward to their replacements", () => {
  assert.equal(normalizePlanId("pro"), "plus");
  assert.equal(normalizePlanId("desk"), "premium");
});

test("legacy ids are accepted so old rows still render", () => {
  // A user row written before the migration must not display as "Unknown".
  assert.equal(planLabel("pro"), "Plus");
  assert.equal(planLabel("desk"), "Premium");
});

test("unknown values are rejected rather than silently coerced", () => {
  // Coercing an unknown plan to starter is precisely what made a valid-looking
  // request downgrade a paying customer.
  assert.equal(normalizePlanId("enterprise"), null);
  assert.equal(normalizePlanId(""), null);
  assert.equal(normalizePlanId(null), null);
  assert.equal(normalizePlanId(undefined), null);
  assert.equal(isValidPlanId("enterprise"), false);
});

test("casing and whitespace do not defeat normalisation", () => {
  assert.equal(normalizePlanId("  PLUS  "), "plus");
  assert.equal(normalizePlanId("Pro"), "plus");
});

test("every canonical id round-trips", () => {
  for (const id of PLAN_IDS) {
    assert.equal(normalizePlanId(id), id);
    assert.ok(getPlan(id), `${id} must have presentation metadata`);
  }
});

test("upgrade is detected with the correct price delta", () => {
  const change = describePlanChange("starter", "premium");
  assert.equal(change.isUpgrade, true);
  assert.equal(change.isDowngrade, false);
  assert.equal(change.isDestructive, false);
  assert.equal(change.priceDelta, 99);
  assert.equal(change.to.label, "Premium");
});

test("downgrade is flagged destructive", () => {
  // A downgrade removes access the user may be relying on, so the modal
  // requires a typed confirmation for exactly this case.
  const change = describePlanChange("premium", "starter");
  assert.equal(change.isDowngrade, true);
  assert.equal(change.isDestructive, true);
  assert.equal(change.priceDelta, -99);
});

test("a legacy source value is described in canonical terms", () => {
  // Changing a user still stored as `pro` must read as Plus -> Premium, not
  // "pro -> Premium".
  const change = describePlanChange("pro", "premium");
  assert.equal(change.from.label, "Plus");
  assert.equal(change.to.label, "Premium");
  assert.equal(change.isUpgrade, true);
  assert.equal(change.priceDelta, 70);
});

test("no change is reported when the target equals the source", () => {
  assert.equal(describePlanChange("plus", "plus"), null);
  assert.equal(describePlanChange("pro", "plus"), null, "pro IS plus after normalisation");
});

test("an invalid target produces no change object", () => {
  // The modal disables submit when this is null, so an unknown id can never be
  // sent.
  assert.equal(describePlanChange("starter", "enterprise"), null);
});

test("option labels include price so an admin can tell tiers apart", () => {
  assert.equal(planOptionLabel("starter"), "Starter (Free)");
  assert.match(planOptionLabel("plus"), /\$29/);
  assert.match(planOptionLabel("premium"), /\$99/);
});

test("labels are unique, so a dropdown is unambiguous", () => {
  const labels = PLANS.map((p) => p.label);
  assert.equal(new Set(labels).size, labels.length);
});

test("planLabel never returns an empty string", () => {
  for (const value of [null, undefined, "", "enterprise", 0]) {
    assert.ok(planLabel(value).length > 0, `planLabel(${String(value)}) was empty`);
  }
});
