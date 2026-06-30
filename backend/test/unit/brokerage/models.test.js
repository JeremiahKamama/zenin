const test = require("node:test");
const assert = require("node:assert/strict");

const {
  toMoney,
  toConnectionStatus,
  toQuantity,
  toPositionSide,
} = require("../../../brokerage/domain/models");

// ── toMoney ───────────────────────────────────────────────────────────────────

test("toMoney coerces numeric strings and uppercases currency", () => {
  assert.deepEqual(toMoney("3.14", "usd"), { amount: 3.14, currency: "USD" });
});

test("toMoney coerces non-finite values to 0 without throwing", () => {
  assert.equal(toMoney(NaN).amount, 0);
  assert.equal(toMoney(undefined, "EUR").amount, 0);
  assert.equal(toMoney("abc").amount, 0);
  assert.equal(toMoney(Infinity).amount, 0);
});

test("toMoney defaults currency to USD when missing", () => {
  assert.equal(toMoney(5).currency, "USD");
  assert.equal(toMoney(5, "").currency, "USD");
});

// ── toConnectionStatus ────────────────────────────────────────────────────────

test("toConnectionStatus normalizes provider status synonyms", () => {
  assert.equal(toConnectionStatus("active"), "connected");
  assert.equal(toConnectionStatus("verified"), "connected");
  assert.equal(toConnectionStatus("revoked"), "disconnected");
  assert.equal(toConnectionStatus("removed"), "disconnected");
  assert.equal(toConnectionStatus("stale"), "expired");
  assert.equal(toConnectionStatus("connecting"), "pending");
});

test("toConnectionStatus collapses unknown status to error (never misleading)", () => {
  assert.equal(toConnectionStatus(""), "error");
  assert.equal(toConnectionStatus("totally-bogus"), "error");
  assert.equal(toConnectionStatus(undefined), "error");
});

// ── toQuantity / toPositionSide ───────────────────────────────────────────────

test("toQuantity returns finite numbers and 0 for bad input", () => {
  assert.equal(toQuantity("2.5"), 2.5);
  assert.equal(toQuantity(-3), -3);
  assert.equal(toQuantity(null), 0);
  assert.equal(toQuantity("nope"), 0);
});

test("toPositionSide derives side from signed quantity", () => {
  assert.equal(toPositionSide(10), "long");
  assert.equal(toPositionSide(-4), "short");
  assert.equal(toPositionSide(0), "flat");
  assert.equal(toPositionSide("bad"), "flat");
});
