const CACHE_PREFIX = "zenin_resilient_cache_v1";

function hasStorage() {
  return typeof window !== "undefined" && window.localStorage;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map((row) => stableValue(row));
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((acc, key) => {
        acc[key] = stableValue(value[key]);
        return acc;
      }, {});
  }
  return value ?? null;
}

export function makeResilientCacheKey(scope, params = {}) {
  const normalizedScope = String(scope || "").trim() || "service";
  return `${CACHE_PREFIX}:${normalizedScope}:${JSON.stringify(stableValue(params))}`;
}

export function readResilientCache(scope, params = {}) {
  if (!hasStorage()) return null;
  const key = makeResilientCacheKey(scope, params);
  const raw = window.localStorage.getItem(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      key,
      payload: parsed?.payload ?? null,
      updatedAt: parsed?.updatedAt || null
    };
  } catch {
    return null;
  }
}

export function writeResilientCache(scope, params = {}, payload = null) {
  if (!hasStorage()) return;
  const key = makeResilientCacheKey(scope, params);
  const entry = {
    payload: payload ?? null,
    updatedAt: new Date().toISOString()
  };
  window.localStorage.setItem(key, JSON.stringify(entry));
}
