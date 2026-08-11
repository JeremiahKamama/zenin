// services/providers/AssetLogoProvider/index.js
// Public interface for the Asset Logo Provider module.
// Re-exports the resolver, types, and route registration.

const { resolveAssetIcon, toCanonicalAssetIdentity, buildCacheKey, ASSET_TYPES, getProviderStatus, cache } = require('./Provider');
const { registerAssetLogoRoutes, router } = require('./routes');

module.exports = {
  resolveAssetIcon,
  toCanonicalAssetIdentity,
  buildCacheKey,
  ASSET_TYPES,
  getProviderStatus,
  registerAssetLogoRoutes,
  router,
  cache,
};
