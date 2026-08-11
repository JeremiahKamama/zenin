// services/providers/AssetLogoProvider/Provider.js
// Main Asset Logo Resolver — the SINGLE canonical entry point.
//
// Architecture (spec §81, §147):
//   CanonicalAssetIdentity → Cache → VectorUp (primary) → Logo.dev (fallback) → Local fallback
//
// The provider is invisible to the UI layer. The same canonical asset resolves
// to the same icon regardless of whether it originated from a broker, wallet,
// watchlist, search result, transaction, journal entry, order, or analytics module.
//
// Provider hierarchy (spec §1, §125):
//   1. Cache hit → return
//   2. VectorUp success → cache + return
//   3. VectorUp miss/error → Logo.dev
//   4. Logo.dev success → cache + return
//   5. Logo.dev miss/error → local deterministic fallback
//
// Request deduplication: concurrent requests for the same cache key share
// a single in-flight provider call (spec §37).

const Cache = require('./Cache');
const { createVectorUpProvider } = require('./VectorUpProvider');
const { createLogoDevProvider } = require('./LogoDevProvider');
const {
  ASSET_TYPES,
  toCanonicalAssetIdentity,
  buildCacheKey,
  getFallbackInitials,
  getFallbackTypeClass,
  normalizeSymbolForCache,
} = require('./Normalizer');

// In-flight request tracking for deduplication (spec §37)
const inFlight = new Map();

/**
 * @typedef {Object} ResolveOptions
 * @property {boolean} [skipCache] - Skip cache lookup (force re-resolve)
 * @property {number} [timeoutMs] - Per-provider timeout in ms
 */

/**
 * Resolve an asset icon for a canonical asset identity.
 *
 * @param {CanonicalAssetIdentity} asset - The asset identity (or any object
 *   from which toCanonicalAssetIdentity can extract fields)
 * @param {ResolveOptions} [options]
 * @returns {Promise<ResolvedIcon>} Normalized resolution result
 */
async function resolveAssetIcon(asset, options = {}) {
  const { skipCache = false, timeoutMs = 10000 } = options;

  if (!asset || typeof asset !== 'object') {
    return buildFallbackResult(null, 'Symbol', 'unknown');
  }

  // 1. Normalize to canonical identity
  const identity = toCanonicalAssetIdentity(asset);
  if (!identity || !identity.symbol) {
    // Cannot resolve without at least a symbol or other identifier
    return buildFallbackResult(identity, identity?.name || 'Asset', getFallbackTypeClass(identity));
  }

  // 2. Build cache key (strongest identifier first)
  const cacheKey = buildCacheKey(identity);
  if (!cacheKey) {
    return buildFallbackResult(identity, identity.symbol, getFallbackTypeClass(identity));
  }

  // 3. Check cache
  if (!skipCache) {
    const cached = Cache.get(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  // 4. Request deduplication — if a request for this key is already in-flight,
  //    wait for it instead of firing a new one.
  if (inFlight.has(cacheKey)) {
    const existing = inFlight.get(cacheKey);
    return existing.promise;
  }

  // 5. Create the in-flight promise
  const promise = (async () => {
    try {
      const result = await resolveWithProviders(identity, cacheKey, timeoutMs);
      return result;
    } catch (error) {
      // On any unexpected error, fall back to local deterministic
      console.warn(`[AssetLogoProvider] Resolution failed for ${cacheKey}:`, error?.message || error);
      return buildFallbackResult(identity, identity.symbol, getFallbackTypeClass(identity));
    } finally {
      inFlight.delete(cacheKey);
    }
  })();

  inFlight.set(cacheKey, { promise });

  const result = await promise;

  // Cache the result
  cacheResult(cacheKey, result);

  return result;
}

// ---------------------------------------------------------------------------
// Provider orchestration: VectorUp → Logo.dev → fallback
// ---------------------------------------------------------------------------
var vectorUpProvider = null;
var logoDevProvider = null;

function getProviders() {
  if (!vectorUpProvider) {
    vectorUpProvider = createVectorUpProvider({
      apiKey: process.env.VECTORUP_API_KEY,
      timeoutMs: 10000,
    });
  }
  if (!logoDevProvider) {
    logoDevProvider = createLogoDevProvider({
      publishableKey: process.env.LOGO_DEV_PUBLISHABLE_KEY,
      format: 'webp',
      size: '128',
      theme: 'dark',
      greyscale: true,
    });
  }
  return { vectorUpProvider, logoDevProvider };
}

/**
 * Resolve using the provider hierarchy.
 * VectorUp is PRIMARY; Logo.dev is SECONDARY fallback.
 */
async function resolveWithProviders(identity, cacheKey, timeoutMs) {
  const { vectorUpProvider, logoDevProvider } = getProviders();

  // ── VectorUp (primary) ──────────────────────────────────────────────
  if (vectorUpProvider.isConfigured) {
    try {
      const result = await withTimeout(vectorUpProvider.resolve(identity), timeoutMs);
      if (result && result.url) {
        return {
          type: 'remote',
          provider: 'vectorup',
          url: result.url,
          format: result.format || 'svg',
          confidence: result.confidence || 'high',
          sourceKey: result.sourceKey || cacheKey,
          resolvedAt: result.resolvedAt || new Date().toISOString(),
        };
      }
      // VectorUp returned null (not found) — cache as miss
      Cache.setMiss(cacheKey, { type: 'miss', provider: 'vectorup', sourceKey: cacheKey });
    } catch (error) {
      const status = error?.status || error?.code;
      // Rate limited — cache briefly, move to Logo.dev
      if (status === 429) {
        Cache.setRateLimited(cacheKey, { type: 'rate_limited', provider: 'vectorup', sourceKey: cacheKey });
      } else if (status === 401 || status === 403) {
        // Auth error — don't cache (key may be misconfigured), just move to Logo.dev
        console.warn('[AssetLogoProvider] VectorUp auth error — check VECTORUP_API_KEY');
      } else {
        // Transient error — cache briefly
        Cache.setError(cacheKey, { type: 'error', provider: 'vectorup', sourceKey: cacheKey, error: error?.message });
      }
    }
  }

  // ── Logo.dev (fallback) ─────────────────────────────────────────────
  if (logoDevProvider.isConfigured) {
    try {
      const result = await withTimeout(logoDevProvider.resolve(identity), timeoutMs);
      if (result && result.url) {
        return {
          type: 'remote',
          provider: 'logo-dev',
          url: result.url,
          format: result.format || 'webp',
          confidence: result.confidence || 'high',
          sourceKey: result.sourceKey || cacheKey,
          resolvedAt: result.resolvedAt || new Date().toISOString(),
        };
      }
      Cache.setMiss(cacheKey, { type: 'miss', provider: 'logo-dev', sourceKey: cacheKey });
    } catch (error) {
      const status = error?.status || error?.code;
      console.warn(`[AssetLogoProvider] Logo.dev resolution failed for ${cacheKey}:`, error?.message);
      Cache.setError(cacheKey, { type: 'error', provider: 'logo-dev', sourceKey: cacheKey });
    }
  }

  // ── Local deterministic fallback ────────────────────────────────────
  return buildFallbackResult(identity, identity.symbol, getFallbackTypeClass(identity), cacheKey);
}

// ---------------------------------------------------------------------------
// Local deterministic fallback (spec §46, §47)
// ---------------------------------------------------------------------------
function buildFallbackResult(identity, label, fallbackType, sourceKey) {
  return {
    type: 'fallback',
    provider: 'fallback',
    fallbackType: fallbackType || 'unknown',
    initials: identity ? getFallbackInitials(identity) : (label ? getFallbackInitials(label) : '?'),
    sourceKey,
  };
}

// ---------------------------------------------------------------------------
// Cache result appropriately based on type
// ---------------------------------------------------------------------------
function cacheResult(cacheKey, result) {
  if (!cacheKey) return;
  if (result.type === 'remote' && result.provider) {
    Cache.setSuccess(cacheKey, result);
  } else if (result.type === 'fallback') {
    // Don't cache fallbacks permanently — they may resolve later
    // But cache briefly to avoid repeated failed lookups on every render
    Cache.setMiss(cacheKey, result);
  }
}

// ---------------------------------------------------------------------------
// Utility: timeout wrapper
// ---------------------------------------------------------------------------
function withTimeout(promise, timeoutMs) {
  if (!timeoutMs || timeoutMs === Infinity) return promise;

  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Provider timeout')), timeoutMs);
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
module.exports = {
  resolveAssetIcon,
  toCanonicalAssetIdentity,
  buildCacheKey,
  ASSET_TYPES,
  // Expose for configuration introspection (used by routes.js)
  getProviderStatus: () => {
    const { vectorUpProvider, logoDevProvider } = getProviders();
    return {
      vectorup: {
        configured: vectorUpProvider.isConfigured,
        providerName: 'vectorup',
      },
      logoDev: {
        configured: logoDevProvider.isConfigured,
        providerName: 'logo-dev',
      },
    };
  },
  // Allow runtime provider reconfiguration (for testing)
  __setProviders: (vu, ld) => {
    vectorUpProvider = vu;
    logoDevProvider = ld;
  },
  // Clear cache (for testing/admin)
  cache: Cache,
};
