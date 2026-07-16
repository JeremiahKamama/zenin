// ETFdbApiCache — per-dataset TTL cache for the ETFdb API adapter.
//
// Pure in-memory cache (no external store). Each dataset namespace has its own
// TTL so profile/holdings can live 24h while screener/flows live 6h. The cache
// never throws; a read/write error simply degrades to a miss.
//
// IMPORTANT: this module performs NO network I/O. It only stores whatever the
// provider hands it. Live ETFdb fetching is gated in ETFdbApiProvider.js and is
// intentionally disabled until ETF_INTELLIGENCE_ETFDB_API_ENABLED=true.

const DEFAULT_TTL = {
  profile: 86_400_000,      // 24h — overview/identity/economics
  holdings: 86_400_000,     // 24h — composition
  screener: 21_600_000,     // 6h  — search results
  flows: 21_600_000,        // 6h  — fund flows
};

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

class ETFdbApiCache {
  constructor(ttls = {}) {
    this.ttls = { ...DEFAULT_TTL, ...ttls };
    this.store = new Map(); // key `${ns}:${symbol}` -> { value, expiresAt }
  }

  static fromEnv() {
    return new ETFdbApiCache({
      profile: envNumber("ETF_INTELLIGENCE_ETFDB_CACHE_TTL_PROFILE_MS", DEFAULT_TTL.profile),
      holdings: envNumber("ETF_INTELLIGENCE_ETFDB_CACHE_TTL_HOLDINGS_MS", DEFAULT_TTL.holdings),
      screener: envNumber("ETF_INTELLIGENCE_ETFDB_CACHE_TTL_SCREENER_MS", DEFAULT_TTL.screener),
      flows: envNumber("ETF_INTELLIGENCE_ETFDB_CACHE_TTL_FLOWS_MS", DEFAULT_TTL.flows),
    });
  }

  get(namespace, key) {
    const k = `${namespace}:${String(key || "").toUpperCase()}`;
    const hit = this.store.get(k);
    if (!hit) return undefined;
    if (Date.now() > hit.expiresAt) {
      this.store.delete(k);
      return undefined;
    }
    return hit.value;
  }

  set(namespace, key, value) {
    const ttl = this.ttls[namespace] || DEFAULT_TTL.profile;
    this.store.set(`${namespace}:${String(key || "").toUpperCase()}`, {
      value,
      expiresAt: Date.now() + ttl,
    });
    return value;
  }

  isStale(namespace, key) {
    const k = `${namespace}:${String(key || "").toUpperCase()}`;
    const hit = this.store.get(k);
    return !hit || Date.now() > hit.expiresAt;
  }

  ageMs(namespace, key) {
    const k = `${namespace}:${String(key || "").toUpperCase()}`;
    const hit = this.store.get(k);
    return hit ? Date.now() - (hit.expiresAt - (this.ttls[namespace] || DEFAULT_TTL.profile)) : null;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { ETFdbApiCache, DEFAULT_TTL };
