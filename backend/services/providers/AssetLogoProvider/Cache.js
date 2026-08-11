// services/providers/AssetLogoProvider/Cache.js
// Bounded in-memory cache for asset icon resolution results.
//
// Cache strategy:
//   - successful resolution: long TTL (30 days)
//   - provider miss (404): medium TTL (7 days)
//   - provider transient error (5xx, timeout): short TTL (5 minutes)
//   - rate-limited (429): short TTL (1 minute)
//
// Keys are normalized before lookup (uppercase symbols, trimmed ISINs, etc.).
// The cache is bounded to prevent unbounded memory growth in long-running
// backend processes. LRU-style eviction on insertion when MAX_ENTRIES is hit.

const stores = {
  success: new Map(),
  miss: new Map(),
  error: new Map(),
};

const MAX_ENTRIES = 5000;

// TTLs in milliseconds
const TTL = {
  success: 30 * 24 * 60 * 60 * 1000, // 30 days — logos change infrequently
  miss: 7 * 24 * 60 * 60 * 1000,      // 7 days — cached miss, avoid hammering providers
  error: 5 * 60 * 1000,                // 5 minutes — transient failure, retry soon
  rateLimited: 60 * 1000,             // 1 minute — respect 429 cooldown
};

// Eviction policy: when a store exceeds MAX_ENTRIES, remove the oldest entry.
function evictIfOversized(store) {
  if (store.size > MAX_ENTRIES) {
    // Map preserves insertion order; delete the first (oldest) key.
    const oldestKey = store.keys().next().value;
    if (oldestKey !== undefined) store.delete(oldestKey);
  }
}

function get(key) {
  if (!key) return null;
  for (const [storeName, store] of Object.entries(stores)) {
    const entry = store.get(key);
    if (!entry) continue;
    const ttl = storeName === 'rateLimited' ? TTL.rateLimited : TTL[storeName];
    if (ttl && Date.now() - entry.at > ttl) {
      store.delete(key);
      return null;
    }
    return entry.value;
  }
  return null;
}

function setSuccess(key, value) {
  stores.success.set(key, { value, at: Date.now() });
  evictIfOversized(stores.success);
}

function setMiss(key, value) {
  stores.miss.set(key, { value, at: Date.now() });
  evictIfOversized(stores.miss);
}

function setError(key, value) {
  stores.error.set(key, { value, at: Date.now() });
  evictIfOversized(stores.error);
}

function setRateLimited(key, value) {
  stores.error.set(key, { value, at: Date.now() });
  evictIfOversized(stores.error);
}

function clear() {
  stores.success.clear();
  stores.miss.clear();
  stores.error.clear();
}

module.exports = {
  get,
  setSuccess,
  setMiss,
  setError,
  setRateLimited,
  clear,
  TTL,
  MAX_ENTRIES,
};
