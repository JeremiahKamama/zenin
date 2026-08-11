// utils/assetIconResolver.js
// Central Asset Icon Resolver — the SINGLE canonical path for resolving
// asset icon information. No UI component should construct provider URLs.
//
// Architecture:
//   CanonicalAssetIdentity → resolveAssetIcon() → { type, url?, fallbackType, initials }
//
// AssetLogo.jsx is the shared rendering component.
// This module is responsible for:
//   1. Normalizing asset types to the canonical vocabulary
//   2. Choosing the correct logo provider path
//   3. Generating deterministic fallback initials
//   4. Determining fallback type-class for CSS lettermark coloring

// ---------------------------------------------------------------------------
// Canonical asset type vocabulary
// ---------------------------------------------------------------------------
export const ASSET_TYPES = {
  EQUITY: "equity",
  ETF: "etf",
  CRYPTO: "crypto",
  COMMODITY: "commodity",
  OPTION: "option",
  FOREX: "forex",
  CURRENCY: "currency",
  MACRO: "macro",
  INDICATOR: "indicator",
  BOND: "bond",
  FUND: "fund",
  INDEX: "index",
  UNKNOWN: "unknown",
};

// ---------------------------------------------------------------------------
// Type normalization — maps the many raw type representations in the codebase
// to the canonical vocabulary. This is the single place that logic lives.
// ---------------------------------------------------------------------------
const TYPE_ALIASES = {
  // Equities
  stock: ASSET_TYPES.EQUITY,
  equity: ASSET_TYPES.EQUITY,
  shares: ASSET_TYPES.EQUITY,
  "us stock": ASSET_TYPES.EQUITY,
  "us equity": ASSET_TYPES.EQUITY,
  // ETFs
  etf: ASSET_TYPES.ETF,
  etfs: ASSET_TYPES.ETF,
  "exchange traded fund": ASSET_TYPES.ETF,
  "exchange-traded fund": ASSET_TYPES.ETF,
  // Crypto
  crypto: ASSET_TYPES.CRYPTO,
  cryptocurrency: ASSET_TYPES.CRYPTO,
  coin: ASSET_TYPES.CRYPTO,
  token: ASSET_TYPES.CRYPTO,
  "exchange token": ASSET_TYPES.CRYPTO,
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
  "fx-pair": ASSET_TYPES.FOREX,
  "currency pair": ASSET_TYPES.FOREX,
  // Currency codes (macro research entity)
  currency: ASSET_TYPES.CURRENCY,
  "currency-code": ASSET_TYPES.CURRENCY,
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

export function normalizeAssetType(rawType) {
  if (!rawType || typeof rawType !== "string") return ASSET_TYPES.UNKNOWN;
  const key = rawType.trim().toLowerCase();
  return TYPE_ALIASES[key] || ASSET_TYPES.UNKNOWN;
}

// ---------------------------------------------------------------------------
// Crypto detection — used because crypto symbols often lack dots/slashes
// but are explicitly marked as crypto via type.
// ---------------------------------------------------------------------------
export function isCryptoType(asset) {
  const t = normalizeAssetType(asset?.type || asset?.assetType || asset?.instrumentType);
  if (t === ASSET_TYPES.CRYPTO) return true;
  // Also check raw type strings that map to crypto
  const raw = String(asset?.type || asset?.assetType || asset?.instrumentType || "").toLowerCase();
  return ["crypto", "cryptocurrency", "coin", "token", "spot", "perp", "perpetual", "exchange token"].includes(raw);
}

// ---------------------------------------------------------------------------
// Canonical asset identity normalization
//
// Accepts many object shapes (portfolio position, watchlist entry,
// transaction, order, raw reference data) and produces a canonical identity.
// ---------------------------------------------------------------------------
export function toCanonicalAssetIdentity(asset) {
  if (!asset || typeof asset !== "object") return null;

  const rawType = asset.type || asset.assetType || asset.instrumentType || asset.marketType || "";
  const normalizedType = normalizeAssetType(rawType) || ASSET_TYPES.UNKNOWN;

  // Crypto detection may override when the raw type is ambiguous
  const isCrypto = isCryptoType(asset);
  const kind = isCrypto ? ASSET_TYPES.CRYPTO : normalizedType;

  // Derive symbol: prefer symbol > ticker > name > instrumentKey
  const symbol = String(
    asset.symbol || asset.ticker || asset.instrumentKey || asset.contractSymbol || ""
  ).trim();

  // For derivatives, extract the underlying symbol from options-like symbols
  // e.g. "NVDA250117C00120000" → underlying "NVDA"
  let underlyingSymbol = symbol;
  if (kind === ASSET_TYPES.OPTION && symbol) {
    // Options symbols like NVDA250117C00120000 or AAPL 2024-01-19 150.00 C
    const match = symbol.match(/^([A-Z]{1,5})\d{6}[CP]/i) || symbol.match(/^([A-Z]{1,5})\s\d{4}/i);
    if (match) underlyingSymbol = match[1].toUpperCase();
  }

  // Name / company name
  const name = String(asset.name || asset.companyName || asset.label || "");

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
    // Security identifiers
    isin: asset.isin || null,
    cusip: asset.cusip || null,
    figi: asset.figi || asset.figiId || null,
    // Provider identifiers
    provider: asset.provider || null,
    providerAssetId: asset.providerAssetId || asset.externalId || null,
    // Crypto
    chain,
    contractAddress,
    coinId,
    // Derivatives
    underlyingSymbol: kind === ASSET_TYPES.OPTION && underlyingSymbol !== symbol ? underlyingSymbol : (asset.underlyingSymbol || asset.underlying || null),
    underlyingAssetId: asset.underlyingAssetId || null,
  };
}

// ---------------------------------------------------------------------------
// logo.dev configuration
// ---------------------------------------------------------------------------
const LOGO_DEV_TOKEN = "pk_DUGROay4TPGqK6AMX8PPFQ";
const LOGO_DEV_BASE = "https://img.logo.dev";
const LOGO_DEV_PARAMS = {
  token: LOGO_DEV_TOKEN,
  size: "128",
  theme: "dark",
  greyscale: "true",
  fallback: "404",
};

// Symbols that are known to NOT resolve via logo.dev ticker mode
// and should skip the provider entirely (go straight to fallback).
const NO_LOGO_SYMBOLS = new Set([
  "SPY", "VOO", "IVV", "VTI", "QQQ", "IWM", "VEA", "VWO", "AGG", "TLT",
  "GLD", "SLV", "ARKK", "EEM", "KWEB",
  // These resolve but are commonly tested
]);

// ---------------------------------------------------------------------------
// Logo URL generation — the ONLY place provider URLs are constructed.
// ---------------------------------------------------------------------------
export function getLogoUrl(assetOrSymbol, type) {
  const identity = typeof assetOrSymbol === "string"
    ? toCanonicalAssetIdentity({ symbol: assetOrSymbol, type })
    : toCanonicalAssetIdentity(assetOrSymbol);

  if (!identity?.symbol) return null;

  // Crypto uses the crypto path; everything else uses ticker path.
  const mode = identity.kind === ASSET_TYPES.CRYPTO ? "crypto" : "ticker";

  // For options, resolve the underlying asset symbol, not the option contract.
  const symbol = identity.kind === ASSET_TYPES.OPTION
    ? (identity.underlyingSymbol || identity.symbol)
    : identity.symbol;

  const params = new URLSearchParams(LOGO_DEV_PARAMS);
  return `${LOGO_DEV_BASE}/${mode}/${encodeURIComponent(symbol)}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Deterministic fallback initials generation
// ---------------------------------------------------------------------------
export function getFallbackInitials(assetOrSymbol, type) {
  if (typeof assetOrSymbol === "string") {
    return String(assetOrSymbol || "").trim().slice(0, 2).toUpperCase() || "?";
  }
  const identity = toCanonicalAssetIdentity(assetOrSymbol);
  // Prefer name's initials, then symbol's, then type's
  const source = identity?.name || identity?.symbol || type || "asset";
  return String(source || "").trim().slice(0, 2).toUpperCase() || "?";
}

// ---------------------------------------------------------------------------
// Fallback type for CSS class
// ---------------------------------------------------------------------------
export function getFallbackTypeClass(assetOrType) {
  let rawType = assetOrType;
  if (typeof assetOrType === "object" && assetOrType !== null) {
    rawType = assetOrType.type || assetOrType.assetType || assetOrType.instrumentType || "";
  }
  const normalized = normalizeAssetType(rawType);

  // Map to CSS class names used in styles.css
  const CSS_CLASS_MAP = {
    [ASSET_TYPES.EQUITY]: "equity",
    [ASSET_TYPES.ETF]: "etf",
    [ASSET_TYPES.CRYPTO]: "crypto",
    [ASSET_TYPES.COMMODITY]: "commodity",
    [ASSET_TYPES.OPTION]: "option",
    [ASSET_TYPES.FOREX]: "forex",
    [ASSET_TYPES.CURRENCY]: "currency",
    [ASSET_TYPES.MACRO]: "macro",
    [ASSET_TYPES.INDICATOR]: "indicator",
    [ASSET_TYPES.BOND]: "bond",
    [ASSET_TYPES.FUND]: "fund",
    [ASSET_TYPES.INDEX]: "index",
  };

  return CSS_CLASS_MAP[normalized] || "unknown";
}

// ---------------------------------------------------------------------------
// Main resolution function — the canonical entry point.
// Returns a normalized object describing what to render.
// ---------------------------------------------------------------------------
export function resolveAssetIcon(asset) {
  const identity = toCanonicalAssetIdentity(asset);
  if (!identity) {
    return {
      type: "fallback",
      fallbackType: "unknown",
      initials: "?",
      url: null,
    };
  }

  const url = getLogoUrl(identity);
  const fallbackType = getFallbackTypeClass(identity.kind);
  const initials = getFallbackInitials(identity, identity.kind);

  if (url) {
    return {
      type: "remote",
      url,
      fallbackType,
      initials,
    };
  }

  return {
    type: "fallback",
    fallbackType,
    initials,
  };
}

export default resolveAssetIcon;
