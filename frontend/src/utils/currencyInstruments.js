// First-Class ETFs & Currencies — shared asset-instrument contract (spec §1).
//
// One canonical AssetInstrument shape used by backend search, Watchlist,
// routing, modal, ARW, Home, and Portfolio. Pure reference data + normalization
// helpers. No fabricated prices/quotes.
//
// Non-negotiables honored:
//  - ETFs are quoted securities; FX pairs are price-bearing; currency codes are
//    macro/research entities unless backed by a real cash/position record.
//  - Canonical display uses a slash: EUR/USD. Internal provider format stays
//    EURUSD=X. Never silently reinterpret a saved stock/crypto/commodity as a
//    currency.

import { CORE_ETF_SEED, COMMODITY_RELATIONS } from "./assetGraph.js";

/** @typedef {"stock"|"crypto"|"bond"|"commodity"|"etf"|"forex"|"currency"|"indicator"} AssetKind */

// ── Curated liquid universes (spec §1) ──────────────────────────────────────
export const CURATED_FX_PAIRS = [
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CHF", "USD/CAD",
  "AUD/USD", "NZD/USD", "EUR/GBP", "EUR/JPY", "GBP/JPY",
];

export const CURATED_CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
];

// base/quote metadata for curated FX pairs (exported for search index + UI).
export const FX_BASE_QUOTE = {
  "EUR/USD": ["EUR", "USD"], "GBP/USD": ["GBP", "USD"], "USD/JPY": ["USD", "JPY"],
  "USD/CHF": ["USD", "CHF"], "USD/CAD": ["USD", "CAD"], "AUD/USD": ["AUD", "USD"],
  "NZD/USD": ["NZD", "USD"], "EUR/GBP": ["EUR", "GBP"], "EUR/JPY": ["EUR", "JPY"],
  "GBP/JPY": ["GBP", "JPY"],
};

const CCY_NAMES = {
  USD: "US Dollar", EUR: "Euro", GBP: "British Pound", JPY: "Japanese Yen",
  CHF: "Swiss Franc", CAD: "Canadian Dollar", AUD: "Australian Dollar", NZD: "New Zealand Dollar",
};
export { CCY_NAMES };

const FX_NAMES = {
  "EUR/USD": "Euro / US Dollar", "GBP/USD": "British Pound / US Dollar",
  "USD/JPY": "US Dollar / Japanese Yen", "USD/CHF": "US Dollar / Swiss Franc",
  "USD/CAD": "US Dollar / Canadian Dollar", "AUD/USD": "Australian Dollar / US Dollar",
  "NZD/USD": "New Zealand Dollar / US Dollar", "EUR/GBP": "Euro / British Pound",
  "EUR/JPY": "Euro / Japanese Yen", "GBP/JPY": "British Pound / Japanese Yen",
};
export { FX_NAMES };

// ── Currency macro identity registry (spec §4) ──────────────────────────────
// Honest, curated reference data only — no fabricated rates. Issuing countries
// are plural-aware: EUR/USD shared by multiple economies. Policy rate is a
// reference snapshot, flagged as such in the UI ("as of" + reference tag).
export const CURRENCY_META = {
  USD: {
    name: "US Dollar",
    countries: ["United States"],
    centralBanks: ["Federal Reserve (Fed)"],
    region: "United States",
    policyRateLabel: "Fed Funds Rate",
    referencePolicyRatePct: 4.33,
    policyRateAsOf: "2026-06",
    notes: "Global reserve currency; reference rate for most FX pairs.",
  },
  EUR: {
    name: "Euro",
    countries: ["Germany", "France", "Italy", "Spain", "Netherlands", "Eurozone (20 states)"],
    centralBanks: ["European Central Bank (ECB)"],
    region: "Eurozone",
    policyRateLabel: "ECB Deposit Rate",
    referencePolicyRatePct: 2.00,
    policyRateAsOf: "2026-06",
    notes: "Shared by 20 euro-area economies; single monetary policy.",
  },
  GBP: {
    name: "British Pound",
    countries: ["United Kingdom"],
    centralBanks: ["Bank of England (BoE)"],
    region: "United Kingdom",
    policyRateLabel: "Bank Rate",
    referencePolicyRatePct: 4.25,
    policyRateAsOf: "2026-06",
    notes: "Sterling; independent monetary policy from the euro area.",
  },
  JPY: {
    name: "Japanese Yen",
    countries: ["Japan"],
    centralBanks: ["Bank of Japan (BoJ)"],
    region: "Japan",
    policyRateLabel: "Policy Rate",
    referencePolicyRatePct: 0.50,
    policyRateAsOf: "2026-06",
    notes: "Traditional funding currency; low-yield policy stance.",
  },
  CHF: {
    name: "Swiss Franc",
    countries: ["Switzerland"],
    centralBanks: ["Swiss National Bank (SNB)"],
    region: "Switzerland",
    policyRateLabel: "SNB Policy Rate",
    referencePolicyRatePct: 1.00,
    policyRateAsOf: "2026-06",
    notes: "Safe-haven currency; SNB actively manages the exchange rate.",
  },
  CAD: {
    name: "Canadian Dollar",
    countries: ["Canada"],
    centralBanks: ["Bank of Canada (BoC)"],
    region: "Canada",
    policyRateLabel: "Overnight Rate",
    referencePolicyRatePct: 2.75,
    policyRateAsOf: "2026-06",
    notes: "Commodity-correlated; sensitive to crude oil.",
  },
  AUD: {
    name: "Australian Dollar",
    countries: ["Australia"],
    centralBanks: ["Reserve Bank of Australia (RBA)"],
    region: "Australia",
    policyRateLabel: "Cash Rate",
    referencePolicyRatePct: 3.85,
    policyRateAsOf: "2026-06",
    notes: "High-beta cyclical currency; tied to commodities and China demand.",
  },
  NZD: {
    name: "New Zealand Dollar",
    countries: ["New Zealand"],
    centralBanks: ["Reserve Bank of New Zealand (RBNZ)"],
    region: "New Zealand",
    policyRateLabel: "Official Cash Rate",
    referencePolicyRatePct: 3.25,
    policyRateAsOf: "2026-06",
    notes: "Small, high-yield cyclical currency; correlated with AUD.",
  },
};

/** getCurrencyMeta — plural-aware macro identity for a currency code. */
export function getCurrencyMeta(code) {
  const c = String(code || "").trim().toUpperCase();
  return CURRENCY_META[c] || null;
}

// ── ETF catalog (CORE_ETF_SEED + commodity-linked ETFs, dedup by ticker) ─────
function buildEtfCatalog() {
  const map = new Map();
  for (const [symbol, meta] of Object.entries(CORE_ETF_SEED)) {
    map.set(symbol.toUpperCase(), {
      symbol: symbol.toUpperCase(),
      name: meta.name,
      kind: "etf",
      type: "etf",
      marketType: "equity",
      category: "etfs",
      instrumentType: "security",
      provider: meta.issuer || "Market Data",
      source: "core_etf_seed",
      issuer: meta.issuer,
      exposure: meta.exposure,
    });
  }
  // Commodity-linked ETFs from COMMODITY_RELATIONS (dedup by uppercase ticker).
  for (const rel of Object.values(COMMODITY_RELATIONS)) {
    for (const etf of rel.etfs || []) {
      const sym = String(etf).toUpperCase();
      if (!map.has(sym)) {
        map.set(sym, {
          symbol: sym,
          name: `${sym} ETF`,
          kind: "etf",
          type: "etf",
          marketType: "equity",
          category: "etfs",
          instrumentType: "security",
          provider: "Market Data",
          source: "commodity_relations",
        });
      }
    }
  }
  return Array.from(map.values());
}

export const CURATED_ETF_CATALOG = buildEtfCatalog();

// ── Normalization ─────────────────────────────────────────────────────────
const FX_SPECIAL = { "JPY=X": "USD/JPY" };

/**
 * normalizeInstrumentSymbol — canonical display identity.
 * EURUSD => EUR/USD, EUR/USD => EUR/USD, EURUSD=X => EUR/USD, JPY=X => USD/JPY.
 * Never reinterprets a stock/crypto/commodity symbol as a currency.
 * @param {string} input
 * @returns {string}
 */
export function normalizeInstrumentSymbol(input) {
  if (input == null) return "";
  const raw = String(input).trim();
  if (FX_SPECIAL[raw.toUpperCase()] != null) return FX_SPECIAL[raw.toUpperCase()];

  // Already canonical slash form.
  if (/^[A-Za-z]{3}\/[A-Za-z]{3}$/.test(raw)) {
    return `${raw.slice(0, 3).toUpperCase()}/${raw.slice(4, 7).toUpperCase()}`;
  }
  // Yahoo FX form: BASEQUOTE=X  (e.g. EURUSD=X, JPY=X)
  let m = raw.match(/^([A-Za-z]{3})([A-Za-z]{3})=X$/);
  if (m) {
    const base = m[1].toUpperCase(), quote = m[2].toUpperCase();
    // JPY=X means USD/JPY (the quote-less JPY alias resolves to USD-paired).
    if (base === "JPY" && quote === "USD") return "USD/JPY";
    return `${base}/${quote}`;
  }
  // Bare 6-char FX: BASEQUOTE  (e.g. EURUSD, usdjpy)
  m = raw.match(/^([A-Za-z]{3})([A-Za-z]{3})$/);
  if (m) {
    const base = m[1].toUpperCase(), quote = m[2].toUpperCase();
    if (base === "JPY") return "USD/JPY"; // JPY shorthand => USD/JPY
    return `${base}/${quote}`;
  }
  return raw.toUpperCase();
}

/** Is this a 3-letter currency code (ISO-4217-ish)? */
export function isCurrencyCodeLiteral(s) {
  return /^[A-Za-z]{3}$/.test(String(s || "").trim());
}

/** Is this a slash FX pair literal? */
export function isFxPairLiteral(s) {
  return /^[A-Za-z]{3}\/[A-Za-z]{3}$/.test(String(s || "").trim());
}

/**
 * resolveCurrencyInstrument — returns a normalized AssetInstrument for an FX
 * pair or currency code, or null if it's not in the curated universe.
 * @param {string} input
 * @returns {AssetInstrument|null}
 */
export function resolveCurrencyInstrument(input) {
  const norm = normalizeInstrumentSymbol(input);
  if (FX_BASE_QUOTE[norm]) {
    const [base, quote] = FX_BASE_QUOTE[norm];
    return {
      symbol: norm,
      providerSymbol: `${base}${quote}=X`,
      name: FX_NAMES[norm] || `${base} / ${quote}`,
      kind: "forex",
      type: "forex",
      marketType: "forex",
      category: "currencies",
      instrumentType: "fx-pair",
      baseCurrency: base,
      quoteCurrency: quote,
      currency: quote,
      exchange: "FX",
      provider: "Yahoo Finance",
      source: "curated_fx_universe",
    };
  }
  const code = String(input || "").trim().toUpperCase();
  if (CURATED_CURRENCIES.includes(code) && !isFxPairLiteral(norm)) {
    return {
      symbol: code,
      name: CCY_NAMES[code] || code,
      kind: "currency",
      type: "currency",
      marketType: "macro",
      category: "currencies",
      instrumentType: "currency-code",
      currency: code,
      provider: "Forex Factory / Macro feeds",
      source: "curated_currency_universe",
    };
  }
  return null;
}

/** getProviderSymbol — internal provider format (Yahoo =X for FX). */
export function getProviderSymbol(instrument) {
  if (!instrument) return "";
  if (instrument.providerSymbol) return instrument.providerSymbol;
  if (instrument.kind === "forex" && instrument.baseCurrency && instrument.quoteCurrency) {
    return `${instrument.baseCurrency}${instrument.quoteCurrency}=X`;
  }
  return instrument.symbol;
}

export function isFxPair(instrument) {
  return Boolean(instrument) && (instrument.kind === "forex" || instrument.instrumentType === "fx-pair");
}

export function isCurrencyCode(instrument) {
  return Boolean(instrument) && (instrument.kind === "currency" || instrument.instrumentType === "currency-code");
}

/** Search the curated FX + currency universe by free text. */
export function searchCurrencyInstruments(query, limit = 12) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const pair of CURATED_FX_PAIRS) {
    const [b, q2] = FX_BASE_QUOTE[pair];
    if (pair.toLowerCase().includes(q) || b.toLowerCase().includes(q) || q2.toLowerCase().includes(q)) {
      out.push(resolveCurrencyInstrument(pair));
    }
  }
  for (const code of CURATED_CURRENCIES) {
    if (code.toLowerCase().includes(q) || (CCY_NAMES[code] || "").toLowerCase().includes(q)) {
      out.push(resolveCurrencyInstrument(code));
    }
  }
  return out.slice(0, limit);
}

/** Pairs in the curated universe that reference a given currency code. */
export function relatedFxPairs(currencyCode) {
  const code = String(currencyCode || "").toUpperCase();
  return CURATED_FX_PAIRS.filter((p) => {
    const [b, q] = FX_BASE_QUOTE[p];
    return b === code || q === code;
  });
}
