const test = require("node:test");
const assert = require("node:assert/strict");

const {
  ANNUAL_RETURNS,
  REIT_DATA,
  MMF_YIELDS,
  FUNDS_LIST,
} = require("../../equities_benchmarks");

// ── ANNUAL_RETURNS ────────────────────────────────────────────────────────────

test("ANNUAL_RETURNS is a non-empty array", () => {
  assert.ok(Array.isArray(ANNUAL_RETURNS));
  assert.ok(ANNUAL_RETURNS.length >= 10);
});

test("ANNUAL_RETURNS entries have all required fields", () => {
  ANNUAL_RETURNS.forEach((entry) => {
    assert.equal(typeof entry.year, "number");
    assert.equal(typeof entry.sp500, "number");
    assert.equal(typeof entry.msciWorld, "number");
    assert.equal(typeof entry.msciEm, "number");
    assert.equal(typeof entry.reits, "number");
  });
});

test("ANNUAL_RETURNS years are in descending order", () => {
  for (let i = 1; i < ANNUAL_RETURNS.length; i++) {
    assert.ok(
      ANNUAL_RETURNS[i - 1].year > ANNUAL_RETURNS[i].year,
      `Year ${ANNUAL_RETURNS[i - 1].year} should be > ${ANNUAL_RETURNS[i].year}`
    );
  }
});

test("ANNUAL_RETURNS covers range 2006-2025", () => {
  const years = ANNUAL_RETURNS.map((e) => e.year);
  assert.ok(years.includes(2006));
  assert.ok(years.includes(2025));
});

// ── REIT_DATA ─────────────────────────────────────────────────────────────────

test("REIT_DATA has provider and benchmarks", () => {
  assert.equal(typeof REIT_DATA.provider, "string");
  assert.ok(Array.isArray(REIT_DATA.benchmarks));
  assert.ok(REIT_DATA.benchmarks.length > 0);
});

test("REIT_DATA benchmarks have required fields", () => {
  REIT_DATA.benchmarks.forEach((b) => {
    assert.equal(typeof b.name, "string");
    assert.equal(typeof b.ytd, "number");
    assert.equal(typeof b.yr1, "number");
    assert.equal(typeof b.yr3, "number");
    assert.equal(typeof b.yr5, "number");
  });
});

// ── MMF_YIELDS ────────────────────────────────────────────────────────────────

test("MMF_YIELDS is a non-empty array", () => {
  assert.ok(Array.isArray(MMF_YIELDS));
  assert.ok(MMF_YIELDS.length > 0);
});

test("MMF_YIELDS entries have required fields", () => {
  MMF_YIELDS.forEach((entry) => {
    assert.equal(typeof entry.country, "string");
    assert.equal(typeof entry.currency, "string");
    assert.equal(typeof entry.yieldRange, "string");
    assert.equal(typeof entry.average, "number");
    assert.equal(typeof entry.note, "string");
  });
});

// ── FUNDS_LIST ────────────────────────────────────────────────────────────────

test("FUNDS_LIST is a non-empty array", () => {
  assert.ok(Array.isArray(FUNDS_LIST));
  assert.ok(FUNDS_LIST.length > 0);
});

test("FUNDS_LIST entries have required fields", () => {
  FUNDS_LIST.forEach((fund) => {
    assert.equal(typeof fund.provider, "string");
    assert.equal(typeof fund.name, "string");
    assert.equal(typeof fund.jurisdiction, "string");
    assert.equal(typeof fund.type, "string");
    assert.equal(typeof fund.aum, "string");
  });
});

test("FUNDS_LIST includes both ETFs and Mutual Funds", () => {
  const types = new Set(FUNDS_LIST.map((f) => f.type));
  assert.ok(types.has("ETF"));
  assert.ok(types.has("Mutual Fund"));
});
