// services/providers/ETFIntelligenceProvider/Provider.js
// Generic ETF Intelligence facade. Holds the active implementation behind a
// provider-agnostic interface. Swapping to ETF.com / VettaFi / Morningstar /
// Refinitiv changes ONLY this file — ARW untouched.
//
// Provider selection (integration plan §2):
//   ETF_INTELLIGENCE_PROVIDER=ETFDB_API  -> package-backed adapter is PRIMARY.
//   (unset / ETFDB_SCRAPER)              -> legacy scraper is the default.
// The legacy scraper is retained ONLY as an explicit fallback when
// ETF_INTELLIGENCE_ETFDB_SCRAPER_FALLBACK=true and the API adapter is inert.
// Neither path is live unless its own enable flag is set, so this stays honest.

const Cache = require("./Cache");
const ETFdb = require("./ETFdbProvider");
const { createEtfDataProvider } = require("./ETFdbApiProvider");
const { normalizeProfile, normalizeComposition, normalizeClassification, normalizeStrategy } = require("./Normalizer");

const SCRAPER_FALLBACK =
  String(process.env.ETF_INTELLIGENCE_ETFDB_SCRAPER_FALLBACK || "false").toLowerCase() === "true";

const IMPLEMENTATIONS = { ETFDB_SCRAPER: ETFdb, ETFDB_API: null };
const ACTIVE = process.env.ETF_INTELLIGENCE_PROVIDER || "ETFDB_SCRAPER";

// ETFDB_API adapter is wired in but inert until ETF_INTELLIGENCE_ETFDB_API_ENABLED.
const apiProvider = createEtfDataProvider();

// Resolve the primary implementation for the active provider.
// When ETFDB_API is selected, the adapter is primary; the scraper is only a
// fallback when explicitly enabled and the adapter is non-live.
let impl = IMPLEMENTATIONS[ACTIVE] || ETFdb;
if (ACTIVE === "ETFDB_API") {
  impl = apiProvider.live ? apiProvider
    : (SCRAPER_FALLBACK ? ETFdb : null);
}

async function safe(fn, fallback) {
  try { return (await fn()) ?? fallback; } catch { return fallback; }
}

async function getProfile(ticker) {
  const c = Cache.get("profile", ticker);
  if (c) return c;
  const v = await safe(() => impl && impl.getProfile ? impl.getProfile(ticker) : null, null);
  const normalized = normalizeProfile(v);
  if (normalized) Cache.set("profile", ticker, normalized);
  return normalized;
}
async function getComposition(ticker) {
  const c = Cache.get("composition", ticker);
  if (c) return c;
  const v = await safe(() => impl && impl.getComposition ? impl.getComposition(ticker) : null, null);
  const normalized = normalizeComposition(v);
  if (normalized) Cache.set("composition", ticker, normalized);
  return normalized;
}
async function getClassification(ticker) {
  const c = Cache.get("classification", ticker);
  if (c) return c;
  const v = await safe(() => impl && impl.getClassification ? impl.getClassification(ticker) : null, null);
  const normalized = normalizeClassification(v);
  if (normalized) Cache.set("classification", ticker, normalized);
  return normalized;
}
async function getStrategy(ticker) {
  const c = Cache.get("strategy", ticker);
  if (c) return c;
  const v = await safe(() => impl && impl.getStrategy ? impl.getStrategy(ticker) : null, null);
  const normalized = normalizeStrategy(v);
  if (normalized) Cache.set("strategy", ticker, normalized);
  return normalized;
}
async function getPeers(ticker) {
  const c = Cache.get("peers", ticker);
  if (c) return c;
  const v = await safe(() => impl && impl.getPeers ? impl.getPeers(ticker) : [], []);
  if (v.length) Cache.set("peers", ticker, v);
  return v;
}
async function getThemes(ticker) {
  const c = Cache.get("themes", ticker);
  if (c) return c;
  const v = await safe(() => impl && impl.getThemes ? impl.getThemes(ticker) : [], []);
  if (v.length) Cache.set("themes", ticker, v);
  return v;
}

module.exports = {
  providerId: ACTIVE,
  getProfile,
  getComposition,
  getClassification,
  getStrategy,
  getPeers,
  getThemes,
};
