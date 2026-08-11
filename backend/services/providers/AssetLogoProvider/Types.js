// services/providers/AssetLogoProvider/Types.js
// Canonical types for the asset icon resolution system.
// These mirror the TypeScript interfaces in the implementation spec (section 9, 22, 23).

/**
 * @typedef {Object} CanonicalAssetIdentity
 * @property {string} [assetId]
 * @property {string} [symbol]
 * @property {string} [name]
 * @property {string} [assetType]
 * @property {string} [kind]
 * @property {string} [exchange]
 * @property {string} [currency]
 * @property {string} [isin]
 * @property {string} [cusip]
 * @property {string} [figi]
 * @property {string} [provider]
 * @property {string} [providerAssetId]
 * @property {string} [domain]
 * @property {string} [coinId]
 * @property {string} [chain]
 * @property {string} [contractAddress]
 * @property {string} [underlyingSymbol]
 * @property {string} [underlyingAssetId]
 */

/**
 * @typedef {Object} LogoResolution
 * @property {"vectorup"|"logo-dev"|"fallback"} provider
 * @property {string} [url]
 * @property {"svg"|"png"|"webp"|"jpg"} [format]
 * @property {"high"|"medium"|"low"} [confidence]
 * @property {string} [sourceKey]
 * @property {string} [resolvedAt]
 * @property {boolean} [cached]
 */

/**
 * @typedef {Object} ResolvedIcon
 * @property {"remote"|"fallback"} type
 * @property {string} [url]
 * @property {string} fallbackType
 * @property {string} initials
 * @property {"vectorup"|"logo-dev"|"fallback"} [provider]
 * @property {boolean} [cached]
 */

const ASSET_TYPES = {
  EQUITY: 'equity',
  ETF: 'etf',
  CRYPTO: 'crypto',
  COMMODITY: 'commodity',
  OPTION: 'option',
  FOREX: 'forex',
  CURRENCY: 'currency',
  MACRO: 'macro',
  INDICATOR: 'indicator',
  BOND: 'bond',
  FUND: 'fund',
  INDEX: 'index',
  UNKNOWN: 'unknown',
};

module.exports = { ASSET_TYPES };
