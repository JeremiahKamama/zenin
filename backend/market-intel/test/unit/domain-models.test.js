/**
 * Unit tests: Domain models and value factories
 */

"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  toNumber,
  toNumberOrNull,
  toIso,
  toDateString,
  todayDate,
  generateId,
  MARKET_EVENT_TYPES
} = require("../../domain/models");

describe("Domain Models — Value Factories", () => {
  describe("toNumber()", () => {
    it("returns finite number", () => {
      assert.strictEqual(toNumber(42), 42);
    });
    it("returns 0 for NaN", () => {
      assert.strictEqual(toNumber(NaN), 0);
    });
    it("returns 0 for null", () => {
      assert.strictEqual(toNumber(null), 0);
    });
    it("returns defaultValue when provided", () => {
      assert.strictEqual(toNumber(null, 100), 100);
    });
    it("coerces strings", () => {
      assert.strictEqual(toNumber("3.14"), 3.14);
    });
  });

  describe("toNumberOrNull()", () => {
    it("returns number for valid input", () => {
      assert.strictEqual(toNumberOrNull(5.5), 5.5);
    });
    it("returns null for NaN", () => {
      assert.strictEqual(toNumberOrNull(NaN), null);
    });
    it("returns null for undefined", () => {
      assert.strictEqual(toNumberOrNull(undefined), null);
    });
  });

  describe("toIso()", () => {
    it("converts a date string to ISO", () => {
      const iso = toIso("2025-01-15");
      assert.ok(iso.includes("2025-01-15"));
    });
    it("returns null for null", () => {
      assert.strictEqual(toIso(null), null);
    });
    it("returns null for empty string", () => {
      assert.strictEqual(toIso(""), null);
    });
  });

  describe("toDateString()", () => {
    it("returns YYYY-MM-DD", () => {
      assert.strictEqual(toDateString("2025-06-15T12:00:00Z"), "2025-06-15");
    });
    it("returns null for invalid", () => {
      assert.strictEqual(toDateString("not-a-date"), null);
    });
  });

  describe("todayDate()", () => {
    it("returns today as YYYY-MM-DD", () => {
      const result = todayDate();
      assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe("generateId()", () => {
    it("returns a UUID-like string", () => {
      const id = generateId();
      assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
    it("generates unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, generateId));
      assert.strictEqual(ids.size, 100);
    });
  });
});

describe("MARKET_EVENT_TYPES", () => {
  it("is a frozen array", () => {
    assert.throws(() => MARKET_EVENT_TYPES.push("NEW_TYPE"));
  });
  it("includes known types", () => {
    assert.ok(MARKET_EVENT_TYPES.includes("LARGE_GAIN"));
    assert.ok(MARKET_EVENT_TYPES.includes("DIVIDEND_DECLARED"));
    assert.ok(MARKET_EVENT_TYPES.includes("EARNINGS_ANNOUNCED"));
    assert.ok(MARKET_EVENT_TYPES.includes("INSIDER_BUY"));
    assert.ok(MARKET_EVENT_TYPES.includes("PORTFOLIO_ATH"));
  });
});
