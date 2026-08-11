// services/providers/AssetLogoProvider/LogoDevProvider.js
// Logo.dev fallback provider (§7, §22, §86).
//
// Logo.dev API (image CDN):
//   GET https://img.logo.dev/{mode}/{identifier}?token=PK&params
//
// Modes:
//   - ticker: https://img.logo.dev/ticker/SYMBOL?token=PK
//   - crypto: https://img.logo.dev/crypto/SYMBOL?token=PK
//   - domain: https://img.logo.dev/DOMAIN?token=PK
//
// Parameters: token (required), size, format, theme, greyscale, fallback=404
//
// Logo.dev supports two key types:
//   - pk_ (publishable): client-safe, works only with img.logo.dev
//   - sk_ (secret): server-side only, required for search/describe endpoints
//
// We use the publishable key for image URL construction. The key is loaded
// from environment configuration (LOGO_DEV_PUBLISHABLE_KEY), never hardcoded.
//
// Source: https://www.logo.dev/docs/logo-images/ticker
//         https://www.logo.dev/docs/logo-images/crypto
//         https://www.logo.dev/docs/platform/api-keys

// Exchange short-code mapping for Logo.dev
// Source: https://www.logo.dev/docs/logo-images/ticker#exchange-shortcodes
// Logo.dev uses dot-suffixed ticker symbols to specify exchanges (e.g., AZN.L for London).
const LOGO_DEV_EXCHANGE_SUFFIX = {
  // US (default — no suffix)
  NYSE: '',
  NASDAQ: '',
  'NYSE AMERICAN': '',
  CBOE: '',
  OTC: '',
  // Canada
  TSX: '.TO',
  'TSX VENTURE': '.V',
  CSE: '.CN',
  'CBOE CANADA': '.NE',
  // Mexico
  'BOLSA MEXICANA': '.MX',
  // Brazil
  'B3': '.SA',
  // Argentina
  'MERCADO CONTINUO': '.BA',
  // Chile
  'SANTIAGO': '.SN',
  // UK
  'LONDON STOCK EXCHANGE': '.L',
  'INTERNATIONAL ORDER BOOK': '.IL',
  'EPIC': '.IR',
  // France
  'EURONEXT PARIS': '.PA',
  // Netherlands
  'Euronext Amsterdam': '.AS',
  // Belgium
  'EuronEXT BRUSSELS': '.BR',
  // Portugal
  'Euronext Lisbon': '.LS',
  // Spain
  'BOLS A DE MADRID': '.MC',
  // Italy
  'BORSA ITALIANA': '.MI',
  // Germany
  XETRA: '.DE',
  'FRANKFURT': '.F',
  STUTTGART: '.SG',
  DUESSELDORF: '.DU',
  HAMBURG: '.HM',
  BERLIN: '.BE',
  MUNICH: '.MU',
  // Switzerland
  'SIX SWISS': '.SW',
  // Austria
  'WIEN': '.VI',
  // Sweden
  'NASDAQ STOCKHOLM': '.ST',
  // Norway
  'OSLO': '.OL',
  // Denmark
  'NASDAQ COPENHAGEN': '.CO',
  // Finland
  'NASDAQ HELSINKI': '.HE',
  // Iceland
  'NASDAQ ICELAND': '.IC',
  // Poland
  'WARSAW': '.WA',
  // Czech
  'PRAGUE': '.PR',
  // Greece
  'ATHENS': '.AT',
  // Turkey
  'BIST': '.IS',
  // Japan
  'Japan Exchange Group': '.T',
  // Hong Kong
  'Hong Kong Ex': '.HK',
  // China
  'Shanghai': '.SS',
  'Shenzhen': '.SZ',
  // Taiwan
  'Taiwan': '.TW',
  'Taipei Exchange': '.TWO',
  // Korea
  'Korea Exchange': '.KS',
  KOSDAQ: '.KQ',
  // India
  'NSE': '.NS',
  'BSE': '.BO',
  // Singapore
  'Singapore': '.SI',
  // Thailand
  'SET': '.BK',
  // Indonesia
  'IDX': '.JK',
  // Malaysia
  'Bursa': '.KL',
  // Australia
  ASX: '.AX',
  // New Zealand
  NZX: '.NZ',
  // Israel
  'Tel Aviv': '.TA',
  // Saudi
  'Saudi': '.SR',
  // UAE
  'Dubai': '.AE',
  // Qatar
  'Qatar': '.QA',
  // Egypt
  'Egyptian': '.CA',
  // South Africa
  'JSE': '.JO',
};

/**
 * @param {Object} config
 * @param {string} config.publishableKey - Logo.dev publishable key (pk_ prefix).
 * @param {string} [config.format] - Image format (webp, png, svg).
 * @param {string} [config.size] - Image size in pixels.
 * @param {string} [config.theme] - Theme (light, dark).
 * @param {boolean} [config.greyscale] - Whether to use greyscale.
 */
function createLogoDevProvider(config = {}) {
  const publishableKey = config.publishableKey || process.env.LOGO_DEV_PUBLISHABLE_KEY;
  const format = config.format || 'webp';
  const size = String(config.size || 128);
  const theme = config.theme || 'dark';
  const greyscale = config.greyscale !== undefined ? config.greyscale : true;

  if (!publishableKey) {
    console.warn('[AssetLogoProvider] Logo.dev provider initialized without LOGO_DEV_PUBLISHABLE_KEY — will be bypassed.');
  }

  function buildLogoUrl(identifier, mode) {
    if (!publishableKey) return null;

    const params = new URLSearchParams({
      token: publishableKey,
      size,
      theme,
      greyscale: String(greyscale),
      fallback: '404',
    });

    // For format, append as query param
    if (format) {
      params.set('format', format);
    }

    const encoded = encodeURIComponent(identifier);
    let path;

    switch (mode) {
      case 'domain':
        path = encoded;
        break;
      case 'crypto':
        path = `crypto/${encoded}`;
        break;
      case 'isin':
      case 'cusip':
      case 'ticker':
      default:
        path = `ticker/${encoded}`;
        break;
    }

    return `https://img.logo.dev/${path}?${params.toString()}`;
  }

  function resolve(identity) {
    if (!publishableKey || !identity) return null;

    const { identity: normIdentity, cacheKey } = buildNormalized(identity);

    // Logo.dev ticker endpoint does NOT support ISIN lookup directly.
    // ISIN resolution is handled by VectorUp (primary). Logo.dev is
    // a ticker/crypto/domain fallback only.

    // Crypto
    if (normIdentity.kind === 'crypto') {
      if (normIdentity.symbol) {
        const url = buildLogoUrl(normIdentity.symbol.toUpperCase(), 'crypto');
        if (url) return { url, format, confidence: 'medium', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
      }
    }

    // Exchange + ticker (Logo.dev supports dot-suffixed tickers)
    if (normIdentity.symbol && normIdentity.exchange) {
      const symbol = normalizeSymbolForUrl(normIdentity.symbol, normIdentity.exchange);
      const url = buildLogoUrl(symbol, 'ticker');
      if (url) return { url, format, confidence: 'high', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
    }

    // Ticker only
    if (normIdentity.symbol) {
      const url = buildLogoUrl(normIdentity.symbol, 'ticker');
      if (url) return { url, format, confidence: 'high', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
    }

    // Domain
    if (normIdentity.domain) {
      const domain = normalizeDomain(normIdentity.domain);
      if (domain) {
        const url = buildLogoUrl(domain, 'domain');
        if (url) return { url, format, confidence: 'medium', sourceKey: cacheKey, resolvedAt: new Date().toISOString() };
      }
    }

    return null;
  }

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
    const suffix = LOGO_DEV_EXCHANGE_SUFFIX[exch] ??
      LOGO_DEV_EXCHANGE_SUFFIX[exch.replace(/^THE\s+/, '')] ?? '';
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

  return {
    providerName: 'logo-dev',
    providerId: 'logo-dev',
    isConfigured: Boolean(publishableKey),
    resolve,
    buildLogoUrl,
  };
}

module.exports = { createLogoDevProvider, LOGO_DEV_EXCHANGE_SUFFIX };
