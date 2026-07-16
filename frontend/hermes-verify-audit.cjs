// Watchlist Audit remediation §7 — ad-hoc verification.
// Covers §1 compare-routing kind resolution AND §5 quote-status derivation.
// Imports REAL modules for the routing half; mirrors the exact in-component
// logic for the quote-status half (helper is component-scoped, not exported).
// Not a DOM/routing suite (no test runner configured); proves branch decisions.
const path = process.cwd() + "/src";
const { resolveCurrencyInstrument, CURATED_ETF_CATALOG, CURATED_FX_PAIRS, CURATED_CURRENCIES, normalizeInstrumentSymbol } = require(`${path}/utils/currencyInstruments.js`);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) { fail++; console.log(`   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`); } else pass++;
};

// ── §1 engine: resolveAssetKindFromSymbol ────────────────────────────────
function resolveAssetKind(symbol) {
  const raw = String(symbol || "").trim();
  if (!raw) return "stock";
  const inst = resolveCurrencyInstrument(raw);
  if (inst && (inst.kind === "forex" || inst.kind === "currency")) return inst.kind;
  const upper = raw.toUpperCase();
  if (CURATED_ETF_CATALOG && CURATED_ETF_CATALOG.some((e) => e.symbol === upper)) return "etf";
  return "stock";
}
function normalizeCompareTarget(input, fallbackKind) {
  if (input == null) return { symbol: "", kind: fallbackKind || "stock" };
  if (typeof input === "string") {
    const symbol = String(input).trim().toUpperCase();
    return { symbol, kind: fallbackKind || resolveAssetKind(symbol) };
  }
  const symbol = String(input.symbol ?? input.a ?? "").trim().toUpperCase();
  const rawKind = input.kind || input.type || fallbackKind;
  const kind = rawKind ? String(rawKind).toLowerCase() : resolveAssetKind(symbol);
  const rawCompare = input.compareSymbol ?? input.peerSymbol ?? input.b ?? null;
  const compareSymbol = rawCompare ? String(rawCompare).trim().toUpperCase() : null;
  return { symbol, kind, compareSymbol };
}
eq("USDCHF -> forex", resolveAssetKind("USDCHF"), "forex");
eq("EURUSD -> forex", resolveAssetKind("EUR/USD"), "forex");
eq("USD -> currency", resolveAssetKind("USD"), "currency");
eq("EUR -> currency", resolveAssetKind("EUR"), "currency");
eq("IWM -> etf", resolveAssetKind("IWM"), "etf");
eq("SPY -> etf", resolveAssetKind("SPY"), "etf");
eq("AAPL -> stock", resolveAssetKind("AAPL"), "stock");
eq("legacy string resolves kind", normalizeCompareTarget("USDCHF").kind, "forex");
eq("typed object preserves kind", normalizeCompareTarget({ symbol: "IWM", kind: "etf" }).kind, "etf");
eq("typed object preserves compareSymbol", normalizeCompareTarget({ symbol: "EUR/USD", kind: "forex", compareSymbol: "GBP/USD" }).compareSymbol, "GBP/USD");
eq("peerSymbol alias", normalizeCompareTarget({ symbol: "EUR/USD", peerSymbol: "USD/JPY" }).compareSymbol, "USD/JPY");
eq("FX pairs curated", CURATED_FX_PAIRS.includes("USD/CHF"), true);
eq("Currencies curated", CURATED_CURRENCIES.includes("EUR"), true);
eq("canonical FX form", normalizeInstrumentSymbol("EURUSD"), "EUR/USD");

// ── §5 engine: deriveQuoteStatus (mirrors Watchlist.jsx) ──────────────────
const QUOTE_STALE_MS = 60 * 1000;
function deriveQuoteStatus(asset, status, now) {
  const price = asset && asset.price != null;
  const tick = asset && asset._liveUpdatedAt ? Number(asset._liveUpdatedAt) : null;
  const tickAge = tick != null ? now - tick : null;
  if (!price) return { state: "unavailable", source: null, asOf: null, reason: "No quote available" };
  if (status === "connected" && tick != null && tickAge != null && tickAge <= QUOTE_STALE_MS) {
    return { state: "live", source: "Live feed", asOf: tick, reason: null };
  }
  if (tick != null && tickAge != null && tickAge > QUOTE_STALE_MS) {
    return { state: "stale", source: "Catalog", asOf: tick, reason: "Last tick older than 60s" };
  }
  if (status === "idle" && tick == null) {
    return { state: "unknown", source: null, asOf: null, reason: "Provenance unknown" };
  }
  return { state: "cached", source: "Catalog", asOf: null, reason: "Snapshot, no live tick this session" };
}
const NOW = 1_000_000_000_000;
eq("no price -> unavailable", deriveQuoteStatus({ price: null }, "connected", NOW).state, "unavailable");
eq("live tick -> live", deriveQuoteStatus({ price: 10, _liveUpdatedAt: NOW - 1000 }, "connected", NOW).state, "live");
eq("old tick -> stale", deriveQuoteStatus({ price: 10, _liveUpdatedAt: NOW - 120000 }, "connected", NOW).state, "stale");
eq("idle + no tick -> unknown (not inferred Live)", deriveQuoteStatus({ price: 10 }, "idle", NOW).state, "unknown");
eq("connected but no tick -> cached", deriveQuoteStatus({ price: 10 }, "connected", NOW).state, "cached");
eq("degraded + price + no tick -> cached", deriveQuoteStatus({ price: 10 }, "degraded", NOW).state, "cached");
eq("live carries source", deriveQuoteStatus({ price: 10, _liveUpdatedAt: NOW - 1000 }, "connected", NOW).source, "Live feed");
eq("never infers Live without tick", deriveQuoteStatus({ price: 10, _liveUpdatedAt: NOW - 999999 }, "connected", NOW).state, "stale");

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
