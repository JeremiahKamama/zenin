// services/providers/AssetLogoProvider/Normalizer.js
// Canonical asset identity normalization and cache-key generation.
//
// This module is the single place where asset identity normalization happens.
// It accepts many object shapes (portfolio position, watchlist entry,
// transaction, order, raw reference data) and produces a canonical identity
// suitable for cache key generation and provider resolution.
//
// Spec: §9 Canonical Asset Identity, §11 Asset Type Normalization,
//      §28 Cache Key, §29 Cache Normalization, §76-80 Normalization rules.

const { ASSET_TYPES } = require('./Types');

// ---------------------------------------------------------------------------
// Type normalization — maps the many raw type representations in the codebase
// to the canonical vocabulary.
// ---------------------------------------------------------------------------
const TYPE_ALIASES = {
  // Equities
  stock: ASSET_TYPES.EQUITY,
  equity: ASSET_TYPES.EQUITY,
  shares: ASSET_TYPES.EQUITY,
  'us stock': ASSET_TYPES.EQUITY,
  'us equity': ASSET_TYPES.EQUITY,
  // ETFs
  etf: ASSET_TYPES.ETF,
  etfs: ASSET_TYPES.ETF,
  'exchange traded fund': ASSET_TYPES.ETF,
  'exchange-traded fund': ASSET_TYPES.ETF,
  // Crypto
  crypto: ASSET_TYPES.CRYPTO,
  cryptocurrency: ASSET_TYPES.CRYPTO,
  coin: ASSET_TYPES.CRYPTO,
  token: ASSET_TYPES.CRYPTO,
  'exchange token': ASSET_TYPES.CRYPTO,
  spot: ASSET_TYPES.CRYPTO,
  perp: ASSET_TYPES.CRYPTO,
  perpetual: ASSET_TYPES.CRYPTO,
  // Commodities
  commodity: ASSET_TYPES.COMMODITY,
  commodities: ASSET_TYPES.COMMODITY,
  future: ASSET_TYPES.COMMODITY,
  futures: ASSET_TYPES.COMMODITY,
  // Options
  option: ASSET_TYPES.OPTION,
  options: ASSET_TYPES.OPTION,
  // Forex / FX
  forex: ASSET_TYPES.FOREX,
  fx: ASSET_TYPES.FOREX,
  'fx-pair': ASSET_TYPES.FOREX,
  'currency pair': ASSET_TYPES.FOREX,
  // Currency codes
  currency: ASSET_TYPES.CURRENCY,
  'currency-code': ASSET_TYPES.CURRENCY,
  // Macro / indicators
  macro: ASSET_TYPES.MACRO,
  indicator: ASSET_TYPES.INDICATOR,
  // Bonds / funds / indices
  bond: ASSET_TYPES.BOND,
  bonds: ASSET_TYPES.BOND,
  fund: ASSET_TYPES.FUND,
  funds: ASSET_TYPES.FUND,
  index: ASSET_TYPES.INDEX,
  indexes: ASSET_TYPES.INDEX,
  indices: ASSET_TYPES.INDEX,
};

function normalizeAssetType(rawType) {
  if (!rawType || typeof rawType !== 'string') return ASSET_TYPES.UNKNOWN;
  const key = rawType.trim().toLowerCase();
  return TYPE_ALIASES[key] || ASSET_TYPES.UNKNOWN;
}

// ---------------------------------------------------------------------------
// Crypto detection — used because crypto symbols often lack dots/slashes
// but are explicitly marked as crypto via type.
// ---------------------------------------------------------------------------
function isCryptoType(asset) {
  if (!asset) return false;
  const t = normalizeAssetType(asset.type || asset.assetType || asset.instrumentType || asset.kind);
  if (t === ASSET_TYPES.CRYPTO) return true;
  const raw = String(asset.type || asset.assetType || asset.instrumentType || asset.kind || '').toLowerCase();
  return ['crypto', 'cryptocurrency', 'coin', 'token', 'spot', 'perp', 'perpetual', 'exchange token'].includes(raw);
}

// ---------------------------------------------------------------------------
// Symbol normalization (§76): uppercase, trim, strip exchange suffixes
// for the *cache key* only — original symbol is preserved for display.
// ---------------------------------------------------------------------------
function normalizeSymbolForCache(symbol) {
  if (!symbol) return '';
  // Uppercase and trim. We do NOT strip exchange suffixes here because they
  // are part of the cache key (e.g., "NASDAQ:NVDA" vs "NVDA" vs "NVDA.TO").
  return String(symbol).trim().toUpperCase();
}

// ---------------------------------------------------------------------------
// Exchange normalization (§77): lowercase, trim for cache key.
// Preserve original for display.
// ---------------------------------------------------------------------------
function normalizeExchangeForCache(exchange) {
  if (!exchange) return null;
  const e = String(exchange).trim().toUpperCase();
  if (!e) return null;
  // Normalize common exchange name variants
  const exchangeMap = {
    'NASDAQ GLOBAL SELECT': 'NASDAQ',
    'NYSE ARCA': 'NYSE',
    'NYSE AMERICAN': 'NYSEAM',
    'CSE': 'CSE',
  };
  return exchangeMap[e] || e;
}

// ---------------------------------------------------------------------------
// ISIN normalization (§78): trim, uppercase.
// ---------------------------------------------------------------------------
function normalizeIsinForCache(isin) {
  if (!isin) return null;
  const s = String(isin).trim().toUpperCase();
  // Basic ISIN validation: 2 letters + 9 digits + 1 check digit = 12 chars
  if (/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(s)) return s;
  return null;
}

// ---------------------------------------------------------------------------
// Domain normalization (§80): lowercase, strip protocol, strip www, strip trailing slash.
// ---------------------------------------------------------------------------
function normalizeDomainForCache(domain) {
  if (!domain) return null;
  let d = String(domain).trim().toLowerCase();
  d = d.replace(/^https?:\/\//, '');
  d = d.replace(/^www\./, '');
  d = d.replace(/\/+$/, '');
  // Validate: must look like a domain
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  return d;
}

// ---------------------------------------------------------------------------
// Crypto contract address normalization (§79):
//   - For EVM chains, normalize to lowercase (checksum is display-only)
//   - Include chain in the key so same address on different chains = different asset
// ---------------------------------------------------------------------------
function normalizeContractAddressForCache(address) {
  if (!address) return null;
  return String(address).trim().toLowerCase();
}

function normalizeChainForCache(chain) {
  if (!chain) return null;
  return String(chain).trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Canonical asset identity normalization (§9)
// ---------------------------------------------------------------------------
function toCanonicalAssetIdentity(asset) {
  if (!asset || typeof asset !== 'object') return null;

  const rawType = asset.type || asset.assetType || asset.instrumentType || asset.kind || asset.marketType || '';
  const normalizedType = normalizeAssetType(rawType) || ASSET_TYPES.UNKNOWN;

  // Crypto detection may override when the raw type is ambiguous
  const isCrypto = isCryptoType(asset);
  const kind = isCrypto ? ASSET_TYPES.CRYPTO : normalizedType;

  // Derive symbol: prefer symbol > ticker > name > instrumentKey
  const symbol = String(
    asset.symbol || asset.ticker || asset.instrumentKey || asset.contractSymbol || ''
  ).trim();

  // For derivatives, extract the underlying symbol from options-like symbols
  // e.g. "NVDA250117C00120000" → underlying "NVDA"
  let underlyingSymbol = symbol;
  if (kind === ASSET_TYPES.OPTION && symbol) {
    const match = symbol.match(/^([A-Z]{1,5})\d{6}[CP]/i) || symbol.match(/^([A-Z]{1,5})\s\d{4}/i);
    if (match) underlyingSymbol = match[1].toUpperCase();
  }

  const name = String(asset.name || asset.companyName || asset.label || '');

  // Crypto-specific fields
  const chain = asset.chain || null;
  const contractAddress = asset.contractAddress || asset.address || asset.contract_address || null;
  const coinId = asset.coinId || asset.coin_id || asset.id || null;

  return {
    symbol,
    name,
    kind,
    type: kind,
    assetType: kind,
    instrumentType: rawType ? String(rawType).toLowerCase() : undefined,
    exchange: asset.exchange || asset.market || null,
    currency: asset.currency || null,
    isin: asset.isin || null,
    cusip: asset.cusip || null,
    figi: asset.figi || asset.figiId || null,
    provider: asset.provider || null,
    providerAssetId: asset.providerAssetId || asset.externalId || null,
    domain: asset.domain || null,
    // Crypto
    chain,
    contractAddress,
    coinId,
    // Derivatives
    underlyingSymbol: kind === ASSET_TYPES.OPTION && underlyingSymbol !== symbol
      ? underlyingSymbol
      : (asset.underlyingSymbol || asset.underlying || null),
    underlyingAssetId: asset.underlyingAssetId || null,
  };
}

// ---------------------------------------------------------------------------
// Cache key generation (§28)
// ---------------------------------------------------------------------------
function buildCacheKey(identity) {
  if (!identity) return null;

  // Priority order for cache key (strongest identifier first, spec §12):
  // 1. ISIN
  // 2. CUSIP
  // 3. FIGI
  // 4. crypto: chain + contractAddress
  // 5. crypto: coinId
  // 6. exchange + symbol
  // 7. symbol
  // 8. domain

  const isin = normalizeIsinForCache(identity.isin);
  if (isin) return `isin:${isin}`;

  const cusip = identity.cusip ? String(identity.cusip).trim().toUpperCase() : null;
  if (cusip) return `cusip:${cusip}`;

  const figi = identity.figi ? String(identity.figi).trim().toUpperCase() : null;
  if (figi) return `figi:${figi}`;

  // Crypto: chain + contractAddress preferred
  if (identity.kind === ASSET_TYPES.CRYPTO) {
    const chain = normalizeChainForCache(identity.chain);
    const addr = normalizeContractAddressForCache(identity.contractAddress);
    if (chain && addr) return `crypto:${chain}:${addr}`;
    if (addr) return `crypto:token:${addr}`;
    const coinId = identity.coinId ? String(identity.coinId).trim().toLowerCase() : null;
    if (coinId) return `crypto:coinId:${coinId}`;
    // Fall through to symbol-based crypto key
  }

  const symbol = normalizeSymbolForCache(identity.symbol);
  if (symbol) {
    const exchange = normalizeExchangeForCache(identity.exchange);
    if (exchange) return `ticker:${exchange}:${symbol}`;
    return `ticker:${symbol}`;
  }

  const domain = normalizeDomainForCache(identity.domain);
  if (domain) return `domain:${domain}`;

  // Fallback: name-based (very weak identity)
  const name = String(identity.name || '').trim();
  if (name) return `name:${name.toLowerCase()}`;

  return null;
}

// ---------------------------------------------------------------------------
// Deterministic fallback initials (§47)
// ---------------------------------------------------------------------------
function getFallbackInitials(identityOrAsset) {
  if (!identityOrAsset) return '?';
  // Handle string input (e.g., just a symbol)
  if (typeof identityOrAsset === 'string') {
    return String(identityOrAsset || '').trim().slice(0, 2).toUpperCase() || '?';
  }
  // Prefer name's initials, then symbol's, then type's
  const source = identityOrAsset.name || identityOrAsset.symbol || identityOrAsset.kind || 'asset';
  return String(source || '').trim().slice(0, 2).toUpperCase() || '?';
}

// ---------------------------------------------------------------------------
// Fallback type for CSS class
// ---------------------------------------------------------------------------
const CSS_CLASS_MAP = {
  [ASSET_TYPES.EQUITY]: 'equity',
  [ASSET_TYPES.ETF]: 'etf',
  [ASSET_TYPES.CRYPTO]: 'crypto',
  [ASSET_TYPES.COMMODITY]: 'commodity',
  [ASSET_TYPES.OPTION]: 'option',
  [ASSET_TYPES.FOREX]: 'forex',
  [ASSET_TYPES.CURRENCY]: 'currency',
  [ASSET_TYPES.MACRO]: 'macro',
  [ASSET_TYPES.INDICATOR]: 'indicator',
  [ASSET_TYPES.BOND]: 'bond',
  [ASSET_TYPES.FUND]: 'fund',
  [ASSET_TYPES.INDEX]: 'index',
};

function getFallbackTypeClass(assetOrType) {
  let rawType = assetOrType;
  if (typeof assetOrType === 'object' && assetOrType !== null) {
    rawType = assetOrType.kind || assetOrType.type || assetOrType.assetType || assetOrType.instrumentType || '';
  }
  const normalized = normalizeAssetType(rawType);
  return CSS_CLASS_MAP[normalized] || 'unknown';
}

module.exports = {
  ASSET_TYPES,
  normalizeAssetType,
  isCryptoType,
  normalizeSymbolForCache,
  normalizeExchangeForCache,
  normalizeIsinForCache,
  normalizeDomainForCache,
  normalizeContractAddressForCache,
  normalizeChainForCache,
  toCanonicalAssetIdentity,
  buildCacheKey,
  getFallbackInitials,
  getFallbackTypeClass,
};
