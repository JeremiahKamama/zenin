/**
 * Unit tests: Cache Provider
 */

"use strict";

const { describe, it, beforeEach } = require("node:test");
const assert = require("node:assert/strict");

const { MemoryCacheProvider, CACHE_TTL, resetCache } = require("../../infrastructure/cache");

describe("MemoryCacheProvider", () => {
  let cache;

  beforeEach(() => {
    cache = new MemoryCacheProvider();
  });

  it("stores and retrieves values", () => {
    cache.set("key1", { a: 1 }, 60000);
    const val = cache.get("key1");
    assert.deepStrictEqual(val, { a: 1 });
  });

  it("returns null for missing keys", () => {
    assert.strictEqual(cache.get("missing"), null);
  });

  it("returns null for expired entries", async () => {
    cache.set("expired", "value", 1); // 1ms TTL
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(cache.get("expired"), null);
  });

  it("has() works correctly", () => {
    cache.set("exists", true, 60000);
    assert.strictEqual(cache.has("exists"), true);
    assert.strictEqual(cache.has("nope"), false);
  });

  it("has() returns false for expired", async () => {
    cache.set("expired", true, 1);
    await new Promise((r) => setTimeout(r, 5));
    assert.strictEqual(cache.has("expired"), false);
  });

  it("del() removes single key", () => {
    cache.set("remove", 1, 60000);
    cache.del("remove");
    assert.strictEqual(cache.get("remove"), null);
  });

  it("del() with wildcard pattern", () => {
    cache.set("quote:AAPL", 100, 60000);
    cache.set("quote:MSFT", 200, 60000);
    cache.set("profile:AAPL", {}, 60000);
    cache.del("quote:*");
    assert.strictEqual(cache.get("quote:AAPL"), null);
    assert.strictEqual(cache.get("quote:MSFT"), null);
    assert.ok(cache.get("profile:AAPL") !== null);
  });

  it("flush() clears everything", () => {
    cache.set("a", 1, 60000);
    cache.set("b", 2, 60000);
    cache.flush();
    assert.strictEqual(cache.get("a"), null);
    assert.strictEqual(cache.stats().size, 0);
  });

  it("evictExpired() removes only expired", async () => {
    cache.set("fresh", 1, 60000);
    cache.set("stale", 2, 1);
    await new Promise((r) => setTimeout(r, 5));
    cache.evictExpired();
    assert.ok(cache.has("fresh"));
    assert.strictEqual(cache.has("stale"), false);
  });

  it("getOrSet returns cached value or fetches", async () => {
    let fetchCount = 0;
    const fetcher = async () => { fetchCount++; return "fetched"; };

    const val1 = await cache.getOrSet("k", 60000, fetcher);
    assert.strictEqual(val1, "fetched");
    assert.strictEqual(fetchCount, 1);

    const val2 = await cache.getOrSet("k", 60000, fetcher);
    assert.strictEqual(val2, "fetched");
    assert.strictEqual(fetchCount, 1); // Not called again
  });

  it("stats returns correct counts", () => {
    cache.set("a", 1, 60000);
    cache.get("a"); // hit
    cache.get("missing"); // miss
    const s = cache.stats();
    assert.strictEqual(s.size, 1);
    assert.ok(s.hits >= 1);
    assert.ok(s.misses >= 1);
  });
});

describe("CACHE_TTL", () => {
  it("has expected TTL constants", () => {
    assert.strictEqual(CACHE_TTL.QUOTE, 30000);
    assert.strictEqual(CACHE_TTL.NEWS, 300000);
    assert.strictEqual(CACHE_TTL.COMPANY_PROFILE, 86400000);
    assert.strictEqual(CACHE_TTL.FINANCIAL_STATEMENTS, 86400000);
    assert.strictEqual(CACHE_TTL.EARNINGS, 3600000);
    assert.strictEqual(CACHE_TTL.DIVIDENDS, 86400000);
    assert.strictEqual(CACHE_TTL.INSIDER_TRADING, 1800000);
    assert.strictEqual(CACHE_TTL.MARKET_STATUS, 300000);
  });
});
