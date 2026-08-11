// services/providers/AssetLogoProvider/VectorUpProvider.js
// VectorUp Logo API provider (PRIMARY provider, spec §3, §22, §25).
//
// VectorUp Logo API:
//   GET https://img.vectorup.dev/{identifier}?token=YOUR_TOKEN
//
// Identifier patterns:
//   - Domain:        /{domain}         e.g. /apple.com
//   - Ticker:        /ticker/{symbol}  e.g. /ticker/AAPL
//   - ISIN/CUSIP:    /ticker/{id}      e.g. /ticker/US0378331005
//   - Crypto:        /crypto/{symbol}  e.g. /crypto/BTC
//   - Company name:  /{name}           e.g. /McDonald's
//
// The `/ticker/` endpoint also accepts exchange-suffixed tickers like APC.DE or ROG:SW.
// If no exchange is given, US is assumed.
//
// Authentication: token as query parameter (server-side, never exposed to frontend).
// Response: 302 redirect to SVG/PNG on CDN, Cache-Control: public, max-age=31536000, immutable
// Errors: 401 (invalid token), 404 (not found), 429 (quota exceeded)
//
// Free tier: 100,000 requests/month. Free plan requires attribution link.
// Source: https://vectorup.dev/docs/api-reference/logo

const https = require('https');
const http = require('http');

const VECTORUP_IMG_BASE = 'https://img.vectorup.dev';
const VECTORUP_API_BASE = 'https://api.vectorup.dev/v1';

/**
 * @typedef {Object} VectorUpConfig
 * @property {string} apiKey - The VectorUp API token (from env, never hardcoded).
 * @property {number} [timeoutMs=10000] - Request timeout.
 */

/**
 * @param {VectorUpConfig} config
 * @returns {AssetLogoProvider}
 */
function createVectorUpProvider(config = {}) {
  const apiKey = config.apiKey || process.env.VECTORUP_API_KEY;
  const timeoutMs = config.timeoutMs || 10000;

  if (!apiKey) {
    console.warn('[AssetLogoProvider] VectorUp provider initialized without VECTORUP_API_KEY — will be bypassed.');
  }

  // Build the VectorUp logo URL for a given identifier.
  // The URL uses the img.vectorup.dev CDN endpoint which returns a 302 redirect
  // to the SVG/PNG on their CDN. We return this URL for direct <img> rendering.
  function buildLogoUrl(identifier, mode) {
    if (!apiKey) return null;
    // Encode the identifier — it can contain dots (AAPL, AAPL.DE, APC.DE),
    // slashes for exchange-separated (ROG:SW → we use the colon form),
    // and ISINs (US0378331005).
    const encoded = encodeURIComponent(identifier);

    let path;
    switch (mode) {
      case 'domain':
        path = encoded; // /apple.com
        break;
      case 'crypto':
        path = `crypto/${encoded}`; // /crypto/BTC
        break;
      case 'isin':
      case 'cusip':
      case 'ticker':
      default:
        path = `ticker/${encoded}`; // /ticker/AAPL or /ticker/US0378331005
        break;
    }

    return `${VECTORUP_IMG_BASE}/${path}?token=${encodeURIComponent(apiKey)}`;
  }

  // Validate that a provider response/URL is usable.
  // We can't easily validate a 302 redirect without fetching, so we'll
  // construct the URL and let the frontend <img onError> handle failures.
  // For server-side resolution, we return the constructed URL with confidence
  // based on the identifier strength.
  function resolve(identity) {
    if (!apiKey || !identity) return null;

    // Resolution priority within VectorUp (spec §12):
    // 1. ISIN → /ticker/{isin}
    // 2. exchange + ticker → /ticker/{exchange}:{symbol} or /ticker/{symbol}
    // 3. ticker → /ticker/{symbol}
    // 4. crypto symbol → /crypto/{symbol}
    // 5. domain → /{domain}

    const { identity: normIdentity, cacheKey } = buildNormalized(identity);

    // 1. ISIN/CUSIP — strongest identifier
    if (normIdentity.isin) {
      const url = buildLogoUrl(normIdentity.isin, 'isin');
      if (url) return { url, format: 'svg', confidence: 'high', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
    }
    if (normIdentity.cusip) {
      const url = buildLogoUrl(normIdentity.cusip, 'cusip');
      if (url) return { url, format: 'svg', confidence: 'high', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
    }

    // 2. Crypto: chain + contractAddress → use crypto endpoint with symbol or coinId
    if (normIdentity.kind === 'crypto') {
      if (normIdentity.coinId) {
        const url = buildLogoUrl(normIdentity.coinId.toLowerCase(), 'crypto');
        if (url) return { url, format: 'svg', confidence: 'medium', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
      }
      if (normIdentity.symbol) {
        const url = buildLogoUrl(normIdentity.symbol.toUpperCase(), 'crypto');
        if (url) return { url, format: 'svg', confidence: 'medium', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
      }
    }

    // 3. Exchange + ticker
    if (normIdentity.symbol && normIdentity.exchange) {
      const symbol = normalizeSymbolForUrl(normIdentity.symbol, normIdentity.exchange);
      const url = buildLogoUrl(symbol, 'ticker');
      if (url) return { url, format: 'svg', confidence: 'high', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
    }

    // 4. Ticker only
    if (normIdentity.symbol) {
      const url = buildLogoUrl(normIdentity.symbol, 'ticker');
      if (url) return { url, format: 'svg', confidence: 'high', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
    }

    // 5. Domain
    if (normIdentity.domain) {
      const domain = normalizeDomain(normIdentity.domain);
      if (domain) {
        const url = buildLogoUrl(domain, 'domain');
        if (url) return { url, format: 'svg', confidence: 'medium', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
      }
    }

    return null;
  }

  // Normalize the identity for VectorUp-specific symbol formatting.
  // VectorUp's ticker endpoint accepts exchange-suffixed tickers like AAPL.NYSE or APC.DE.
  function buildNormalized(identity) {
    const sym = identity.symbol ? String(identity.symbol).trim() : '';
    const exchange = identity.exchange ? String(identity.exchange).trim().toUpperCase() : null;
    const cacheKey = sym ? (exchange ? `${exchange}:${sym}` : sym) : null;
    return {
      identity: { ...identity, symbol: sym, exchange },
      cacheKey,
    };
  }

  function normalizeSymbolForUrl(symbol, exchange) {
    const sym = String(symbol).trim().toUpperCase();
    if (!exchange) return sym;
    const exch = exchange.trim().toUpperCase();

    // VectorUp supports exchange-suffixed tickers like APC.DE, ROG:SW, 2330.TW
    // We try common exchange suffix mappings, but for unknown ones, use the
    // colon form (e.g., NYSE:BRK.A → which VectorUp may not support, but we try)
    const exchangeSuffixMap = {
      'NYSE': '',        // US default, no suffix needed
      'NASDAQ': '',      // US default
      'NYSE ARCA': '.ARCA',
      'NYSE AMERICAN': '.AM',
      'TSE': '.T',       // Tokyo Stock Exchange
      'TSX': '.TO',      // Toronto
      'LSE': '.L',       // London
      'HKEX': '.HK',     // Hong Kong
      'KRX': '.KS',      // Korea
      'SZSE': '.SZ',     // Shenzhen
      'BSE': '.BO',      // India BSE
      'NSE': '.NS',      // India NSE
    };

    const suffix = exchangeSuffixMap[exch] || exchangeSuffixMap[exch.replace(/^THE\s+/, '')] || '';
    if (!suffix) return sym;
    return `${sym}${suffix}`;
  }

  function normalizeDomain(domain) {
    let d = String(domain).trim().toLowerCase();
    d = d.replace(/^https?:\/\//, '');
    d = d.replace(/^www\./, '');
    d = d.replace(/\/+$/, '');
    return d;
  }

  function normalizeSymbolForCache(symbol) {
    return String(symbol || '').trim().toUpperCase();
  }

  return {
    providerName: 'vectorup',
    providerId: 'vectorup',
    isConfigured: Boolean(apiKey),
    resolve,
    buildLogoUrl,
    normalizeSymbolForCache,
    normalizeDomain,
  };
}

module.exports = { createVectorUpProvider };
