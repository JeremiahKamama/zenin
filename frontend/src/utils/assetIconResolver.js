// utils/assetIconResolver.js
// Central Asset Icon Resolver — the SINGLE canonical path for resolving
// asset icon information. No UI component should construct provider URLs.
//
// Architecture (spec §81, §147):
//   CanonicalAssetIdentity → resolveAssetIcon() → { type, url?, fallbackType, initials }
//
// The backend resolver (/api/asset-logo/resolve) implements the full
// provider hierarchy: Cache → VectorUp (primary) → Logo.dev (fallback) → local.
// The frontend calls this API via zeninFetch.
//
// If the backend cannot be reached (offline/dev mode), a client-side
// logo.dev fallback is used with the PUBLISHABLE key from env config.
// The VectorUp token is NEVER exposed to the frontend.
//
// Docs: https://www.logo.dev/docs/logo-images/introduction
//       https://vectorup.dev/docs/api-reference/logo

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";
import { zeninFetchJson } from "./zeninFetch";

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

export function normalizeAssetType(rawType) {
  const TYPE_ALIASES = {
    stock: ASSET_TYPES.EQUITY,
    equity: ASSET_TYPES.EQUITY,
    shares: ASSET_TYPES.EQUITY,
    "us stock": ASSET_TYPES.EQUITY,
    "us equity": ASSET_TYPES.EQUITY,
    etf: ASSET_TYPES.ETF,
    etfs: ASSET_TYPES.ETF,
    "exchange traded fund": ASSET_TYPES.ETF,
    "exchange-traded fund": ASSET_TYPES.ETF,
    crypto: ASSET_TYPES.CRYPTO,
    cryptocurrency: ASSET_TYPES.CRYPTO,
    coin: ASSET_TYPES.CRYPTO,
    token: ASSET_TYPES.CRYPTO,
    "exchange token": ASSET_TYPES.CRYPTO,
    spot: ASSET_TYPES.CRYPTO,
    perp: ASSET_TYPES.CRYPTO,
    perpetual: ASSET_TYPES.CRYPTO,
    commodity: ASSET_TYPES.COMMODITY,
    commodities: ASSET_TYPES.COMMODITY,
    future: ASSET_TYPES.COMMODITY,
    futures: ASSET_TYPES.COMMODITY,
    option: ASSET_TYPES.OPTION,
    options: ASSET_TYPES.OPTION,
    forex: ASSET_TYPES.FOREX,
    fx: ASSET_TYPES.FOREX,
    "fx-pair": ASSET_TYPES.FOREX,
    "currency pair": ASSET_TYPES.FOREX,
    currency: ASSET_TYPES.CURRENCY,
    "currency-code": ASSET_TYPES.CURRENCY,
    macro: ASSET_TYPES.MACRO,
    indicator: ASSET_TYPES.INDICATOR,
    bond: ASSET_TYPES.BOND,
    bonds: ASSET_TYPES.BOND,
    fund: ASSET_TYPES.FUND,
    funds: ASSET_TYPES.FUND,
    index: ASSET_TYPES.INDEX,
    indexes: ASSET_TYPES.INDEX,
    indices: ASSET_TYPES.INDEX,
  };

  if (!rawType || typeof rawType !== "string") return ASSET_TYPES.UNKNOWN;
  const key = rawType.trim().toLowerCase();
  return TYPE_ALIASES[key] || ASSET_TYPES.UNKNOWN;
}

export function isCryptoType(asset) {
  const t = normalizeAssetType(asset?.type || asset?.assetType || asset?.instrumentType);
  if (t === ASSET_TYPES.CRYPTO) return true;
  const raw = String(asset?.type || asset?.assetType || asset?.instrumentType || "").toLowerCase();
  return ["crypto", "cryptocurrency", "coin", "token", "spot", "perp", "perpetual", "exchange token"].includes(raw);
}

export function toCanonicalAssetIdentity(asset) {
  if (!asset || typeof asset !== "object") return null;

  const rawType = asset.type || asset.assetType || asset.instrumentType || "";
  const normalizedType = normalizeAssetType(rawType) || ASSET_TYPES.UNKNOWN;
  const isCrypto = isCryptoType(asset);
  const kind = isCrypto ? ASSET_TYPES.CRYPTO : normalizedType;

  const symbol = String(
    asset.symbol || asset.ticker || asset.instrumentKey || asset.contractSymbol || ""
  ).trim();

  let underlyingSymbol = symbol;
  if (kind === ASSET_TYPES.OPTION && symbol) {
    const match = symbol.match(/^([A-Z]{1,5})\d{6}[CP]/i) || symbol.match(/^([A-Z]{1,5})\s\d{4}/i);
    if (match) underlyingSymbol = match[1].toUpperCase();
  }

  const name = String(asset.name || asset.companyName || asset.label || "");

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
    chain,
    contractAddress,
    coinId,
    underlyingSymbol:
      kind === ASSET_TYPES.OPTION && underlyingSymbol !== symbol
        ? underlyingSymbol
        : (asset.underlyingSymbol || asset.underlying || null),
    underlyingAssetId: asset.underlyingAssetId || null,
  };
}

// ---------------------------------------------------------------------------
// Fallback initials and type class (deterministic, used when no logo resolves)
// ---------------------------------------------------------------------------
export function getFallbackInitials(assetOrSymbol, type) {
  if (typeof assetOrSymbol === "string") {
    return String(assetOrSymbol || "").trim().slice(0, 2).toUpperCase() || "?";
  }
  const identity = toCanonicalAssetIdentity(assetOrSymbol);
  const source = identity?.name || identity?.symbol || type || "asset";
  return String(source || "").trim().slice(0, 2).toUpperCase() || "?";
}

export function getFallbackTypeClass(assetOrType) {
  let rawType = assetOrType;
  if (typeof assetOrType === "object" && assetOrType !== null) {
    rawType = assetOrType.type || assetOrType.assetType || assetOrType.instrumentType || "";
  }
  const normalized = normalizeAssetType(rawType);

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
// Client-side logo.dev fallback URL (only used when backend is unreachable).
// The publishable key (pk_) is loaded from the backend public runtime config
// via /api/public/config — NOT hardcoded in source. VectorUp's token is NEVER
// exposed to the frontend.
//
// In production, the backend resolver (/api/asset-logo/resolve) always wins.
// This client-side logo.dev path is a dev/offline-only fallback.
// ---------------------------------------------------------------------------
let _logoDevConfig = null;
let _configPromise = null;

function loadLogoDevConfig() {
  if (_logoDevConfig !== null) return _logoDevConfig;
  // Synchronously available from import.meta.env (for dev builds where
  // VITE_LOGO_DEV_PUBLISHABLE_KEY is set), or null if not configured.
  const token = String(
    (typeof import.meta !== "undefined" &&
      import.meta.env &&
      import.meta.env.VITE_LOGO_DEV_PUBLISHABLE_KEY) ||
      ""
  ).trim();
  _logoDevConfig = {
    token,
    size: String(
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_LOGO_DEV_IMAGE_SIZE) ||
        "128"
    ),
    format: String(
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_LOGO_DEV_IMAGE_FORMAT) ||
        "webp"
    ),
    theme: String(
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_LOGO_DEV_IMAGE_THEME) ||
        "dark"
    ),
    greyscale: String(
      (typeof import.meta !== "undefined" &&
        import.meta.env &&
        import.meta.env.VITE_LOGO_DEV_GREYSCALE) ||
        "true"
    ),
  };
  return _logoDevConfig;
}

// Fetch logo.dev config from backend public config (preferred source).
async function fetchLogoDevConfigFromBackend() {
  if (_logoDevConfig !== null && _logoDevConfig.token) return _logoDevConfig;
  if (_configPromise !== null) return _configPromise;

  _configPromise = zeninFetchJson("/api/public/config", { timeoutMs: 5000 })
    .then((response) => {
      const assetLogo = response?.publicConfig?.assetLogo;
      if (assetLogo?.logoDevPublishableKey) {
        _logoDevConfig = {
          token: assetLogo.logoDevPublishableKey,
          size: assetLogo.logoDevImageSize || "128",
          format: assetLogo.logoDevImageFormat || "webp",
          theme: assetLogo.logoDevImageTheme || "dark",
          greyscale: String(assetLogo.logoDevGreyscale !== false),
        };
      }
      return _logoDevConfig;
    })
    .catch(() => {
      // Backend unreachable — fall back to env-var config (if any)
      return _logoDevConfig || loadLogoDevConfig();
    });

  const config = await _configPromise;
  return config;
}

export function getLogoUrl(assetOrSymbol, type) {
  const config = loadLogoDevConfig();
  if (!config.token) return null;

  const identity =
    typeof assetOrSymbol === "string"
      ? toCanonicalAssetIdentity({ symbol: assetOrSymbol, type })
      : toCanonicalAssetIdentity(assetOrSymbol);

  if (!identity?.symbol) return null;

  const mode = identity.kind === ASSET_TYPES.CRYPTO ? "crypto" : "ticker";
  const symbol =
    identity.kind === ASSET_TYPES.OPTION
      ? identity.underlyingSymbol || identity.symbol
      : identity.symbol;

  const params = new URLSearchParams({
    token: config.token,
    size: config.size,
    theme: config.theme,
    greyscale: config.greyscale,
    fallback: "404",
  });
  return `https://img.logo.dev/${mode}/${encodeURIComponent(symbol)}?${params.toString()}`;
}

// Async version of getLogoUrl that fetches config from backend first.
export async function getLogoUrlAsync(assetOrSymbol, type) {
  const config = await fetchLogoDevConfigFromBackend();
  if (!config?.token) return null;

  const identity =
    typeof assetOrSymbol === "string"
      ? toCanonicalAssetIdentity({ symbol: assetOrSymbol, type })
      : toCanonicalAssetIdentity(assetOrSymbol);

  if (!identity?.symbol) return null;

  const mode = identity.kind === ASSET_TYPES.CRYPTO ? "crypto" : "ticker";
  const symbol =
    identity.kind === ASSET_TYPES.OPTION
      ? identity.underlyingSymbol || identity.symbol
      : identity.symbol;

  const params = new URLSearchParams({
    token: config.token,
    size: config.size,
    theme: config.theme,
    greyscale: config.greyscale,
    fallback: "404",
  });
  return `https://img.logo.dev/${mode}/${encodeURIComponent(symbol)}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Async resolution via backend resolver API.
// The backend implements the full pipeline: Cache → VectorUp → Logo.dev → fallback.
// This function is async and must be awaited in UI components.
// ---------------------------------------------------------------------------
const _resolveCache = typeof Map !== "undefined" ? new Map() : null;

export async function resolveAssetIcon(asset, options = {}) {
  const { skipBackend = false } = options;
  const identity = toCanonicalAssetIdentity(asset);

  if (!identity) {
    return {
      type: "fallback",
      fallbackType: "unknown",
      initials: "?",
      url: null,
      provider: "fallback",
      cached: false,
    };
  }

  // Try backend resolver first (unless explicitly skipped)
  if (!skipBackend) {
    try {
      const endpoint = buildResolveEndpoint(identity);
      const result = await zeninFetchJson(endpoint, { timeoutMs: 8000 });

      if (result?.ok && result?.result) {
        const resolved = result.result;
        if (resolved.type === "remote" && resolved.url) {
          return {
            type: "remote",
            url: resolved.url,
            fallbackType: getFallbackTypeClass(identity.kind),
            initials: getFallbackInitials(identity),
            provider: resolved.provider || "vectorup",
            cached: resolved.cached || false,
          };
        }
        // Backend returned fallback — use it
        return {
          type: "fallback",
          fallbackType: resolved.fallbackType || getFallbackTypeClass(identity.kind),
          initials: resolved.initials || getFallbackInitials(identity),
          provider: "fallback",
          cached: resolved.cached || false,
        };
      }
    } catch (error) {
      // Backend unreachable or error — fall through to client-side logo.dev
      if (typeof console !== "undefined" && process.env.NODE_ENV !== "production") {
        console.warn("[AssetLogo] Backend resolver unavailable, using client-side fallback:", error?.message || error);
      }
    }
  }

  // Client-side logo.dev fallback (only if token is available)
  const url = await getLogoUrlAsync(identity);
  if (url) {
    return {
      type: "remote",
      url,
      fallbackType: getFallbackTypeClass(identity.kind),
      initials: getFallbackInitials(identity),
      provider: "logo-dev",
      cached: false,
    };
  }

  // Local deterministic fallback
  return {
    type: "fallback",
    fallbackType: getFallbackTypeClass(identity.kind),
    initials: getFallbackInitials(identity),
    provider: "fallback",
    cached: false,
  };
}

function buildResolveEndpoint(identity) {
  const params = new URLSearchParams();
  if (identity.symbol) params.set("symbol", identity.symbol);
  if (identity.type) params.set("type", identity.type);
  if (identity.exchange) params.set("exchange", identity.exchange);
  if (identity.isin) params.set("isin", identity.isin);
  if (identity.cusip) params.set("cusip", identity.cusip);
  if (identity.domain) params.set("domain", identity.domain);
  if (identity.coinId) params.set("coinId", identity.coinId);
  if (identity.chain) params.set("chain", identity.chain);
  if (identity.contractAddress) params.set("contractAddress", identity.contractAddress);

  return `${ZENIN_API_BASE_URL}/api/asset-logo/resolve?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Synchronous resolution — used by Lettermark component for immediate render.
// Returns a fallback result without provider URL (no network call).
// ---------------------------------------------------------------------------
export function resolveAssetIconSync(asset) {
  const identity = toCanonicalAssetIdentity(asset);
  if (!identity) {
    return {
      type: "fallback",
      fallbackType: "unknown",
      initials: "?",
      url: null,
      provider: "fallback",
    };
  }

  // Client-side logo.dev URL if token available
  const url = getLogoUrl(identity);
  if (url) {
    return {
      type: "remote",
      url,
      fallbackType: getFallbackTypeClass(identity.kind),
      initials: getFallbackInitials(identity),
      provider: "logo-dev",
    };
  }

  return {
    type: "fallback",
    fallbackType: getFallbackTypeClass(identity.kind),
    initials: getFallbackInitials(identity),
    provider: "fallback",
  };
}

export default resolveAssetIcon;
