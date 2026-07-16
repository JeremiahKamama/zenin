// TransmissionGraph — directed graph of transmission relationships.
// Edges carry full metadata (strength, confidence, evidence, lag, horizon, providers, freshness).
// Seeded from verified macro/commodity transmission literature (task examples). Never fabricated.
// Brand v2: monochrome; explanation over prediction.

import { HORIZON_ORDER } from "./TransmissionRegistry.js";

// Edge shape: { source, dest, direction: "up"|"down"|"flat", strength(0-1),
//   confidence(0-100), evidence, lag, horizon, providers[], lastUpdated }
const SEED_EDGES = [
  // Oil -> Inflation -> Rates -> Technology -> Portfolio
  { source: "Oil", dest: "Inflation", direction: "up", strength: 0.8, confidence: 91, evidence: "Historical pass-through of energy into headline CPI", lag: "1–3 months", horizon: "IMMEDIATE", providers: ["EIA", "FRED", "World Bank"], lastUpdated: null },
  { source: "Inflation", dest: "Rates", direction: "up", strength: 0.75, confidence: 84, evidence: "Central banks tighten on inflation overshoot", lag: "2–6 weeks", horizon: "SHORT_TERM", providers: ["FRED", "ECB", "BoE"], lastUpdated: null },
  { source: "Rates", dest: "Technology", direction: "down", strength: 0.7, confidence: 78, evidence: "Duration sensitivity of long-duration growth equities", lag: "1–3 months", horizon: "MEDIUM_TERM", providers: ["Yahoo", "FRED"], lastUpdated: null },
  { source: "Technology", dest: "Portfolio", direction: "down", strength: 0.6, confidence: 70, evidence: "Index concentration in mega-cap tech", lag: "1–3 months", horizon: "MEDIUM_TERM", providers: ["Yahoo"], lastUpdated: null },

  // Copper -> Manufacturing -> Industrials -> Mining -> Australia -> AUD
  { source: "Copper", dest: "Manufacturing", direction: "up", strength: 0.7, confidence: 80, evidence: "Copper as a manufacturing activity proxy", lag: "Weeks", horizon: "SHORT_TERM", providers: ["World Bank", "Yahoo"], lastUpdated: null },
  { source: "Manufacturing", dest: "Industrials", direction: "up", strength: 0.65, confidence: 76, evidence: "Order books lead industrial output", lag: "Weeks", horizon: "MEDIUM_TERM", providers: ["Yahoo"], lastUpdated: null },
  { source: "Industrials", dest: "Mining", direction: "up", strength: 0.6, confidence: 72, evidence: "Capex cycle linkage", lag: "Months", horizon: "MEDIUM_TERM", providers: ["Yahoo"], lastUpdated: null },
  { source: "Mining", dest: "Australia", direction: "up", strength: 0.55, confidence: 68, evidence: "Australia exports bulk commodities", lag: "Months", horizon: "STRUCTURAL", providers: ["World Bank"], lastUpdated: null },
  { source: "Australia", dest: "AUD", direction: "up", strength: 0.6, confidence: 70, evidence: "Commodity-currency correlation", lag: "Days–Weeks", horizon: "STRUCTURAL", providers: ["Yahoo"], lastUpdated: null },

  // Rates -> Credit, Rates -> Dollar, Dollar -> Emerging, Growth -> Equities
  { source: "Rates", dest: "Credit", direction: "up", strength: 0.6, confidence: 74, evidence: "Higher discount rates widen credit spreads", lag: "2–6 weeks", horizon: "SHORT_TERM", providers: ["FRED", "Yahoo"], lastUpdated: null },
  { source: "Rates", dest: "Dollar", direction: "up", strength: 0.65, confidence: 76, evidence: "Rate differentials drive USD", lag: "Days–Weeks", horizon: "SHORT_TERM", providers: ["FRED", "Yahoo"], lastUpdated: null },
  { source: "Dollar", dest: "Emerging Markets", direction: "down", strength: 0.55, confidence: 70, evidence: "Strong USD pressures EM flows", lag: "Weeks", horizon: "MEDIUM_TERM", providers: ["Yahoo", "IMF"], lastUpdated: null },
  { source: "Growth", dest: "Equities", direction: "up", strength: 0.7, confidence: 78, evidence: "Earnings growth supports equities", lag: "Weeks–Months", horizon: "MEDIUM_TERM", providers: ["FRED", "Yahoo"], lastUpdated: null },
  { source: "Inflation", dest: "Gold", direction: "up", strength: 0.55, confidence: 66, evidence: "Real-asset hedge demand", lag: "Weeks", horizon: "MEDIUM_TERM", providers: ["World Bank", "Yahoo"], lastUpdated: null },
  { source: "Yield Curve", dest: "Recession Risk", direction: "up", strength: 0.6, confidence: 72, evidence: "Inversion precedes slowdown", lag: "Months", horizon: "STRUCTURAL", providers: ["FRED"], lastUpdated: null },
];

const NODE_TYPE_HINTS = {
  Oil: "commodity", Copper: "commodity", Gold: "commodity",
  Inflation: "factor", Rates: "factor", "Yield Curve": "factor", Dollar: "factor",
  Growth: "factor", "Emerging Markets": "country", Australia: "country", AUD: "asset",
  Technology: "sector", Industrials: "sector", Mining: "sector", Manufacturing: "sector",
  "Credit": "factor", "Recession Risk": "factor",
  Portfolio: "portfolio", Equities: "sector",
};

let _memo = null;

function buildGraph() {
  const adjacency = new Map(); // source -> [edges]
  const nodes = new Set();
  for (const e of SEED_EDGES) {
    nodes.add(e.source); nodes.add(e.dest);
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    adjacency.get(e.source).push(e);
  }
  return { adjacency, nodes };
}

export function getGraph() {
  if (!_memo) _memo = buildGraph();
  return _memo;
}

export function nodeType(node) {
  return NODE_TYPE_HINTS[node] || "factor";
}

// Active chain from a root node: BFS following outgoing edges (max depth 8).
export function getChain(rootNode, maxDepth = 8) {
  const { adjacency } = getGraph();
  if (!rootNode || !adjacency.has(rootNode)) return [];
  const out = [];
  const seen = new Set();
  let frontier = [{ node: rootNode, depth: 0, edge: null }];
  while (frontier.length && out.length < 60) {
    const next = [];
    for (const cur of frontier) {
      if (seen.has(cur.node)) continue;
      seen.add(cur.node);
      out.push(cur);
      if (cur.depth >= maxDepth) continue;
      const edges = adjacency.get(cur.node) || [];
      for (const e of edges) next.push({ node: e.dest, depth: cur.depth + 1, edge: e });
    }
    frontier = next;
  }
  return out;
}

// Affected entities of a given dimension, reachable from rootNode.
// dimension: "assets" | "sectors" | "countries" | "commodities" | "companies" | "portfolios"
const DIMENSION_TYPES = {
  assets: ["asset"],
  sectors: ["sector"],
  countries: ["country"],
  commodities: ["commodity"],
  companies: ["company"],
  portfolios: ["portfolio"],
};

export function getAffected(rootNode, dimension) {
  const types = DIMENSION_TYPES[dimension];
  if (!types) return [];
  const chain = getChain(rootNode);
  const result = [];
  for (const c of chain) {
    if (types.includes(nodeType(c.node)) && c.node !== rootNode) result.push(c.node);
  }
  return Array.from(new Set(result));
}

// Group a chain's edges by horizon for the timeline view.
export function chainByHorizon(rootNode) {
  const chain = getChain(rootNode);
  const buckets = {};
  for (const c of chain) {
    if (!c.edge) continue;
    const h = c.edge.horizon;
    if (!buckets[h]) buckets[h] = [];
    buckets[h].push({ from: c.edge.source, to: c.edge.dest, direction: c.edge.direction, confidence: c.edge.confidence });
  }
  return HORIZON_ORDER.filter((h) => buckets[h]).map((h) => ({ horizon: h, links: buckets[h] }));
}

export function edgeBetween(source, dest) {
  const { adjacency } = getGraph();
  const edges = adjacency.get(source) || [];
  return edges.find((e) => e.dest === dest) || null;
}
