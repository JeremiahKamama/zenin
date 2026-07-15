"use strict";

/**
 * MyStocks Africa — lightweight in-memory TTL cache.
 *
 * Two tiers per spec:
 *  - quotes: short TTL (MYSTOCKS_AFRICA_QUOTE_CACHE_TTL_MS, default 60s)
 *  - reference/catalogue: long TTL (MYSTOCKS_AFRICA_REFERENCE_CACHE_TTL_MS, default 24h)
 *
 * Not shared across processes (single-instance backend). Quotes are cached
 * briefly so batched Watchlist refreshes don't hammer the upstream rate limit;
 * reference data is cached aggressively. Each entry also records the upstream
 * `asOf` so the normalization layer can derive quoteState (stale vs live).
 */

const DEFAULTS = {
  quoteTtlMs: Number(process.env.MYSTOCKS_AFRICA_QUOTE_CACHE_TTL_MS) || 60000,
  referenceTtlMs: Number(process.env.MYSTOCKS_AFRICA_REFERENCE_CACHE_TTL_MS) || 86400000,
};

function makeCache(opts = {}) {
  const quoteTtl = opts.quoteTtlMs || DEFAULTS.quoteTtlMs;
  const referenceTtl = opts.referenceTtlMs || DEFAULTS.referenceTtlMs;
  const store = new Map(); // key -> { tier, value, expiresAt, asOf }

  function get(key, tier = "reference") {
    const hit = store.get(key);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      store.delete(key);
      return undefined;
    }
    return hit.value;
  }

  function set(key, value, tier = "reference", asOf = null) {
    const ttl = tier === "quote" ? quoteTtl : referenceTtl;
    store.set(key, { tier, value, asOf, expiresAt: Date.now() + ttl });
  }

  function getQuote(symbol) {
    return get(`quote:${String(symbol).toUpperCase()}`, "quote");
  }
  function setQuote(symbol, value, asOf = null) {
    set(`quote:${String(symbol).toUpperCase()}`, value, "quote", asOf);
  }
  function getReference(key) {
    return get(`ref:${key}`, "reference");
  }
  function setReference(key, value) {
    set(`ref:${key}`, value, "reference");
  }

  function clear() {
    store.clear();
  }

  return { get, set, getQuote, setQuote, getReference, setReference, clear };
}

module.exports = { makeCache, DEFAULTS };
