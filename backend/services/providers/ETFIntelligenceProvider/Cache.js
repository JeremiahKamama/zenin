// services/providers/ETFIntelligenceProvider/Cache.js
// Server-side stale-while-revalidate cache. Per spec TTLs:
//   profile   7 days | strategy 30 days | classification 30 days
//   sector/ country/ top holdings 24 h | peer ETFs 7 days
const stores = {
  profile: new Map(),
  composition: new Map(),
  classification: new Map(),
  strategy: new Map(),
  peers: new Map(),
  themes: new Map(),
};
const TTL = {
  profile: 7 * 24 * 60 * 60 * 1000,
  composition: 24 * 60 * 60 * 1000,
  classification: 30 * 24 * 60 * 60 * 1000,
  strategy: 30 * 24 * 60 * 60 * 1000,
  peers: 7 * 24 * 60 * 60 * 1000,
  themes: 7 * 24 * 60 * 60 * 1000,
};
function get(store, key) {
  const h = stores[store]?.get(key);
  if (!h) return null;
  if (Date.now() - h.at > (TTL[store] || TTL.profile)) { stores[store].delete(key); return null; }
  return h.value;
}
function set(store, key, value) { stores[store]?.set(key, { value, at: Date.now() }); }
module.exports = { get, set, TTL };
