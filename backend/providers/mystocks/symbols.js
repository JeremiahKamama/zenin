"use strict";

/**
 * MyStocks Africa — symbol + exchange utilities.
 *
 * MyStocks uses exchange-qualified DOT symbols, e.g. "SCOM.KE", "DANGCEM.NG",
 * "MTN.ZA". The country suffix (ISO-3166 alpha-2) maps to an exchange via a
 * documented MyStocks-supported set. We never collapse these to bare tickers.
 */

// Exchanges explicitly named in the integration spec, each with the country code
// that appears as the MyStocks symbol suffix and the local reporting currency.
const MYSTOCKS_EXCHANGES = {
  NSE: { name: "Nairobi Securities Exchange", country: "KE", currency: "KES" },
  NGX: { name: "Nigerian Exchange", country: "NG", currency: "NGN" },
  JSE: { name: "Johannesburg Stock Exchange", country: "ZA", currency: "ZAR" },
  GSE: { name: "Ghana Stock Exchange", country: "GH", currency: "GHS" },
  BRVM: { name: "Bourse Regionale des Valeurs Mobilieres", country: "BF", currency: "XOF" },
  ZSE: { name: "Zimbabwe Stock Exchange", country: "ZW", currency: "ZWL" },
  BSE: { name: "Botswana Stock Exchange", country: "BW", currency: "BWP" },
  LUSE: { name: "Lusaka Securities Exchange", country: "ZM", currency: "ZMW" },
  EGX: { name: "Egyptian Exchange", country: "EG", currency: "EGP" },
  DSE: { name: "Dar es Salaam Stock Exchange", country: "TZ", currency: "TZS" },
  USE: { name: "Uganda Securities Exchange", country: "UG", currency: "UGX" },
  MSE: { name: "Malawi Stock Exchange", country: "MW", currency: "MWK" },
  CSE: { name: "Casablanca Stock Exchange", country: "MA", currency: "MAD" },
  SEM: { name: "Stock Exchange of Mauritius", country: "MU", currency: "MUR" },
};

// country code (symbol suffix) -> exchange mic
const COUNTRY_TO_EXCHANGE = Object.fromEntries(
  Object.entries(MYSTOCKS_EXCHANGES).map(([mic, v]) => [v.country, mic])
);

const SUPPORTED_EXCHANGES = Object.keys(MYSTOCKS_EXCHANGES);
const SUPPORTED_COUNTRIES = Object.keys(COUNTRY_TO_EXCHANGE);

function isSupportedExchange(exchange) {
  return Boolean(exchange && MYSTOCKS_EXCHANGES[String(exchange).toUpperCase()]);
}

function isSupportedCountry(country) {
  return Boolean(country && COUNTRY_TO_EXCHANGE[String(country).toUpperCase()]);
}

/**
 * Parse a symbol into { symbol, exchange, country } using MyStocks DOT convention.
 * Accepts "SCOM.KE", "scom.ke", "SCOM" (no suffix -> unknown exchange).
 * @param {string} raw
 */
function parseSymbol(raw) {
  const s = String(raw || "").trim();
  if (!s) return { symbol: "", exchange: null, country: null, qualified: false };
  if (s.includes(".")) {
    const [base, suffix] = s.split(".");
    const country = String(suffix || "").toUpperCase();
    const exchange = COUNTRY_TO_EXCHANGE[country] || null;
    return {
      symbol: `${String(base).toUpperCase()}.${country}`,
      base: String(base).toUpperCase(),
      country: exchange ? country : null,
      exchange,
      qualified: Boolean(exchange),
    };
  }
  return { symbol: s.toUpperCase(), base: s.toUpperCase(), country: null, exchange: null, qualified: false };
}

/**
 * Is this symbol eligible to be routed to MyStocks as primary?
 * True only when it is exchange-qualified on a MyStocks-supported African exchange.
 * @param {string} raw
 */
function isMyStocksQualified(raw) {
  const p = parseSymbol(raw);
  return p.qualified && isSupportedExchange(p.exchange);
}

/**
 * Build a MyStocks providerSymbol from a base + country (e.g. "SCOM","KE" -> "SCOM.KE").
 * @param {string} base
 * @param {string} country
 */
function toProviderSymbol(base, country) {
  const c = String(country || "").toUpperCase();
  if (!base || !c) return null;
  return `${String(base).toUpperCase()}.${c}`;
}

function exchangeMeta(exchange) {
  return MYSTOCKS_EXCHANGES[String(exchange).toUpperCase()] || null;
}

module.exports = {
  MYSTOCKS_EXCHANGES,
  SUPPORTED_EXCHANGES,
  SUPPORTED_COUNTRIES,
  COUNTRY_TO_EXCHANGE,
  isSupportedExchange,
  isSupportedCountry,
  isMyStocksQualified,
  parseSymbol,
  toProviderSymbol,
  exchangeMeta,
};
