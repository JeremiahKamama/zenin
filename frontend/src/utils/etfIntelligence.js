// utils/etfIntelligence.js
// Derived ETF intelligence — NO external provider, NO fabrication.
// Everything here is computed from the single reference seed (CORE_ETF_SEED)
// + the Relationship Graph. This is the honest "what Zenin knows today"
// layer; the live ETF Intelligence Provider (ETFDB_SCRAPER) is a separate,
// not-yet-wired backend path (see ETFdbProvider.js → null).
//
// Powers Rec 4 (Discovery), Rec 8 (Compare), Rec 9 (Macro→ETF),
// Rec 10 (Portfolio→ETF), Rec 11 (Scenario presets source).
import { CORE_ETF_SEED } from "./assetGraph";
import { getRelated } from "./relationshipGraph";

const ALL = () => Object.entries(CORE_ETF_SEED).map(([sym, m]) => ({ sym, ...m }));

// Rec 4 — Discovery by facet. Facets map to seed fields.
// assetClass: derived from category (Bond/Fixed Income→bond, Commodity→commodity, else equity)
// sector/country/theme/dividend/growth/value/momentum/esg/leveraged/inverse/
// smartBeta/factor: matched against category + exposure free-text.
export function browseEtfs(facet, value) {
  const all = ALL();
  if (!facet || facet === "all") return all;
  const v = String(value || "").toLowerCase();
  const assetClassOf = (m) => /bond|fixed income|treasury|agg/i.test(m.category || "") ? "bond"
    : /commodity/i.test(m.category || "") ? "commodity" : "equity";
  switch (facet) {
    case "assetClass": return all.filter((m) => assetClassOf(m) === v);
    case "sector": return all.filter((m) => (m.category || "").toLowerCase().includes(v) || (m.exposure || []).some((e) => e.toLowerCase().includes(v)));
    case "country": return all.filter((m) => (m.exposure || []).some((e) => e.toLowerCase().includes(v)));
    case "theme": return all.filter((m) => /thematic|innovation|esg|growth|value|dividend|momentum|smart beta|factor|leveraged|inverse/i.test(`${m.category} ${(m.exposure || []).join(" ")}`) && (v === "all" || `${m.category} ${(m.exposure || []).join(" ")}`.toLowerCase().includes(v)));
    case "dividend": return all.filter((m) => /dividend|distribution|income/i.test(`${m.category} ${(m.exposure || []).join(" ")}`) || (m.exposure || []).includes("Dividends"));
    case "growth": return all.filter((m) => /growth/i.test(`${m.category} ${(m.exposure || []).join(" ")}`));
    case "value": return all.filter((m) => /value/i.test(`${m.category} ${(m.exposure || []).join(" ")}`));
    case "momentum": return all.filter((m) => /momentum/i.test(`${m.category} ${(m.exposure || []).join(" ")}`));
    case "esg": return all.filter((m) => /esg|sustain/i.test(`${m.category}`));
    case "commodity": return all.filter((m) => /commodity/i.test(m.category || "") || (m.exposure || []).some((e) => /gold|silver|oil|gas|agri/i.test(e)));
    case "currency": return all.filter((m) => (m.exposure || []).some((e) => /hedged|currency|usd|fx/i.test(e)));
    case "bond": return all.filter((m) => /bond|treasury|fixed income|agg/i.test(m.category || ""));
    case "leveraged": return all.filter((m) => /leveraged|2x|3x|ultra/i.test(m.category || ""));
    case "inverse": return all.filter((m) => /inverse|short|bear/i.test(m.category || ""));
    case "smartBeta": return all.filter((m) => /smart beta|factor|multifactor/i.test(m.category || ""));
    case "factor": return all.filter((m) => /factor|smart beta|multifactor/i.test(m.category || ""));
    case "issuer": return all.filter((m) => (m.issuer || "").toLowerCase() === v);
    default: return all.filter((m) => (m.category || "").toLowerCase().includes(v) || (m.exposure || []).some((e) => e.toLowerCase().includes(v)));
  }
}

export const ETF_FACETS = [
  { id: "all", label: "All" },
  { id: "assetClass", label: "Asset Class" },
  { id: "sector", label: "Sector" },
  { id: "country", label: "Country" },
  { id: "theme", label: "Theme" },
  { id: "dividend", label: "Dividend" },
  { id: "growth", label: "Growth" },
  { id: "value", label: "Value" },
  { id: "momentum", label: "Momentum" },
  { id: "esg", label: "ESG" },
  { id: "commodity", label: "Commodity" },
  { id: "currency", label: "Currency" },
  { id: "bond", label: "Bond" },
  { id: "leveraged", label: "Leveraged" },
  { id: "inverse", label: "Inverse" },
  { id: "smartBeta", label: "Smart Beta" },
  { id: "factor", label: "Factor" },
];

// Rec 9 — Macro regime → ETF recommendations.
// regime: { label, affectedSectors:[], affectedCommodities:[], affectedCountries:[] }
export function recommendEtfsForRegime(regime) {
  if (!regime) return [];
  const sectors = (regime.affectedSectors || []).map((s) => s.toLowerCase());
  const countries = (regime.affectedCountries || []).map((c) => c.toLowerCase());
  const commodities = (regime.affectedCommodities || []).map((c) => c.toLowerCase());
  return ALL()
    .map((m) => {
      const exp = `${m.category} ${(m.exposure || []).join(" ")}`.toLowerCase();
      let score = 0; const why = [];
      sectors.forEach((s) => { if (exp.includes(s)) { score += 2; why.push(`exposed to ${s}`); } });
      countries.forEach((c) => { if (exp.includes(c)) { score += 2; why.push(`exposed to ${c}`); } });
      commodities.forEach((c) => { if (exp.includes(c)) { score += 2; why.push(`tracks ${c}`); } });
      return { ...m, score, why };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// Rec 10 — Portfolio gap → ETF recommendations.
// gaps: e.g. { missingSectors:["International","Dividend"], missingCountries:["China"] }
export function recommendEtfsForPortfolio(gaps) {
  const want = [
    ...(gaps.missingSectors || []),
    ...(gaps.missingCountries || []),
    ...(gaps.wantExposure || []),
  ].map((s) => s.toLowerCase());
  if (!want.length) return [];
  return ALL()
    .map((m) => {
      const exp = `${m.category} ${(m.exposure || []).join(" ")}`.toLowerCase();
      const hits = want.filter((w) => exp.includes(w));
      return { ...m, score: hits.length, why: hits.map((h) => `adds ${h} exposure`) };
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

// Rec 8 — Compare two ETFs on real seed fields.
export function compareEtfs(aSym, bSym) {
  const a = CORE_ETF_SEED[String(aSym || "").toUpperCase()];
  const b = CORE_ETF_SEED[String(bSym || "").toUpperCase()];
  if (!a || !b) return null;
  const dims = [
    { dim: "Issuer", a: a.issuer || "—", b: b.issuer || "—" },
    { dim: "Category", a: a.category || "—", b: b.category || "—" },
    { dim: "Benchmark", a: a.benchmark || "—", b: b.benchmark || "—" },
    { dim: "Exposure", a: (a.exposure || []).join(", ") || "—", b: (b.exposure || []).join(", ") || "—" },
  ];
  const overlap = [
    ...new Set([...(a.exposure || []).filter((e) => (b.exposure || []).includes(e))]),
  ];
  const relA = getRelated(aSym);
  const relB = getRelated(bSym);
  const sharedPeers = relA.etfs.filter((e) => relB.etfs.includes(e));
  return { a, b, dims, overlap, sharedPeers };
}

export default { browseEtfs, ETF_FACETS, recommendEtfsForRegime, recommendEtfsForPortfolio, compareEtfs };
