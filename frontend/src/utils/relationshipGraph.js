// RelationshipGraph (Phase 5)
//
// Promotes the Phase 2 graph SEED (utils/assetGraph.js) into a typed
// EntityRegistry + RelationshipGraph with multi-hop traversal. The seed remains
// the single source of reference edges; this module layers structure + traversal
// on top of it — no duplicated literal maps.
//
// Nodes: { id, kind, aliases, label }
// Edges: { from, to, type, weight, source }
//
// Traversal is pure + memoizable. Every consumer (P4 cascade, P3 "which holdings
// drive X", P5 RelatedAssets UI) reads through the same `traverse` API so there is
// exactly one relationship engine.

import {
  COMMODITY_RELATIONS,
  COMPANY_TO_COMMODITIES,
  getCommodityRelations,
  getCompanyCommodities,
  CORE_ETF_SEED,
} from "./assetGraph";

// Macro intelligence seed (Phase 6 — Macro as first-class asset).
// Maps macro regimes/themes to the asset classes they transmit into, so the
// RelationshipGraph can answer "which assets does this macro regime drive?" via
// the same traverse() API used by everything else. Source: deskIntelligence
// SECTOR_MAP (kept here as the canonical edge list, no duplication of logic).
const MACRO_SEED = {
  Expansion: { sectors: ["Cyclicals", "Technology", "Industrials"], commodities: ["Energy", "Industrial Metals", "Precious Metals"] },
  Recovery: { sectors: ["Cyclicals", "Financials", "Industrials"], commodities: ["Industrial Metals"] },
  Goldilocks: { sectors: ["Technology", "Consumer", "Industrials"], commodities: ["Precious Metals"] },
  Inflationary: { sectors: ["Energy", "Materials", "Commodities"], commodities: ["Energy", "Industrial Metals", "Precious Metals", "Agriculture"] },
  Stagflation: { sectors: ["Energy", "Utilities", "Commodities"], commodities: ["Energy", "Precious Metals", "Agriculture"] },
  Slowdown: { sectors: ["Defensives", "Healthcare", "Staples"], commodities: ["Precious Metals", "Agriculture"] },
  Contraction: { sectors: ["Defensives", "Healthcare", "Utilities"], commodities: ["Precious Metals", "Agriculture"] },
  Recession: { sectors: ["Defensives", "Cash", "Treasuries"], commodities: ["Precious Metals", "Agriculture"] },
  "Risk-Off": { sectors: ["Defensives", "Cash", "Treasuries"], commodities: ["Precious Metals", "Agriculture"] },
};
// Macro themes (Theme Explorer) → asset-class channels (descriptive edges).
const MACRO_THEME_EDGES = {
  Inflation: { sectors: ["Energy", "Materials"], commodities: ["Energy", "Industrial Metals", "Precious Metals", "Agriculture"] },
  Rates: { sectors: ["Financials", "Utilities"], commodities: ["Precious Metals"] },
  Liquidity: { sectors: ["Technology", "Cyclicals"], commodities: ["Industrial Metals"] },
  Credit: { sectors: ["Financials", "Cyclicals"], commodities: [] },
  Labor: { sectors: ["Consumer", "Staples", "Healthcare"], commodities: ["Agriculture"] },
  Housing: { sectors: ["Financials", "Materials"], commodities: ["Industrial Metals"] },
  Manufacturing: { sectors: ["Industrials", "Technology"], commodities: ["Industrial Metals"] },
  Consumer: { sectors: ["Consumer", "Staples"], commodities: ["Agriculture"] },
  FX: { sectors: [], commodities: [], currencies: ["USD", "EUR", "JPY", "GBP"] },
  Geopolitics: { sectors: ["Energy", "Materials"], commodities: ["Energy", "Precious Metals", "Agriculture"] },
  Energy: { sectors: ["Energy"], commodities: ["Energy", "Industrial Metals"] },
  Climate: { sectors: ["Utilities", "Materials"], commodities: ["Agriculture", "Industrial Metals"] },
  Fiscal: { sectors: ["Financials", "Industrials", "Defensives"], commodities: [] },
  Monetary: { sectors: ["Financials", "Technology"], commodities: ["Precious Metals"] },
  China: { sectors: ["Technology", "Industrials", "Materials"], commodities: ["Industrial Metals", "Energy", "Agriculture"] },
  Europe: { sectors: ["Financials", "Cyclicals"], commodities: ["Industrial Metals", "Energy"] },
  "Emerging Markets": { sectors: ["Cyclicals", "Technology", "Materials"], commodities: ["Industrial Metals", "Energy", "Agriculture"] },
};

export const NODE_KIND = {
  COMPANY: "company",
  COMMODITY: "commodity",
  ETF: "etf",
  COUNTRY: "country",
  CURRENCY: "currency",
  INDEX: "index",
  SECTOR: "sector",
  INDICATOR: "indicator",
  MACRO: "macro",
};

const COMPANY_ALIASES = {}; // ticker -> label (extensible)

function node(id, kind, label) {
  return { id, kind, label: label || id, aliases: [id] };
}

// ── EntityRegistry (Phase 5) ───────────────────────────────────────────────
// Lazily-built from the seed so new seed edges automatically appear as nodes.

let _entities = null;

function buildEntities() {
  const map = new Map();
  const add = (id, kind, label) => {
    if (!id) return;
    const key = `${kind}:${String(id).toUpperCase()}`;
    if (!map.has(key)) map.set(key, node(id, kind, label));
    return map.get(key);
  };
  for (const [sym, rel] of Object.entries(COMMODITY_RELATIONS)) {
    const c = add(sym, NODE_KIND.COMMODITY, rel.category ? `${sym} (${rel.category})` : sym);
    (rel.companies || []).forEach((x) => add(x, NODE_KIND.COMPANY, COMPANY_ALIASES[x] || x));
    (rel.etfs || []).forEach((x) => add(x, NODE_KIND.ETF));
    (rel.countries || []).forEach((x) => add(x, NODE_KIND.COUNTRY));
    (rel.currencies || []).forEach((x) => add(x, NODE_KIND.CURRENCY));
    (rel.indexes || []).forEach((x) => add(x, NODE_KIND.INDEX));
  }
  // Companies exposed to commodities (reverse edges) become nodes too.
  for (const co of Object.keys(COMPANY_TO_COMMODITIES)) add(co, NODE_KIND.COMPANY, COMPANY_ALIASES[co] || co);
  // Macro regime + theme nodes (Phase 6). Each regime/theme is a MACRO node
  // that transmits into the sectors/commodities/currencies it drives.
  const macroEdges = buildMacroEdges();
  for (const e of macroEdges) {
    add(e.from, NODE_KIND.MACRO, e.from);
    e.to.forEach((t) => add(t, e.kind, t));
  }
  return map;
}

export function getEntity(id, kind) {
  if (!_entities) _entities = buildEntities();
  if (kind) return _entities.get(`${kind}:${String(id).toUpperCase()}`) || null;
  for (const k of Object.values(NODE_KIND)) {
    const e = _entities.get(`${k}:${String(id).toUpperCase()}`);
    if (e) return e;
  }
  return null;
}

export function allEntities() {
  if (!_entities) _entities = buildEntities();
  return [..._entities.values()];
}

// ── Edges (derived from the seed, with provenance) ────────────────────────

const EDGE_TYPES = {
  PRODUCES: "produces",
  TRACKED_BY: "tracked_by",
  IN_COUNTRY: "in_country",
  QUOTED_IN: "quoted_in",
  INDEXED_BY: "indexed_by",
  EXPOSED_TO: "exposed_to",
};

function buildMacroEdges() {
  const edges = [];
  const push = (from, targets, kind) => {
    if (!targets?.length) return;
    edges.push({ from, to: targets, kind, type: "transmits_to", weight: 0.7, source: "macro-seed" });
  };
  for (const [regime, m] of Object.entries(MACRO_SEED)) {
    push(`Macro:${regime}`, m.sectors, NODE_KIND.SECTOR);
    push(`Macro:${regime}`, m.commodities, NODE_KIND.COMMODITY);
  }
  for (const [theme, m] of Object.entries(MACRO_THEME_EDGES)) {
    push(`Theme:${theme}`, m.sectors, NODE_KIND.SECTOR);
    push(`Theme:${theme}`, m.commodities, NODE_KIND.COMMODITY);
    push(`Theme:${theme}`, m.currencies, NODE_KIND.CURRENCY);
  }
  return edges;
}

function buildEdges() {
  const edges = [];
  for (const [sym, rel] of Object.entries(COMMODITY_RELATIONS)) {
    (rel.companies || []).forEach((co) =>
      edges.push({ from: co, to: sym, type: EDGE_TYPES.PRODUCES, weight: 1, source: "seed" }));
    (rel.etfs || []).forEach((etf) =>
      edges.push({ from: etf, to: sym, type: EDGE_TYPES.TRACKED_BY, weight: 0.8, source: "seed" }));
    (rel.countries || []).forEach((ctry) =>
      edges.push({ from: sym, to: ctry, type: EDGE_TYPES.IN_COUNTRY, weight: 0.5, source: "seed" }));
    (rel.currencies || []).forEach((cur) =>
      edges.push({ from: sym, to: cur, type: EDGE_TYPES.QUOTED_IN, weight: 0.6, source: "seed" }));
    (rel.indexes || []).forEach((idx) =>
      edges.push({ from: sym, to: idx, type: EDGE_TYPES.INDEXED_BY, weight: 0.4, source: "seed" }));
  }
  for (const [co, syms] of Object.entries(COMPANY_TO_COMMODITIES)) {
    syms.forEach((s) =>
      edges.push({ from: co, to: s, type: EDGE_TYPES.EXPOSED_TO, weight: 0.9, source: "seed" }));
  }
  // Macro regime/theme → sector/commodity/currency transmission edges.
  for (const e of buildMacroEdges()) {
    e.to.forEach((t) => edges.push({ from: e.from, to: t, type: e.type, weight: e.weight, source: e.source }));
  }
  return edges;
}

let _edges = null;
export function allEdges() {
  if (!_edges) _edges = buildEdges();
  return _edges;
}

// Adjacency index (undirected for traversal convenience; edge.type stays directional).
let _adj = null;
function adjacency() {
  if (_adj) return _adj;
  const a = new Map();
  const link = (k, edge) => {
    const key = String(k).toUpperCase();
    if (!a.has(key)) a.set(key, []);
    a.get(key).push(edge);
  };
  for (const e of allEdges()) {
    link(e.from, e);
    link(e.to, e);
  }
  _adj = a;
  return a;
}

// ── Multi-hop traversal (Phase 5 core value) ──────────────────────────────
//
// Returns nodes reachable within `maxHops`, each with the path of edge types
// taken. Pure; memoized by (start, maxHops) so callers never recompute.

const _traverseCache = new Map();
const MAX_CACHE = 128;

/**
 * @param {string} start  entity id (symbol/ticker/country/…)
 * @param {object} [opts] { maxHops=2, kinds?, edgeTypes?, includeStart=false }
 * @returns {Array<{ id, kind, label, hops, path: string[] }>}
 */
export function traverse(start, { maxHops = 2, kinds, edgeTypes, includeStart = false } = {}) {
  const key = `${String(start).toUpperCase()}|${maxHops}|${(kinds || []).join(",")}|${(edgeTypes || []).join(",")}|${includeStart}`;
  if (_traverseCache.has(key)) return _traverseCache.get(key);

  const adj = adjacency();
  const visited = new Set();
  const results = [];
  const queue = [{ id: String(start).toUpperCase(), hops: 0, path: [] }];
  visited.add(queue[0].id);

  while (queue.length) {
    const cur = queue.shift();
    if (cur.hops > 0 || includeStart) {
      const ent = getEntity(cur.id);
      const kind = ent?.kind || inferKind(cur.id);
      if (!kinds || kinds.includes(kind)) {
        results.push({ id: cur.id, kind, label: ent?.label || cur.id, hops: cur.hops, path: cur.path });
      }
    }
    if (cur.hops >= maxHops) continue;
    for (const edge of adj.get(cur.id) || []) {
      const next = edge.from.toUpperCase() === cur.id ? edge.to : edge.from;
      if (visited.has(next)) continue;
      if (edgeTypes && !edgeTypes.includes(edge.type)) continue;
      visited.add(next);
      queue.push({ id: next, hops: cur.hops + 1, path: [...cur.path, edge.type] });
    }
  }

  if (_traverseCache.size >= MAX_CACHE) _traverseCache.clear();
  _traverseCache.set(key, results);
  return results;
}

// Lightweight kind inference when the entity isn't in the registry (e.g. a
// portfolio holding symbol we haven't seeded). Keeps traversal honest.
function inferKind(id) {
  const s = String(id || "").toUpperCase();
  if (COMMODITY_RELATIONS[s]) return NODE_KIND.COMMODITY;
  if (getCompanyCommodities(s).length) return NODE_KIND.COMPANY;
  if (s.endsWith("=X") || ["USD", "EUR", "JPY", "GBP"].includes(s)) return NODE_KIND.CURRENCY;
  return "asset";
}

/**
 * Uniform related-assets lookup consumed by every surface (P3/P5).
 * Returns { commodities, companies, etfs, countries, currencies, indexes }.
 * Honest: empty arrays where the seed has no relationship.
 */
export function getRelated(start) {
  const s = String(start || "").toUpperCase();
  const out = { commodities: [], companies: [], etfs: [], countries: [], currencies: [], indexes: [] };
  const rel = getCommodityRelations(s);
  if (rel && Object.keys(rel).length) {
    out.companies = rel.companies || [];
    out.etfs = rel.etfs || [];
    out.countries = rel.countries || [];
    out.currencies = rel.currencies || [];
    out.indexes = rel.indexes || [];
    out.commodities = [s];
    return out;
  }
  const syms = getCompanyCommodities(s);
  if (syms.length) {
    out.companies = [s];
    out.commodities = syms;
    // enrich each commodity with its ETFs/countries for the UI
    for (const c of syms) {
      const cr = getCommodityRelations(c);
      out.etfs = [...new Set([...out.etfs, ...(cr.etfs || [])])];
      out.countries = [...new Set([...out.countries, ...(cr.countries || [])])];
    }
    return out;
  }
  // ETF lead (P5 "ETF Relationship Graph"): derive from the single
  // CORE_ETF_SEED reference — same issuer/category = peers; exposure
  // tokens that match known commodity/country nodes become edges. No
  // fabricated relationships.
  if (CORE_ETF_SEED[s]) {
    const me = CORE_ETF_SEED[s];
    const peers = Object.entries(CORE_ETF_SEED)
      .filter(([sym, m]) => sym !== s && (m.issuer === me.issuer || m.category === me.category))
      .map(([sym]) => sym);
    out.etfs = [...new Set(peers)];
    out.companies = [s];
    const exp = me.exposure || [];
    // exposure → commodity (matches a known commodity node label)
    const KNOWN_CM = Object.keys(COMMODITY_RELATIONS);
    exp.forEach((e) => {
      const hit = KNOWN_CM.find((c) => c.toUpperCase() === e.toUpperCase());
      if (hit) out.commodities.push(hit);
    });
    // exposure → country (descriptive label; Macro consumes as symbol)
    exp.forEach((e) => {
      if (/china|japan|europe|emerg|international|global|us|uk|germany/i.test(e)) {
        const label = /china/i.test(e) ? "China" : /emerg|international|global/i.test(e) ? "Emerging Markets" : e;
        out.countries.push(label);
      }
    });
    out.countries = [...new Set(out.countries)];
    out.commodities = [...new Set(out.commodities)];
    return out;
  }
  return out;
}

// Multi-hop: which entities of `targetKind` are reachable from `start` and how.
export function relatedByKind(start, targetKind, maxHops = 3) {
  return traverse(start, { maxHops, kinds: [targetKind] });
}

export const GRAPH = { NODE_KIND, EDGE_TYPES, getEntity, allEntities, allEdges, traverse, getRelated, relatedByKind };
export default GRAPH;
