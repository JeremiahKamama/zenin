// services/providers/DocumentIntelligenceProvider/Cache.js
// Provider-specific, stale-while-revalidate cache. Per spec TTLs:
//   latest filings        15 min
//   filing metadata       24 h
//   extracted sections    30 days (invalidate on newer filing)
//   governance            7 days
//   institutional (13F)   per quarterly cycle
//   insider filings       15-30 min (market hours)
//   corporate actions     15 min
// In-memory only (server-side). Swap for Redis/Postgres later without changing callers.

const stores = {
  filings: new Map(),
  ownership: new Map(),
  insiders: new Map(),
  governance: new Map(),
  corporateActions: new Map(),
  sections: new Map(),
};

const TTL = {
  filings: 15 * 60 * 1000,
  ownership: 24 * 60 * 60 * 1000, // refreshed after quarterly cycle in practice
  insiders: 20 * 60 * 1000,
  governance: 7 * 24 * 60 * 60 * 1000,
  corporateActions: 15 * 60 * 1000,
  sections: 30 * 24 * 60 * 60 * 1000,
};

function get(store, key) {
  const hit = stores[store]?.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > (TTL[store] || TTL.filings)) {
    stores[store].delete(key);
    return null;
  }
  return hit.value;
}

function set(store, key, value) {
  stores[store]?.set(key, { value, at: Date.now() });
}

function invalidate(store, key) {
  stores[store]?.delete(key);
}

module.exports = { get, set, invalidate, TTL };
