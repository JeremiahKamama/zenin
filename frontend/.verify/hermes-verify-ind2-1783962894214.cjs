var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// .verify/stub2-1783962894215/chart.js
var require_chart = __commonJS({
  ".verify/stub2-1783962894215/chart.js"(exports2, module2) {
    var React4 = require("react");
    module2.exports = { TradingViewChart: (props) => React4.createElement("div", { className: "tv-chart-stub" }), default: { TradingViewChart: (props) => React4.createElement("div", { className: "tv-chart-stub" }) } };
  }
});

// src/utils/chartTheme.js
function readToken(name) {
  if (typeof window === "undefined" || !document.documentElement) return "";
  const root = document.documentElement;
  const theme = root.classList.contains("light-theme-active") ? "light" : "dark";
  if (theme !== lastTheme) {
    TOKEN_CACHE.clear();
    lastTheme = theme;
  }
  if (TOKEN_CACHE.has(name)) return TOKEN_CACHE.get(name);
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  TOKEN_CACHE.set(name, value);
  return value;
}
function resolveChartToken(token) {
  const name = token.startsWith("--") ? token : `--${token}`;
  return readToken(name) || token;
}
var TOKEN_CACHE, lastTheme, chartColors;
var init_chartTheme = __esm({
  "src/utils/chartTheme.js"() {
    TOKEN_CACHE = /* @__PURE__ */ new Map();
    lastTheme = "";
    chartColors = {
      // ── Monochrome series (Brand v2) ─────────────────────────────────
      /** Primary series — portfolio / focal line. White on dark, near-black on light. */
      primary: () => resolveChartToken("color-data-primary"),
      /** Secondary series — benchmark. Mid-gray. */
      secondary: () => resolveChartToken("color-data-secondary"),
      /** Tertiary series — historical comparison. Darker gray. */
      muted: () => resolveChartToken("color-data-muted"),
      // Legacy aliases retained so unmigrated call-sites resolve to neutrals
      // instead of cyan. DELETE once all chart consumers use primary/secondary.
      success: () => resolveChartToken("color-success"),
      danger: () => resolveChartToken("color-danger"),
      warning: () => resolveChartToken("color-warning"),
      info: () => resolveChartToken("color-data-secondary"),
      text: () => resolveChartToken("color-text-secondary"),
      textPrimary: () => resolveChartToken("color-text-primary"),
      surface: () => resolveChartToken("color-surface-card"),
      // ── Semantic only ────────────────────────────────────────────────
      /** P&L pair: green positive / red negative. Use ONLY for directional data. */
      pnl: (value) => Number(value || 0) >= 0 ? chartColors.success() : chartColors.danger(),
      up: () => resolveChartToken("color-data-up"),
      down: () => resolveChartToken("color-data-down"),
      // ── Monochrome categorical ramp (for allocation/donut charts) ────
      // White → successively darker gray. No saturated hues.
      palette: () => [
        resolveChartToken("color-data-primary"),
        resolveChartToken("color-data-secondary"),
        resolveChartToken("color-data-muted"),
        resolveChartToken("color-text-dim"),
        resolveChartToken("color-border-strong")
      ]
    };
  }
});

// src/transmission/TransmissionRegistry.js
var HORIZON_ORDER;
var init_TransmissionRegistry = __esm({
  "src/transmission/TransmissionRegistry.js"() {
    HORIZON_ORDER = ["IMMEDIATE", "SHORT_TERM", "MEDIUM_TERM", "STRUCTURAL"];
  }
});

// src/transmission/TransmissionGraph.js
function buildGraph() {
  const adjacency = /* @__PURE__ */ new Map();
  const nodes = /* @__PURE__ */ new Set();
  for (const e of SEED_EDGES) {
    nodes.add(e.source);
    nodes.add(e.dest);
    if (!adjacency.has(e.source)) adjacency.set(e.source, []);
    adjacency.get(e.source).push(e);
  }
  return { adjacency, nodes };
}
function getGraph() {
  if (!_memo) _memo = buildGraph();
  return _memo;
}
function nodeType(node) {
  return NODE_TYPE_HINTS[node] || "factor";
}
function getChain(rootNode, maxDepth = 8) {
  const { adjacency } = getGraph();
  if (!rootNode || !adjacency.has(rootNode)) return [];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
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
function getAffected(rootNode, dimension) {
  const types = DIMENSION_TYPES[dimension];
  if (!types) return [];
  const chain = getChain(rootNode);
  const result = [];
  for (const c of chain) {
    if (types.includes(nodeType(c.node)) && c.node !== rootNode) result.push(c.node);
  }
  return Array.from(new Set(result));
}
function chainByHorizon(rootNode) {
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
function edgeBetween(source, dest) {
  const { adjacency } = getGraph();
  const edges = adjacency.get(source) || [];
  return edges.find((e) => e.dest === dest) || null;
}
var SEED_EDGES, NODE_TYPE_HINTS, _memo, DIMENSION_TYPES;
var init_TransmissionGraph = __esm({
  "src/transmission/TransmissionGraph.js"() {
    init_TransmissionRegistry();
    SEED_EDGES = [
      // Oil -> Inflation -> Rates -> Technology -> Portfolio
      { source: "Oil", dest: "Inflation", direction: "up", strength: 0.8, confidence: 91, evidence: "Historical pass-through of energy into headline CPI", lag: "1\u20133 months", horizon: "IMMEDIATE", providers: ["EIA", "FRED", "World Bank"], lastUpdated: null },
      { source: "Inflation", dest: "Rates", direction: "up", strength: 0.75, confidence: 84, evidence: "Central banks tighten on inflation overshoot", lag: "2\u20136 weeks", horizon: "SHORT_TERM", providers: ["FRED", "ECB", "BoE"], lastUpdated: null },
      { source: "Rates", dest: "Technology", direction: "down", strength: 0.7, confidence: 78, evidence: "Duration sensitivity of long-duration growth equities", lag: "1\u20133 months", horizon: "MEDIUM_TERM", providers: ["Yahoo", "FRED"], lastUpdated: null },
      { source: "Technology", dest: "Portfolio", direction: "down", strength: 0.6, confidence: 70, evidence: "Index concentration in mega-cap tech", lag: "1\u20133 months", horizon: "MEDIUM_TERM", providers: ["Yahoo"], lastUpdated: null },
      // Copper -> Manufacturing -> Industrials -> Mining -> Australia -> AUD
      { source: "Copper", dest: "Manufacturing", direction: "up", strength: 0.7, confidence: 80, evidence: "Copper as a manufacturing activity proxy", lag: "Weeks", horizon: "SHORT_TERM", providers: ["World Bank", "Yahoo"], lastUpdated: null },
      { source: "Manufacturing", dest: "Industrials", direction: "up", strength: 0.65, confidence: 76, evidence: "Order books lead industrial output", lag: "Weeks", horizon: "MEDIUM_TERM", providers: ["Yahoo"], lastUpdated: null },
      { source: "Industrials", dest: "Mining", direction: "up", strength: 0.6, confidence: 72, evidence: "Capex cycle linkage", lag: "Months", horizon: "MEDIUM_TERM", providers: ["Yahoo"], lastUpdated: null },
      { source: "Mining", dest: "Australia", direction: "up", strength: 0.55, confidence: 68, evidence: "Australia exports bulk commodities", lag: "Months", horizon: "STRUCTURAL", providers: ["World Bank"], lastUpdated: null },
      { source: "Australia", dest: "AUD", direction: "up", strength: 0.6, confidence: 70, evidence: "Commodity-currency correlation", lag: "Days\u2013Weeks", horizon: "STRUCTURAL", providers: ["Yahoo"], lastUpdated: null },
      // Rates -> Credit, Rates -> Dollar, Dollar -> Emerging, Growth -> Equities
      { source: "Rates", dest: "Credit", direction: "up", strength: 0.6, confidence: 74, evidence: "Higher discount rates widen credit spreads", lag: "2\u20136 weeks", horizon: "SHORT_TERM", providers: ["FRED", "Yahoo"], lastUpdated: null },
      { source: "Rates", dest: "Dollar", direction: "up", strength: 0.65, confidence: 76, evidence: "Rate differentials drive USD", lag: "Days\u2013Weeks", horizon: "SHORT_TERM", providers: ["FRED", "Yahoo"], lastUpdated: null },
      { source: "Dollar", dest: "Emerging Markets", direction: "down", strength: 0.55, confidence: 70, evidence: "Strong USD pressures EM flows", lag: "Weeks", horizon: "MEDIUM_TERM", providers: ["Yahoo", "IMF"], lastUpdated: null },
      { source: "Growth", dest: "Equities", direction: "up", strength: 0.7, confidence: 78, evidence: "Earnings growth supports equities", lag: "Weeks\u2013Months", horizon: "MEDIUM_TERM", providers: ["FRED", "Yahoo"], lastUpdated: null },
      { source: "Inflation", dest: "Gold", direction: "up", strength: 0.55, confidence: 66, evidence: "Real-asset hedge demand", lag: "Weeks", horizon: "MEDIUM_TERM", providers: ["World Bank", "Yahoo"], lastUpdated: null },
      { source: "Yield Curve", dest: "Recession Risk", direction: "up", strength: 0.6, confidence: 72, evidence: "Inversion precedes slowdown", lag: "Months", horizon: "STRUCTURAL", providers: ["FRED"], lastUpdated: null }
    ];
    NODE_TYPE_HINTS = {
      Oil: "commodity",
      Copper: "commodity",
      Gold: "commodity",
      Inflation: "factor",
      Rates: "factor",
      "Yield Curve": "factor",
      Dollar: "factor",
      Growth: "factor",
      "Emerging Markets": "country",
      Australia: "country",
      AUD: "asset",
      Technology: "sector",
      Industrials: "sector",
      Mining: "sector",
      Manufacturing: "sector",
      "Credit": "factor",
      "Recession Risk": "factor",
      Portfolio: "portfolio",
      Equities: "sector"
    };
    _memo = null;
    DIMENSION_TYPES = {
      assets: ["asset"],
      sectors: ["sector"],
      countries: ["country"],
      commodities: ["commodity"],
      companies: ["company"],
      portfolios: ["portfolio"]
    };
  }
});

// src/transmission/TransmissionConfidence.js
function clampConfidence(value) {
  const c = Number(value);
  if (!Number.isFinite(c)) return 5;
  return Math.max(5, Math.min(95, Math.round(c)));
}
function propagateConfidence(rootConfidence, hops) {
  let conf = clampConfidence(rootConfidence);
  for (let i = 0; i < hops; i++) {
    conf = clampConfidence(conf * (1 - HOP_DECAY));
  }
  return conf;
}
function chainConfidence(edges = []) {
  if (!edges.length) return 0;
  const perEdge = edges.map((e) => Number(e.confidence) || 0);
  const avg = perEdge.reduce((a, b) => a + b, 0) / perEdge.length;
  const discount = Math.max(0.7, 1 - (edges.length - 1) * 0.05);
  return clampConfidence(avg * discount);
}
var HOP_DECAY;
var init_TransmissionConfidence = __esm({
  "src/transmission/TransmissionConfidence.js"() {
    HOP_DECAY = 0.12;
  }
});

// src/transmission/TransmissionRuleEngine.js
function resolveRoot(driverLabel) {
  const key = String(driverLabel || "").toLowerCase();
  for (const k of Object.keys(DRIVER_TO_NODE)) {
    if (key.includes(k)) return DRIVER_TO_NODE[k];
  }
  return titleCase(key);
}
function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}
function pickRoots(signals = []) {
  const roots = [];
  for (const s of signals) {
    const label = s?.label || s?.indicator || s?.name || "";
    const node = resolveRoot(label);
    if (node) roots.push({ node, positive: s.positive !== false, weight: Number(s.strength) || 1 });
  }
  return roots;
}
function computeTransmission({ signals = [], rootConfidence = 70 } = {}) {
  const roots = pickRoots(signals);
  if (!roots.length) {
    return { active: [], confidence: 0, hasTransmission: false };
  }
  const active = roots.map((r, i) => {
    const chain = getChain(r.node);
    const edges = chain.filter((c) => c.edge).map((c) => c.edge);
    const confidence = chainConfidence(edges.length ? edges : [{ confidence: rootConfidence }]);
    const hopConf = propagateConfidence(rootConfidence, chain.length - 1);
    return {
      root: r.node,
      direction: r.positive ? "up" : "down",
      chain: chain.map((c) => ({ node: c.node, depth: c.depth, edge: c.edge })),
      confidence: Math.min(confidence, hopConf),
      affected: {
        assets: getAffected(r.node, "assets"),
        sectors: getAffected(r.node, "sectors"),
        countries: getAffected(r.node, "countries"),
        commodities: getAffected(r.node, "commodities"),
        companies: getAffected(r.node, "companies"),
        portfolios: getAffected(r.node, "portfolios")
      },
      horizons: chainByHorizon(r.node)
    };
  });
  const overall = clampConfidence(active.reduce((a, b) => a + b.confidence, 0) / active.length);
  return { active, confidence: overall, hasTransmission: true };
}
function signalsFromMacroExecutive(exec) {
  if (!exec) return [];
  const out = [];
  if (exec.drivers) for (const d of exec.drivers) out.push({ label: d.label, positive: d.positive !== false });
  if (exec.regime) out.push({ label: exec.regime, positive: exec.tone !== "negative" });
  out.push({ label: "Inflation", positive: exec.tone !== "negative" });
  out.push({ label: "Rates", positive: exec.tone !== "negative" });
  return out;
}
function signalsFromCommoditiesExecutive(exec) {
  if (!exec || !exec.states) return [];
  return exec.states.map((s) => ({ label: s.group, positive: s.tone === "positive" }));
}
var DRIVER_TO_NODE;
var init_TransmissionRuleEngine = __esm({
  "src/transmission/TransmissionRuleEngine.js"() {
    init_TransmissionGraph();
    init_TransmissionConfidence();
    DRIVER_TO_NODE = {
      "oil": "Oil",
      "crude": "Oil",
      "energy": "Oil",
      "wti": "Oil",
      "brent": "Oil",
      "inflation": "Inflation",
      "cpi": "Inflation",
      "pce": "Inflation",
      "rates": "Rates",
      "fed": "Rates",
      "tighten": "Rates",
      "yield": "Yield Curve",
      "curve": "Yield Curve",
      "inversion": "Yield Curve",
      "dollar": "Dollar",
      "usd": "Dollar",
      "dxy": "Dollar",
      "growth": "Growth",
      "gdp": "Growth",
      "expansion": "Growth",
      "copper": "Copper",
      "gold": "Gold",
      "credit": "Credit",
      "spread": "Credit"
    };
  }
});

// src/transmission/TransmissionCache.js
function signature(signals = [], rootConfidence) {
  const s = (signals || []).map((x) => `${x.label}:${x.positive ? 1 : 0}`).sort().join("|");
  return `${s}#${rootConfidence || 0}`;
}
function getTransmission({ signals = [], rootConfidence = 70 } = {}) {
  const key = signature(signals, rootConfidence);
  if (_cache.has(key)) return _cache.get(key);
  const result = computeTransmission({ signals, rootConfidence });
  if (_cache.size >= MAX_ENTRIES) {
    const firstKey = _cache.keys().next().value;
    _cache.delete(firstKey);
  }
  _cache.set(key, result);
  return result;
}
function invalidate() {
  _cache.clear();
}
var _cache, MAX_ENTRIES;
var init_TransmissionCache = __esm({
  "src/transmission/TransmissionCache.js"() {
    init_TransmissionRuleEngine();
    _cache = /* @__PURE__ */ new Map();
    MAX_ENTRIES = 64;
  }
});

// src/components/macro/MacroProviderRegistry.js
function resolveProviderId(raw = "") {
  const s = String(raw || "").toUpperCase();
  if (!s) return null;
  if (s.includes("FRED")) return "FRED";
  if (s.includes("BLS") || s.includes("LABOR")) return "BLS";
  if (s.includes("WORLD BANK") || s.includes("WORLDBANK")) return "WORLDBANK";
  if (s.includes("IMF")) return "IMF";
  if (s.includes("TRADINGECONOMICS") || s.includes("TE ")) return "TRADINGECONOMICS";
  if (s.includes("ECB") || s.includes("EUROPEAN CENTRAL")) return "ECB";
  if (s.includes("BOE") || s.includes("ENGLAND")) return "BOE";
  if (s.includes("BOJ") || s.includes("JAPAN")) return "BOJ";
  if (s.includes("OECD")) return "OECD";
  if (s.includes("YAHOO")) return "YAHOO";
  return null;
}
function getProvider(raw) {
  const id = resolveProviderId(raw);
  return id ? MACRO_PROVIDERS[id] : null;
}
function providerLabel(raw) {
  const p = getProvider(raw);
  return p ? p.label : String(raw || "Source").trim();
}
var MACRO_PROVIDERS;
var init_MacroProviderRegistry = __esm({
  "src/components/macro/MacroProviderRegistry.js"() {
    MACRO_PROVIDERS = {
      FRED: { id: "FRED", label: "FRED", full: "Federal Reserve Economic Data", scope: "USA", kind: "central-bank" },
      BLS: { id: "BLS", label: "BLS", full: "Bureau of Labor Statistics", scope: "USA", kind: "government" },
      WORLDBANK: { id: "WORLDBANK", label: "World Bank", full: "The World Bank", scope: "Global", kind: "multilateral" },
      IMF: { id: "IMF", label: "IMF", full: "International Monetary Fund", scope: "Global", kind: "multilateral" },
      TRADINGECONOMICS: { id: "TRADINGECONOMICS", label: "Trading Economics", full: "Trading Economics", scope: "Global", kind: "aggregator" },
      ECB: { id: "ECB", label: "ECB", full: "European Central Bank", scope: "Eurozone", kind: "central-bank" },
      BOE: { id: "BOE", label: "BoE", full: "Bank of England", scope: "United Kingdom", kind: "central-bank" },
      BOJ: { id: "BOJ", label: "BoJ", full: "Bank of Japan", scope: "Japan", kind: "central-bank" },
      OECD: { id: "OECD", label: "OECD", full: "Organisation for Economic Co-operation and Development", scope: "Global", kind: "multilateral" },
      YAHOO: { id: "YAHOO", label: "Yahoo", full: "Yahoo Finance", scope: "Global", kind: "market" }
    };
  }
});

// src/transmission/TransmissionEvidence.js
function buildEvidence(edge = {}) {
  const providers = Array.isArray(edge.providers) ? edge.providers : [];
  return {
    providers: providers.map((p) => providerLabel(p)),
    rawProviders: providers,
    method: edge.evidence || "Historical relationship",
    confidence: Number(edge.confidence) || null,
    freshness: edge.lastUpdated ? "Updated" : "Not time-sensitive",
    lastUpdated: edge.lastUpdated || null,
    coverage: providers.length ? "Verified" : "Unverified"
  };
}
function formatFreshness(value) {
  if (!value) return "Not time-sensitive";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 6e4));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}
var init_TransmissionEvidence = __esm({
  "src/transmission/TransmissionEvidence.js"() {
    init_MacroProviderRegistry();
  }
});

// src/transmission/TransmissionFormatter.js
var NO_TRANSMISSION;
var init_TransmissionFormatter = __esm({
  "src/transmission/TransmissionFormatter.js"() {
    init_TransmissionRegistry();
    NO_TRANSMISSION = "No verified transmission available.";
  }
});

// src/transmission/TransmissionEvents.js
function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(payload);
    } catch (e) {
    }
  }
}
var listeners, TX_EVENTS;
var init_TransmissionEvents = __esm({
  "src/transmission/TransmissionEvents.js"() {
    listeners = /* @__PURE__ */ new Map();
    TX_EVENTS = {
      PUBLISH_SIGNALS: "transmission:publish-signals",
      OPEN_EXPLORER: "transmission:open-explorer",
      CHAIN_UPDATED: "transmission:chain-updated"
    };
  }
});

// src/transmission/TransmissionEngine.js
function publishExecutive(kind, exec, opts = {}) {
  const signals = kind === "macro" ? signalsFromMacroExecutive(exec) : kind === "commodity" ? signalsFromCommoditiesExecutive(exec) : [];
  const rootConfidence = exec?.confidence ?? opts.rootConfidence ?? 70;
  const result = getTransmission({ signals, rootConfidence });
  emit(TX_EVENTS.CHAIN_UPDATED, { kind, result });
  return result;
}
function publishSignals(signals = [], opts = {}) {
  const result = getTransmission({ signals, rootConfidence: opts.rootConfidence });
  emit(TX_EVENTS.PUBLISH_SIGNALS, { signals, result });
  return result;
}
function getActiveChain(rootNode) {
  return getChain(rootNode);
}
function getAffected2(rootNode, dimension) {
  return getAffected(rootNode, dimension);
}
function getHorizons(rootNode) {
  return chainByHorizon(rootNode);
}
function getEvidence(source, dest) {
  const edge = edgeBetween(source, dest);
  if (!edge) return { providers: [], method: NO_TRANSMISSION, confidence: null, freshness: "n/a", coverage: "Unverified" };
  return { ...buildEvidence(edge), freshness: formatFreshness(edge.lastUpdated) };
}
function openExplorer(node, context = {}) {
  emit(TX_EVENTS.OPEN_EXPLORER, { node, context });
}
function clearCache() {
  invalidate();
}
var TransmissionEngine;
var init_TransmissionEngine = __esm({
  "src/transmission/TransmissionEngine.js"() {
    init_TransmissionCache();
    init_TransmissionRuleEngine();
    init_TransmissionGraph();
    init_TransmissionEvidence();
    init_TransmissionFormatter();
    init_TransmissionEvents();
    TransmissionEngine = {
      publishExecutive,
      publishSignals,
      getActiveChain,
      getAffected: getAffected2,
      getHorizons,
      getEvidence,
      openExplorer,
      clearCache,
      NO_TRANSMISSION
    };
  }
});

// src/utils/commodityGroups.ts
var COMMODITY_GROUP_ORDER, COMMODITY_GROUP_DEFS, COMMODITY_GROUP_IDS;
var init_commodityGroups = __esm({
  "src/utils/commodityGroups.ts"() {
    COMMODITY_GROUP_ORDER = [
      "all",
      "energy",
      "metals",
      "industrial",
      "agriculture",
      "soft",
      "battery",
      "fertilizers",
      "livestock"
    ];
    COMMODITY_GROUP_DEFS = {
      energy: {
        id: "energy",
        label: "Energy",
        symbols: ["CL", "BZ", "NG", "RB", "HO"],
        inventorySources: ["EIA", "Crude", "Gasoline", "Distillates", "Natural Gas"],
        weatherThemes: ["Pipeline storms", "Heat", "Hurricanes", "Freeze"],
        supplyEvents: ["OPEC Meeting", "EIA Inventory", "Natural Gas Storage", "Refinery Outages"]
      },
      metals: {
        id: "metals",
        label: "Metals",
        symbols: ["GC", "SI", "HG", "PA", "PL"],
        inventorySources: ["LME", "COMEX", "Warehouse Stocks"],
        weatherThemes: ["Mine-region weather", "Power outages"],
        supplyEvents: ["LME Stocks", "COMEX Deliveries", "Smelter Outages"]
      },
      industrial: {
        id: "industrial",
        label: "Industrial",
        symbols: ["HG", "ALI", "ZN", "NI", "STEEL"],
        inventorySources: ["LME", "SHFE", "Warehouse Stocks"],
        weatherThemes: ["Mine-region weather", "Logistics"],
        supplyEvents: ["Production Data", "Trade Flows"]
      },
      agriculture: {
        id: "agriculture",
        label: "Agriculture",
        symbols: ["ZC", "ZW", "ZS", "KE", "RR", "ZM"],
        inventorySources: ["USDA", "Corn", "Soybeans", "Wheat"],
        weatherThemes: ["Rainfall", "Temperature", "Drought", "Harvest"],
        supplyEvents: ["WASDE", "Crop Progress", "Export Sales", "Harvest"]
      },
      soft: {
        id: "soft",
        label: "Soft",
        symbols: ["CC", "KC", "SB", "CT", "OJ"],
        inventorySources: ["ICE", "Exchange Stocks"],
        weatherThemes: ["Brazil", "India", "Vietnam", "Weather"],
        supplyEvents: ["Crop Progress", "Export Sales", "Weather Shocks"]
      },
      battery: {
        id: "battery",
        label: "Battery",
        // No single liquid futures complex; documented proxies + liquid members only — never fabricated.
        symbols: ["Lithium", "Uranium", "Cobalt", "Rare Earth", "Nickel"],
        inventorySources: ["Exchange Stocks", "Producer Disclosures"],
        weatherThemes: ["Mine-region weather", "Logistics"],
        supplyEvents: ["Producer Guidance", "Refinery Outages"]
      },
      fertilizers: {
        id: "fertilizers",
        label: "Fertilizers",
        symbols: ["Urea", "Potash", "Phosphate"],
        inventorySources: ["Producer Disclosures", "Exchange Stocks"],
        weatherThemes: ["Natural Gas (feedstock)", "Logistics"],
        supplyEvents: ["Producer Guidance", "Export Policy"]
      },
      livestock: {
        id: "livestock",
        label: "Livestock",
        symbols: ["LE", "HE", "GF"],
        inventorySources: ["USDA", "Cold Storage"],
        weatherThemes: ["Heat Stress", "Feed Costs"],
        supplyEvents: ["Cattle on Feed", "Cold Storage", "Export Sales"]
      }
    };
    COMMODITY_GROUP_IDS = Object.keys(COMMODITY_GROUP_DEFS);
  }
});

// src/utils/deskIntelligence.js
var REGISTRY_GROUPS;
var init_deskIntelligence = __esm({
  "src/utils/deskIntelligence.js"() {
    init_commodityGroups();
    REGISTRY_GROUPS = COMMODITY_GROUP_ORDER.filter((g) => g !== "all");
  }
});

// src/utils/assetGraph.js
var COMMODITY_RELATIONS, COMPANY_TO_COMMODITIES_EXPLICIT, COMPANY_TO_COMMODITIES_DERIVED;
var init_assetGraph = __esm({
  "src/utils/assetGraph.js"() {
    COMMODITY_RELATIONS = {
      CL: { companies: ["XOM", "CVX", "COP"], etfs: ["XLE", "USO"], countries: ["Saudi Arabia", "USA", "Russia"], currencies: ["USD"], indexes: ["OPEC"], category: "Energy", exchange: "NYMEX", tick: 0.01, unit: "USD/bbl", delivery: "Physical", settlement: "Cash/Physical" },
      WTI: { companies: ["XOM", "CVX", "COP"], etfs: ["XLE", "USO"], countries: ["Saudi Arabia", "USA", "Russia"], currencies: ["USD"], indexes: ["OPEC"], category: "Energy", exchange: "NYMEX", tick: 0.01, unit: "USD/bbl", delivery: "Physical", settlement: "Cash/Physical" },
      BRENT: { companies: ["XOM", "CVX", "BP"], etfs: ["BNO", "XLE"], countries: ["UK", "Saudi Arabia", "Russia"], currencies: ["USD"], indexes: ["OPEC"], category: "Energy", exchange: "ICE", tick: 0.01, unit: "USD/bbl", delivery: "Physical", settlement: "Cash" },
      NG: { companies: ["CHK", "EQT", "XOM"], etfs: ["UNG"], countries: ["USA"], currencies: ["USD"], indexes: [], category: "Energy", exchange: "NYMEX", tick: 1e-3, unit: "USD/MMBtu", delivery: "Physical", settlement: "Cash/Physical" },
      HG: { companies: ["FCX", "RIO", "BHP"], etfs: ["COPX"], countries: ["Chile", "China", "Peru"], currencies: ["USD"], indexes: ["Manufacturing PMI"], category: "Industrial Metals", exchange: "COMEX", tick: 5e-4, unit: "USD/lb", delivery: "Physical", settlement: "Cash/Physical" },
      COPPER: { companies: ["FCX", "RIO", "BHP"], etfs: ["COPX"], countries: ["Chile", "China", "Peru"], currencies: ["USD"], indexes: ["Manufacturing PMI"], category: "Industrial Metals", exchange: "COMEX", tick: 5e-4, unit: "USD/lb", delivery: "Physical", settlement: "Cash/Physical" },
      GC: { companies: ["NEM", "GOLD", "AEM"], etfs: ["GLD", "GDX"], countries: ["USA", "Canada", "Australia"], currencies: ["USD"], indexes: ["Real Rates"], category: "Precious Metals", exchange: "COMEX", tick: 0.1, unit: "USD/oz", delivery: "Physical", settlement: "Cash/Physical" },
      GOLD: { companies: ["NEM", "GOLD", "AEM"], etfs: ["GLD", "GDX"], countries: ["USA", "Canada", "Australia"], currencies: ["USD"], indexes: ["Real Rates"], category: "Precious Metals", exchange: "COMEX", tick: 0.1, unit: "USD/oz", delivery: "Physical", settlement: "Cash/Physical" },
      SI: { companies: ["PAAS", "AG"], etfs: ["SLV"], countries: ["Mexico", "Peru"], currencies: ["USD"], indexes: [], category: "Precious Metals", exchange: "COMEX", tick: 5e-3, unit: "USD/oz", delivery: "Physical", settlement: "Cash/Physical" },
      ZW: { companies: ["ADM", "BG"], etfs: ["WEAT"], countries: ["USA", "Russia", "Ukraine"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" },
      WHEAT: { companies: ["ADM", "BG"], etfs: ["WEAT"], countries: ["USA", "Russia", "Ukraine"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" },
      ZC: { companies: ["ADM", "BG"], etfs: ["CORN"], countries: ["USA", "Brazil"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" },
      ZS: { companies: ["ADM", "BG"], etfs: ["SOYB"], countries: ["USA", "Brazil", "Argentina"], currencies: ["USD"], indexes: ["WASDE"], category: "Agriculture", exchange: "CBOT", tick: 0.25, unit: "USD/bu", delivery: "Physical", settlement: "Cash/Physical" }
    };
    COMPANY_TO_COMMODITIES_EXPLICIT = {
      XOM: ["CL", "WTI", "BRENT", "NG"],
      CVX: ["CL", "WTI", "NG"],
      COP: ["CL", "WTI", "NG"],
      BP: ["BRENT"],
      CHK: ["NG"],
      EQT: ["NG"],
      FCX: ["HG", "COPPER"],
      RIO: ["HG", "COPPER"],
      BHP: ["HG", "COPPER"],
      NEM: ["GC", "GOLD"],
      GOLD: ["GC", "GOLD"],
      AEM: ["GC", "GOLD"],
      PAAS: ["SI"],
      AG: ["SI"],
      ADM: ["ZW", "WHEAT", "ZC", "ZS"],
      BG: ["ZW", "WHEAT", "ZC", "ZS"]
    };
    COMPANY_TO_COMMODITIES_DERIVED = (() => {
      const out = {};
      for (const [sym, rel] of Object.entries(COMMODITY_RELATIONS)) {
        for (const co of rel.companies || []) {
          (out[co] = out[co] || []).push(sym);
        }
      }
      for (const [co, syms] of Object.entries(COMPANY_TO_COMMODITIES_EXPLICIT)) {
        const set = /* @__PURE__ */ new Set([...out[co] || [], ...syms]);
        out[co] = [...set];
      }
      return out;
    })();
  }
});

// src/utils/relationshipGraph.js
var init_relationshipGraph = __esm({
  "src/utils/relationshipGraph.js"() {
    init_assetGraph();
  }
});

// src/utils/intelligenceBus.js
function getRegime() {
  return _state.regime;
}
function getMacroSignal() {
  return _state.macroSignal;
}
var _state;
var init_intelligenceBus = __esm({
  "src/utils/intelligenceBus.js"() {
    init_deskIntelligence();
    init_TransmissionRegistry();
    init_TransmissionEvents();
    init_relationshipGraph();
    init_assetGraph();
    _state = {
      regime: null,
      // { label, score, explain, drivers, tone, risk }
      macroSignal: null,
      // MarketSignal (Phase 5 schema) from deskIntelligence
      updatedAt: null,
      source: null,
      // e.g. "geo:US"
      listeners: /* @__PURE__ */ new Set()
    };
  }
});

// src/components/macro/MacroIndicatorRegistry.js
var MACRO_INDICATORS, BY_CODE;
var init_MacroIndicatorRegistry = __esm({
  "src/components/macro/MacroIndicatorRegistry.js"() {
    MACRO_INDICATORS = [
      { code: "GDP", label: "GDP", unit: "", kind: "trillions", group: "Growth", fred: "GDP" },
      { code: "CPI", label: "CPI", unit: "%", kind: "percentage", group: "Inflation", fred: "CPIAUCSL" },
      { code: "INFLATION", label: "Inflation", unit: "%", kind: "percentage", group: "Inflation", fred: "CPIAUCSL" },
      { code: "INTEREST_RATE", label: "Interest Rate", unit: "%", kind: "rate", group: "Policy", fred: "FEDFUNDS" },
      { code: "PMI", label: "PMI", unit: "", kind: "index", group: "Activity", fred: "NAPM" },
      { code: "RETAIL_SALES", label: "Retail Sales", unit: "%", kind: "percentage", group: "Activity", fred: "RSAFS" },
      { code: "MONEY_SUPPLY", label: "Money Supply", unit: "", kind: "trillions", group: "Liquidity", fred: "M2SL" },
      { code: "HOUSING", label: "Housing", unit: "%", kind: "percentage", group: "Activity", fred: "HOUST" },
      { code: "EMPLOYMENT", label: "Employment", unit: "%", kind: "percentage", group: "Labor", fred: "UNRATE" },
      { code: "CURRENT_ACCOUNT", label: "Current Account", unit: "", kind: "billions", group: "External", fred: "BOPBCA" },
      { code: "DEBT", label: "Debt", unit: "", kind: "trillions", group: "Fiscal", fred: "GFDEBTN" }
    ];
    BY_CODE = Object.fromEntries(MACRO_INDICATORS.map((i) => [i.code, i]));
  }
});

// src/components/CompactWorkspaceUI.jsx
function MetricStrip({ items = [], className = "" }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("section", { className: `metric-strip ${className}`.trim(), "aria-label": "Summary metrics", children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("article", { className: `metric-strip-item ${item.tone || "neutral"}`.trim(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: item.label }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: item.value }),
    item.helper ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("em", { children: item.helper }) : null
  ] }, item.label)) });
}
function DensePanelHeader({
  title,
  subtitle,
  meta,
  actions: actions2,
  className = ""
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dense-panel-header ${className}`.trim(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dense-panel-copy", children: [
      title ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: title }) : null,
      subtitle ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: subtitle }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dense-panel-actions", children: [
      meta ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dense-panel-meta", children: meta }) : null,
      actions2
    ] })
  ] });
}
function GuidedEmptyState({
  eyebrow = "Next Step",
  title,
  description,
  steps = [],
  cta,
  onAction,
  secondaryCta,
  onSecondaryAction,
  tone = "default",
  className = ""
}) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: `guided-empty-state ${tone} ${className}`.trim(), role: "status", "aria-live": "polite", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "guided-empty-copy", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: eyebrow }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h3", { children: title }),
      description ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: description }) : null
    ] }),
    steps.length ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "guided-empty-steps", children: steps.map((step, index) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "guided-empty-step", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: index + 1 }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: step })
    ] }, `${step}-${index}`)) }) : null,
    cta || secondaryCta ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "guided-empty-actions", children: [
      cta ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "journal-btn primary", onClick: onAction, children: cta }) : null,
      secondaryCta ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: "journal-btn secondary", onClick: onSecondaryAction, children: secondaryCta }) : null
    ] }) : null
  ] });
}
var import_react, import_jsx_runtime;
var init_CompactWorkspaceUI = __esm({
  "src/components/CompactWorkspaceUI.jsx"() {
    import_react = require("react");
    import_jsx_runtime = require("react/jsx-runtime");
  }
});

// src/utils/indicatorActions.jsx
var indicatorActions_exports = {};
__export(indicatorActions_exports, {
  IndicatorActionsProvider: () => IndicatorActionsProvider,
  useIndicatorActions: () => useIndicatorActions,
  useIndicatorActionsContext: () => useIndicatorActionsContext
});
function IndicatorActionsProvider({ value, children }) {
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(IndicatorActionsContext.Provider, { value: value || null, children });
}
function useIndicatorActionsContext() {
  return (0, import_react2.useContext)(IndicatorActionsContext);
}
function useIndicatorActions(props = {}) {
  const ctx = (0, import_react2.useContext)(IndicatorActionsContext);
  const src = { ...ctx };
  if (props) {
    for (const k of Object.keys(props)) {
      if (props[k] !== void 0) src[k] = props[k];
    }
  }
  return {
    isInWatchlist: src.isInWatchlist,
    onToggleStar: src.onToggleStar,
    onCompare: src.onCompare,
    onOpenResearch: src.onOpenResearch,
    onOpenProfile: src.onOpenProfile,
    onOpenTransmission: src.onOpenTransmission,
    onPin: src.onPin,
    isPinned: src.isPinned,
    onAlert: src.onAlert,
    onExport: src.onExport,
    onCopyLink: src.onCopyLink,
    onDecisionLedger: src.onDecisionLedger,
    onExposure: src.onExposure,
    onSelectIndicator: src.onSelectIndicator,
    onJournal: src.onJournal,
    onScenario: src.onScenario,
    onMacroWorkspace: src.onMacroWorkspace
  };
}
var import_react2, import_jsx_runtime2, IndicatorActionsContext;
var init_indicatorActions = __esm({
  "src/utils/indicatorActions.jsx"() {
    import_react2 = __toESM(require("react"), 1);
    import_jsx_runtime2 = require("react/jsx-runtime");
    IndicatorActionsContext = (0, import_react2.createContext)(null);
  }
});

// src/utils/assetActionRegistry.js
function getActionsForKind(kind) {
  return DEFAULT_KIND_ACTIONS.map((k) => ASSET_ACTIONS[k]).filter(Boolean).sort((a, b) => a.order - b.order);
}
var ASSET_ACTIONS, DEFAULT_KIND_ACTIONS;
var init_assetActionRegistry = __esm({
  "src/utils/assetActionRegistry.js"() {
    ASSET_ACTIONS = {
      research: { key: "research", label: "Research", order: 10 },
      profile: { key: "profile", label: "Profile", order: 20 },
      watchlist: { key: "watchlist", label: "Watch", order: 30 },
      pin: { key: "pin", label: "Pin", order: 40 },
      alert: { key: "alert", label: "Alert", order: 50 },
      compare: { key: "compare", label: "Compare", order: 60 },
      transmission: { key: "transmission", label: "Transmission", order: 70 },
      decisionLedger: { key: "decisionLedger", label: "Decision Ledger", order: 80 },
      exposure: { key: "exposure", label: "Portfolio Exposure", order: 90 },
      export: { key: "export", label: "Export", order: 100 },
      copyLink: { key: "copyLink", label: "Copy Link", order: 110 },
      journal: { key: "journal", label: "Journal", order: 120, optional: true },
      scenario: { key: "scenario", label: "Scenario Lab", order: 130, optional: true },
      macro: { key: "macro", label: "Macro Workspace", order: 140, optional: true }
    };
    DEFAULT_KIND_ACTIONS = [
      "research",
      "profile",
      "watchlist",
      "pin",
      "alert",
      "compare",
      "transmission",
      "decisionLedger",
      "exposure",
      "export",
      "copyLink",
      "journal",
      "scenario",
      "macro"
    ];
  }
});

// src/components/IndicatorMetricModal.jsx
var IndicatorMetricModal_exports = {};
__export(IndicatorMetricModal_exports, {
  IndicatorMetricModal: () => IndicatorMetricModal,
  default: () => IndicatorMetricModal_default
});
function toGraphRoot(metric2) {
  const code = String(metric2?.code || "").toUpperCase();
  const label = String(metric2?.label || "").toLowerCase();
  const group = String(metric2?.group || "").toLowerCase();
  const MAP = {
    CPI: "Inflation",
    INFLATION: "Inflation",
    PPI: "Inflation",
    CORE_CPI: "Inflation",
    PCE: "Inflation",
    INTEREST_RATE: "Rates",
    YIELD_CURVE: "Yield Curve",
    RATES: "Rates",
    OIL: "Oil",
    ENERGY: "Oil",
    COPPER: "Copper",
    GOLD: "Gold",
    EMPLOYMENT: "Growth",
    GDP: "Growth",
    PMI: "Growth",
    DXY: "Dollar",
    DOLLAR: "Dollar"
  };
  if (MAP[code]) return MAP[code];
  if (label.includes("cpi") || label.includes("inflation") || label.includes("ppi")) return "Inflation";
  if (label.includes("rate") || label.includes("yield")) return "Rates";
  if (label.includes("employ") || label.includes("gdp") || label.includes("pmi") || label.includes("growth")) return "Growth";
  if (label.includes("dollar") || label.includes("dxy") || group === "external") return "Dollar";
  if (label.includes("oil") || group === "energy") return "Oil";
  if (label.includes("copper") || group === "materials") return "Copper";
  if (label.includes("gold") || group === "precious") return "Gold";
  return String(metric2?.label || "Inflation").trim();
}
function IndicatorMetricModal({
  countryName,
  metric: metric2,
  onClose,
  // Action handlers are supplied either as props OR via IndicatorActionsContext
  // (App-provided). useIndicatorActions merges both — props win.
  isInWatchlist: isInWatchlistProp,
  onToggleStar: onToggleStarProp,
  onCompare: onCompareProp,
  onOpenResearch: onOpenResearchProp,
  onOpenProfile: onOpenProfileProp,
  onOpenTransmission: onOpenTransmissionProp,
  onPin: onPinProp,
  isPinned: isPinnedProp,
  onAlert: onAlertProp,
  onExport: onExportProp,
  onCopyLink: onCopyLinkProp,
  onDecisionLedger: onDecisionLedgerProp,
  onExposure: onExposureProp,
  onSelectIndicator: onSelectIndicatorProp
}) {
  const A = useIndicatorActions({
    isInWatchlist: isInWatchlistProp,
    onToggleStar: onToggleStarProp,
    onCompare: onCompareProp,
    onOpenResearch: onOpenResearchProp,
    onOpenProfile: onOpenProfileProp,
    onOpenTransmission: onOpenTransmissionProp,
    onPin: onPinProp,
    isPinned: isPinnedProp,
    onAlert: onAlertProp,
    onExport: onExportProp,
    onCopyLink: onCopyLinkProp,
    onDecisionLedger: onDecisionLedgerProp,
    onExposure: onExposureProp,
    onSelectIndicator: onSelectIndicatorProp
  });
  const isInWatchlist = A.isInWatchlist;
  const onToggleStar = A.onToggleStar;
  const onCompare = A.onCompare;
  const onOpenResearch = A.onOpenResearch;
  const onOpenProfile = A.onOpenProfile;
  const onOpenTransmission = A.onOpenTransmission;
  const onPin = A.onPin;
  const isPinned = A.isPinned;
  const onAlert = A.onAlert;
  const onExport = A.onExport;
  const onCopyLink = A.onCopyLink;
  const onDecisionLedger = A.onDecisionLedger;
  const onExposure = A.onExposure;
  const onSelectIndicator = A.onSelectIndicator;
  const renderAction = (def) => {
    const handler = HANDLER_FOR[def.key];
    const disabled = !handler;
    const active = def.key === "watchlist" ? isInWatchlist : def.key === "pin" ? isPinned : false;
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
      "button",
      {
        className: `imv2-action ${def.key === "watchlist" || def.key === "pin" ? "imv2-action-toggle" : ""} ${active ? "active" : ""}`,
        title: def.label,
        disabled,
        onClick: () => handler && handler(),
        children: def.label
      },
      def.key
    );
  };
  const [scenarioValue, setScenarioValue] = (0, import_react3.useState)(null);
  const [showRecession, setShowRecession] = (0, import_react3.useState)(true);
  const [showMA, setShowMA] = (0, import_react3.useState)(false);
  const [activeHorizon, setActiveHorizon] = (0, import_react3.useState)("10Y");
  const rootNode = (0, import_react3.useMemo)(() => toGraphRoot(metric2), [metric2]);
  const indicatorCode = String(metric2?.code || metric2?.label || "").toUpperCase();
  const navArgs = (0, import_react3.useMemo)(
    () => ({ symbol: indicatorCode, code: indicatorCode, label: metric2?.label }),
    [indicatorCode, metric2]
  );
  const handleOpenTransmission = (0, import_react3.useCallback)((nodeName) => {
    if (onOpenTransmission) return onOpenTransmission(nodeName);
    try {
      TransmissionEngine.openExplorer(
        { label: nodeName, name: nodeName },
        { source: "IndicatorMetricModal", indicator: metric2?.label }
      );
    } catch {
    }
  }, [onOpenTransmission, metric2]);
  const handleToggleWatch = (0, import_react3.useCallback)(() => {
    if (!onToggleStar) return;
    onToggleStar({
      symbol: indicatorCode,
      name: metric2?.label,
      type: "indicator",
      category: "indicators",
      marketType: "macro",
      market: "Macro"
    });
  }, [onToggleStar, indicatorCode, metric2]);
  const HANDLER_FOR = {
    research: onOpenResearch ? () => onOpenResearch(navArgs) : null,
    profile: onOpenProfile ? () => onOpenProfile(navArgs) : null,
    watchlist: handleToggleWatch ? () => handleToggleWatch() : null,
    pin: onPin ? () => onPin({ code: indicatorCode, label: metric2?.label }) : null,
    alert: onAlert ? () => onAlert({ code: indicatorCode, label: metric2?.label }) : null,
    compare: onCompare ? () => onCompare({ kind: "indicator", symbol: indicatorCode, metric: metric2 }) : null,
    transmission: onOpenTransmission ? () => onOpenTransmission(metric2?.label || indicatorCode) : null,
    decisionLedger: onDecisionLedger ? () => onDecisionLedger({ indicator: indicatorCode }) : null,
    exposure: onExposure ? () => onExposure({ indicator: indicatorCode }) : null,
    export: onExport ? () => onExport({ code: indicatorCode, label: metric2?.label, metric: metric2 }) : null,
    copyLink: onCopyLink ? () => onCopyLink({ code: indicatorCode, label: metric2?.label }) : null,
    journal: A.onJournal ? () => A.onJournal(navArgs) : null,
    scenario: A.onScenario ? () => A.onScenario(navArgs) : null,
    macro: A.onMacroWorkspace ? () => A.onMacroWorkspace(navArgs) : null
  };
  const actionDefs = (0, import_react3.useMemo)(() => getActionsForKind("indicator"), []);
  const handleSelectRelated = (0, import_react3.useCallback)((code) => {
    if (onSelectIndicator) onSelectIndicator(String(code).toUpperCase());
  }, [onSelectIndicator]);
  const series = (0, import_react3.useMemo)(() => {
    const raw = Array.isArray(metric2?.series) ? metric2.series : [];
    return raw.map((point) => {
      const ts = Number(point?.ts || new Date(point?.date || "").getTime());
      const value = Number(point?.value);
      if (!Number.isFinite(ts) || !Number.isFinite(value)) return null;
      return { time: Math.floor(ts / 1e3), value, x: ts, y: value, date: point?.date };
    }).filter(Boolean).sort((a, b) => a.x - b.x);
  }, [metric2]);
  const filteredSeries = (0, import_react3.useMemo)(() => {
    if (activeHorizon === "MAX" || !series.length) return series;
    const selected = HORIZONS.find((h) => h.key === activeHorizon);
    if (!selected?.years) return series;
    const cutoff = Date.now() - selected.years * 365.25 * 24 * 3600 * 1e3;
    const trimmed = series.filter((p) => p.x >= cutoff);
    return trimmed.length > 1 ? trimmed : series;
  }, [activeHorizon, series]);
  const stats = (0, import_react3.useMemo)(() => {
    const values = series.map((p) => p.y);
    if (!values.length) return null;
    const current = values[values.length - 1];
    const first = values[0];
    const min = Math.min(...values);
    const max = Math.max(...values);
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const pctRank = max === min ? 0.5 : (current - min) / (max - min);
    const slope = values.length > 1 ? (current - first) / (values.length - 1) : 0;
    return { current, first, min, max, avg, pctRank, slope };
  }, [series]);
  const chartSeries = (0, import_react3.useMemo)(() => {
    const base = {
      name: metric2?.label || "Indicator",
      data: filteredSeries,
      type: "area",
      color: "var(--color-data-primary)"
    };
    const out = [base];
    if (showMA && filteredSeries.length > 1) {
      const win = Math.max(2, Math.min(20, Math.round(filteredSeries.length / 8)));
      const ma = filteredSeries.map((p, i) => {
        const start = Math.max(0, i - win + 1);
        const slice = filteredSeries.slice(start, i + 1);
        const avg = slice.reduce((s, q) => s + q.y, 0) / slice.length;
        return { time: p.time, value: avg };
      });
      out.push({ name: "Moving Average", data: ma, type: "line", color: "var(--color-data-muted)", options: { lineWidth: 1, priceLineVisible: false } });
    }
    return out;
  }, [filteredSeries, metric2, showMA]);
  const relatedIndicators = (0, import_react3.useMemo)(() => {
    const code = String(metric2?.code || "").toUpperCase();
    const group = String(metric2?.group || "").toUpperCase();
    const pool = MACRO_INDICATORS.filter((i) => i.code !== code);
    const sameGroup = pool.filter((i) => i.group?.toUpperCase() === group);
    const others = pool.filter((i) => i.group?.toUpperCase() !== group);
    return [...sameGroup, ...others].slice(0, 8);
  }, [metric2]);
  const chain = (0, import_react3.useMemo)(() => {
    const raw = TransmissionEngine.getActiveChain(rootNode);
    if (!raw || raw.length < 2) return [];
    const path = [];
    const seen = /* @__PURE__ */ new Set();
    for (const node of raw) {
      if (seen.has(node.node)) continue;
      seen.add(node.node);
      path.push({ name: node.node, direction: node.edge?.direction || "flat", confidence: node.edge?.confidence ?? null, detail: node.edge?.evidence || null });
      if (path.length >= 7) break;
    }
    return path;
  }, [rootNode]);
  const openNode = (0, import_react3.useCallback)((nodeName) => {
    handleOpenTransmission(nodeName);
  }, [handleOpenTransmission]);
  const regime = (0, import_react3.useMemo)(() => getRegime(), []);
  const macroSignal = (0, import_react3.useMemo)(() => getMacroSignal(), []);
  const scenarioProjection = (0, import_react3.useMemo)(() => {
    if (scenarioValue == null || chain.length < 2) return [];
    const base = Number(metric2?.current);
    const n = Number(scenarioValue);
    const rise = Number.isFinite(base) && base !== 0 ? (n - base) / Math.abs(base) : 0;
    const intensity = Math.max(-1, Math.min(1, rise));
    return chain.slice(1).map((node, idx) => {
      const decay = Math.pow(0.7, idx);
      const score = (node.direction === "up" ? 1 : node.direction === "down" ? -1 : 0) * intensity * (1 - decay * 0.5);
      const dir = score > 0.08 ? "up" : score < -0.08 ? "down" : "flat";
      return { name: node.name, direction: dir, score };
    });
  }, [scenarioValue, chain, metric2]);
  const hero = [
    { label: "Current", value: fmt(metric2?.current, metric2?.unit), tone: "neutral" },
    { label: "Previous", value: metric2?.previous != null ? fmt(metric2.previous, metric2?.unit) : "\u2014", tone: "neutral" },
    { label: "Forecast", value: metric2?.forecast != null ? fmt(metric2.forecast, metric2?.unit) : metric2?.consensus != null ? fmt(metric2.consensus, metric2?.unit) : "\u2014", tone: "neutral" },
    { label: "Change", value: stats ? fmt(stats.current - stats.first, metric2?.unit) : "\u2014", tone: stats && stats.current >= stats.first ? "up" : "down" },
    { label: "YoY", value: metric2?.yoy != null ? fmtPct(metric2.yoy) : "\u2014", tone: metric2?.yoy >= 0 ? "up" : "down" },
    { label: "MoM", value: metric2?.mom != null ? fmtPct(metric2.mom) : "\u2014", tone: metric2?.mom >= 0 ? "up" : "down" }
  ];
  const surprise = metric2?.surprise != null ? `${metric2.surprise >= 0 ? "+" : ""}${fmt(metric2.surprise, metric2?.unit)}` : metric2?.consensus != null && metric2?.current != null ? `${metric2.current - metric2.consensus >= 0 ? "+" : ""}${fmt(metric2.current - metric2.consensus, metric2?.unit)}` : "\u2014";
  const hasChart = filteredSeries.length > 0;
  const updatedLabel = relativeTime(metric2?.updatedAt || metric2?.date);
  const confidence = metric2?.confidence != null ? Number(metric2.confidence) : metric2?.confidencePct != null ? Number(metric2.confidencePct) : null;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "modal-overlay indicator-detail-overlay", onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "modal-content indicator-metric-modal indicator-v2", onClick: (e) => e.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "imv2-header", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-header-main", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-eyebrow", children: [
          "MACRO INDICATOR \xB7 ",
          String(countryName || "Macro").toUpperCase()
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h2", { className: "imv2-title", children: metric2?.label || "Indicator" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-meta-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "Country" }),
            " ",
            countryName || "United States"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "Category" }),
            " ",
            metric2?.group || metric2?.category || "Macro"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "Source" }),
            " ",
            metric2?.source || "FRED"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "Updated" }),
            " ",
            updatedLabel || metric2?.date || "Unknown"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: `imv2-conf ${confidence != null ? "ok" : "muted"}`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("b", { children: "Confidence" }),
            " ",
            confidence != null ? `${confidence}%` : "\u2014"
          ] })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-header-actions", children: [
        actionDefs.filter((d) => d.key === "pin" || d.key === "watchlist").map(renderAction),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "close-btn", onClick: onClose, "aria-label": "Close", children: "\xD7" })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-hero", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-hero-value", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-big-number", children: fmt(metric2?.current, metric2?.unit) }),
        stats ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: `imv2-hero-delta ${stats.current >= stats.first ? "up" : "down"}`, children: [
          stats.current >= stats.first ? "+" : "",
          fmt(stats.current - stats.first, metric2?.unit),
          " (",
          fmtPct(stats.first !== 0 ? (stats.current - stats.first) / Math.abs(stats.first) * 100 : 0),
          ")"
        ] }) : null,
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-hero-tag", children: metric2?.consensus != null && metric2?.current != null ? metric2.current >= metric2.consensus ? "Above Consensus" : "Below Consensus" : "No consensus available" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-hero-stats", children: [
        hero.map((h) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: `imv2-stat tone-${h.tone}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: h.label }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: h.value })
        ] }, h.label)),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: `imv2-stat tone-${surprise !== "\u2014" && String(surprise).startsWith("+") ? "up" : surprise !== "\u2014" ? "down" : "neutral"}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Surprise" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: surprise })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-workspace", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-chart-col", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          DensePanelHeader,
          {
            title: "Historical Chart",
            subtitle: hasChart ? `${filteredSeries.length} observations \xB7 ${activeHorizon}` : "No historical series returned",
            meta: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-chart-tools", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: `imv2-tool ${showMA ? "on" : ""}`, onClick: () => setShowMA((v) => !v), children: "MA" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: `imv2-tool ${showRecession ? "on" : ""}`, onClick: () => setShowRecession((v) => !v), children: "Recession" })
            ] })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "imv2-interval-row", children: HORIZONS.map((h) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: activeHorizon === h.key ? "active" : "", onClick: () => setActiveHorizon(h.key), children: h.label }, h.key)) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "imv2-chart-shell", children: hasChart ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          import_TradingViewChart.TradingViewChart,
          {
            options: {
              layout: { background: { type: "solid", color: "transparent" }, textColor: chartColors.muted() },
              rightPriceScale: { borderVisible: false },
              timeScale: { borderVisible: false },
              grid: { vertLines: { color: "rgba(160,160,160,0.08)" }, horzLines: { color: "rgba(160,160,160,0.08)" } }
            },
            series: chartSeries,
            height: 460,
            width: "100%",
            crosshairEnabled: true,
            resetSignal: activeHorizon
          }
        ) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          GuidedEmptyState,
          {
            eyebrow: "No Data",
            title: "No historical series returned from FRED.",
            description: "This indicator has no time series loaded. The latest value may still be available above. Add a macro data provider to populate the chart."
          }
        ) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("aside", { className: "imv2-rail", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-rail-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Current Reading" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-read-grid", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Current" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: fmt(metric2?.current, metric2?.unit) })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Previous" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.previous != null ? fmt(metric2.previous, metric2?.unit) : "\u2014" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Expected" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.consensus != null ? fmt(metric2.consensus, metric2?.unit) : metric2?.forecast != null ? fmt(metric2.forecast, metric2?.unit) : "\u2014" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Surprise" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: surprise })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Trend" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { className: stats ? stats.slope >= 0 ? "up" : "down" : "", children: stats ? stats.slope >= 0 ? "Rising" : "Falling" : "\u2014" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-rail-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Macro Regime", meta: regime?.label ? null : "Unavailable" }),
          regime?.label ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-regime", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: `imv2-regime-badge tone-${toneClass(regime.tone)}`, children: regime.label }),
            regime.drivers?.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "imv2-regime-drivers", children: regime.drivers.slice(0, 4).map((d) => /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-chip", children: d }, d)) }) : null,
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "Derived from IntelligenceBus regime signal." })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "No macro regime published this session. Regime context appears when the Macro desk loads." })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-rail-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Signal Strength" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Bullish / Bearish" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { className: macroSignal?.tone ? toneClass(macroSignal.tone) : "", children: macroSignal?.tone ? macroSignal.tone.charAt(0).toUpperCase() + macroSignal.tone.slice(1) : "Neutral" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Confidence" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: confidence != null ? `${confidence}%` : "\u2014" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Freshness" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: updatedLabel || "\u2014" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Source quality" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.source || "FRED" })
            ] })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-rail-card", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Data Quality" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Source" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.source || "FRED" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Coverage" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.coverage || "Single series" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Update cadence" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.cadence || "Monthly" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Missing fields" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.missing ? metric2.missing.join(", ") : "None reported" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-signal-row", children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Last fetch" }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2?.fetchedAt ? relativeTime(metric2.fetchedAt) : updatedLabel || "\u2014" })
            ] })
          ] })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Why it matters" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-prose", children: metric2?.interpretation || macroSignal?.explain || defaultInterpretation(metric2) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section imv2-two-col", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Historical Context" }),
        stats ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(MetricStrip, { items: [
          { label: "52w High", value: fmt(stats.max, metric2?.unit) },
          { label: "52w Low", value: fmt(stats.min, metric2?.unit) },
          { label: "5y Average", value: fmt(stats.avg, metric2?.unit) },
          { label: "Percentile", value: `${Math.round(stats.pctRank * 100)}%` },
          { label: "Trend", value: stats.slope >= 0 ? "Rising" : "Falling" },
          { label: "Acceleration", value: stats.slope >= 0 ? "Positive" : "Negative" }
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "No historical series returned from FRED \u2014 historical context unavailable." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Current Interpretation" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-prose", children: metric2?.interpretation || currentInterpretation(metric2, stats, regime) })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        DensePanelHeader,
        {
          title: "Transmission Chain",
          subtitle: "What this indicator affects \u2014 each node opens the Transmission Explorer",
          meta: chain.length < 2 ? "Unmapped" : null
        }
      ),
      chain.length >= 2 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "imv2-chain", children: chain.map((node, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_react3.default.Fragment, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("button", { className: `imv2-chain-node tone-${toneClass(node.direction)}`, onClick: () => openNode(node.name), title: node.detail || `Open ${node.name}`, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-chain-name", children: node.name }),
          node.confidence != null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { className: "imv2-chain-conf", children: [
            node.confidence,
            "%"
          ] }) : null
        ] }),
        i < chain.length - 1 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `imv2-chain-arrow ${toneClass(chain[i + 1].direction)}`, children: "\u2193" }) : null
      ] }, `${node.name}-${i}`)) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(GuidedEmptyState, { eyebrow: "No Path", title: "No transmission path mapped.", description: `The ${metric2?.label || "indicator"} node has no downstream transmission edges in the current graph. Map a path in the Transmission Registry to populate this view.` })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Related Indicators", subtitle: "Click to open that indicator" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "imv2-related-grid", children: relatedIndicators.map((ind) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
        "button",
        {
          className: "imv2-related-card",
          onClick: () => handleSelectRelated(ind.code),
          title: `Open ${ind.label}`,
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-related-label", children: ind.label }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-related-group", children: ind.group }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-related-trend", children: "\u2014" })
          ]
        },
        ind.code
      )) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Cross-Asset Impact", subtitle: "Projected from the transmission chain (illustrative, not a forecast)" }),
      chain.length >= 2 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("table", { className: "imv2-cross-table", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("thead", { children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("th", { children: "Asset" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("th", { children: "Expected Impact" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("th", { children: "Current Signal" }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("th", { children: "Confidence" })
        ] }) }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("tbody", { children: crossAssetRows(chain).map((r) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("tr", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("td", { children: r.asset }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("td", { className: toneClass(r.impact), children: r.impact }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("td", { className: toneClass(r.signal), children: r.signal }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("td", { children: r.confidence })
        ] }, r.asset)) })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "No transmission path mapped \u2014 cross-asset impact unavailable." })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Scenario Laboratory", subtitle: "Illustrative: scale this indicator and view downstream tilts from the existing transmission rules" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-scenario", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-scenario-control", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("label", { children: [
            "If ",
            metric2?.label || "indicator",
            " ",
            metric2?.unit === "%" ? "rises to" : "moves to",
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              "input",
              {
                type: "number",
                value: scenarioValue ?? "",
                placeholder: metric2?.current != null ? String(metric2.current) : "value",
                onChange: (e) => setScenarioValue(e.target.value === "" ? null : Number(e.target.value))
              }
            ),
            metric2?.unit || ""
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { className: "imv2-link-btn", onClick: () => setScenarioValue(null), children: "Reset" })
        ] }),
        scenarioValue != null && scenarioProjection.length ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-scenario-proj", children: [
          scenarioProjection.map((p) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: `imv2-scenario-row tone-${p.direction}`, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: p.name }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "imv2-scenario-score", children: p.score > 0 ? `+${p.score.toFixed(2)}` : p.score.toFixed(2) })
          ] }, p.name)),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "Illustrative transmission from edited value using the existing rules engine. Not investment advice." })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "Enter a value to project effects through the verified transmission chain. Confidence is inherited from the seed edges." })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Release Timeline", subtitle: "Recent and next scheduled prints" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-timeline", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-tl-col", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: "Current Release" }),
          metric2?.current != null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-tl-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: metric2.label }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: fmt(metric2.current, metric2.unit) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("em", { children: updatedLabel || "\u2014" })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "No current release." }),
          metric2?.previous != null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-tl-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "Previous" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: fmt(metric2.previous, metric2.unit) }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("em", { children: "\u2014" })
          ] }) : null
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-tl-col", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("h4", { children: "Next Scheduled" }),
          metric2?.nextRelease ? /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "imv2-tl-row", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: metric2.nextRelease.label || "Release" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("strong", { children: metric2.nextRelease.date || "\u2014" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("em", { children: metric2.nextRelease.countdown || "" })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { className: "imv2-note", children: "No next scheduled release returned. The provider does not expose a calendar for this indicator." })
        ] })
      ] })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("section", { className: "imv2-section", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(DensePanelHeader, { title: "Actions", subtitle: "Every action resolves through the Asset Action Registry" }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "imv2-action-bar", children: actionDefs.map(renderAction) })
    ] })
  ] }) });
}
function defaultInterpretation(metric2) {
  const group = String(metric2?.group || metric2?.category || "").toLowerCase();
  const MAP = {
    inflation: "Higher prints typically pressure interest rates, bonds, and long-duration growth equities, while supporting the dollar and real assets.",
    policy: "Policy moves reset discount rates across equities, bonds, and currencies.",
    growth: "Growth strength supports equities and cyclicals; weakness warns of slowdown.",
    labor: "Labor tightness feeds wage inflation and policy tightening.",
    activity: "Activity gauges lead industrial and consumer demand.",
    liquidity: "Liquidity conditions drive risk appetite and asset multiples.",
    energy: "Energy moves feed inflation and margin pressure across the economy.",
    materials: "Materials pricing signals industrial demand and cost pressure.",
    external: "External balances affect the currency and capital flows.",
    fiscal: "Fiscal stance influences rates and aggregate demand."
  };
  return MAP[group] || "This indicator contributes to the macro regime signal used across the desk. Detailed interpretation appears when the feed supplies it.";
}
function currentInterpretation(metric2, stats, regime) {
  if (metric2?.interpretation) return metric2.interpretation;
  const parts = [];
  if (stats) {
    parts.push(`Currently ${fmt(stats.current, metric2?.unit)}, ${stats.slope >= 0 ? "rising" : "falling"} versus the window start.`);
  }
  if (regime?.label) {
    parts.push(`Reads against a "${regime.label}" regime${regime.tone ? ` (${regime.tone})` : ""}.`);
  }
  if (!parts.length) parts.push("No series or regime context available this session.");
  return parts.join(" ");
}
function crossAssetRows(chain) {
  const reach = (name) => chain.some((c) => c.name === name);
  const up = (n) => chain.find((c) => c.name === n)?.direction === "up" ? "Bullish" : chain.find((c) => c.name === n)?.direction === "down" ? "Bearish" : "Mixed";
  const rows = [
    { asset: "US10Y", impact: reach("Rates") ? chain.find((c) => c.name === "Rates")?.direction === "up" ? "Higher" : "Lower" : "Mixed", signal: up("Rates"), confidence: edgeConf(chain, "Rates") },
    { asset: "USD", impact: reach("Dollar") ? chain.find((c) => c.name === "Dollar")?.direction === "up" ? "Bullish" : "Bearish" : "Mixed", signal: up("Dollar"), confidence: edgeConf(chain, "Dollar") },
    { asset: "Gold", impact: reach("Gold") ? chain.find((c) => c.name === "Gold")?.direction === "up" ? "Bullish" : "Bearish" : "Mixed", signal: up("Gold"), confidence: edgeConf(chain, "Gold") },
    { asset: "SPY", impact: "Neutral", signal: up("Technology") === "Bearish" ? "Bearish" : up("Growth") === "Bearish" ? "Bearish" : "Neutral", confidence: edgeConf(chain, "Technology") },
    { asset: "Nasdaq", impact: up("Technology") === "Bearish" ? "Bearish" : up("Technology") === "Bullish" ? "Bullish" : "Neutral", signal: up("Technology"), confidence: edgeConf(chain, "Technology") },
    { asset: "BTC", impact: "Mixed", signal: "Mixed", confidence: "Low" }
  ];
  return rows;
}
function edgeConf(chain, name) {
  const c = chain.find((x) => x.name === name);
  if (!c || c.confidence == null) return "Low";
  return c.confidence >= 80 ? "High" : c.confidence >= 65 ? "Medium" : "Low";
}
var import_react3, import_TradingViewChart, import_jsx_runtime3, HORIZONS, fmt, fmtPct, relativeTime, toneClass, IndicatorMetricModal_default;
var init_IndicatorMetricModal = __esm({
  "src/components/IndicatorMetricModal.jsx"() {
    import_react3 = __toESM(require("react"), 1);
    import_TradingViewChart = __toESM(require_chart(), 1);
    init_chartTheme();
    init_TransmissionEngine();
    init_intelligenceBus();
    init_MacroIndicatorRegistry();
    init_CompactWorkspaceUI();
    init_indicatorActions();
    init_assetActionRegistry();
    import_jsx_runtime3 = require("react/jsx-runtime");
    HORIZONS = [
      { key: "1M", label: "1M", years: 1 / 12 },
      { key: "3M", label: "3M", years: 3 / 12 },
      { key: "6M", label: "6M", years: 6 / 12 },
      { key: "1Y", label: "1Y", years: 1 },
      { key: "3Y", label: "3Y", years: 3 },
      { key: "5Y", label: "5Y", years: 5 },
      { key: "10Y", label: "10Y", years: 10 },
      { key: "MAX", label: "MAX", years: null }
    ];
    fmt = (value, unit) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return "\u2014";
      const suffix = unit === "%" ? "%" : "";
      return `${n.toLocaleString(void 0, { maximumFractionDigits: 3 })}${suffix}`;
    };
    fmtPct = (value) => {
      const n = Number(value);
      if (!Number.isFinite(n)) return "\u2014";
      return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
    };
    relativeTime = (iso) => {
      if (!iso) return null;
      const t = new Date(iso).getTime();
      if (!Number.isFinite(t)) return null;
      const mins = Math.round((Date.now() - t) / 6e4);
      if (mins < 1) return "just now";
      if (mins < 60) return `${mins} min ago`;
      const hrs = Math.round(mins / 60);
      if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
      const days = Math.round(hrs / 24);
      return `${days} day${days === 1 ? "" : "s"} ago`;
    };
    toneClass = (direction) => direction === "up" || direction === "positive" ? "up" : direction === "down" || direction === "negative" ? "down" : "flat";
    IndicatorMetricModal_default = IndicatorMetricModal;
  }
});

// <stdin>
var import_react4 = __toESM(require("react"));
var import_client = require("react-dom/client");
var import_react5 = require("react");
init_IndicatorMetricModal();
init_indicatorActions();
var metric = {
  code: "cpi",
  label: "Consumer Price Index",
  group: "inflation",
  unit: "%",
  current: 3.2,
  previous: 3,
  consensus: 3.1,
  source: "FRED",
  cadence: "Monthly",
  coverage: "Single series",
  series: [{ date: "2024-01-01", value: 3 }, { date: "2024-02-01", value: 3.2 }]
};
var calls = [];
var actions = {
  isInWatchlist: () => false,
  onToggleStar: (a) => calls.push(["toggleStar", a]),
  onCompare: (c) => calls.push(["compare", c]),
  onOpenResearch: (a) => calls.push(["research", a]),
  onOpenProfile: (a) => calls.push(["profile", a]),
  onOpenTransmission: (n) => calls.push(["transmission", n]),
  onPin: (a) => calls.push(["pin", a]),
  isPinned: () => false,
  onAlert: (a) => calls.push(["alert", a]),
  onExport: (a) => calls.push(["export", a]),
  onCopyLink: (a) => calls.push(["copyLink", a]),
  onDecisionLedger: (a) => calls.push(["ledger", a]),
  onExposure: (a) => calls.push(["exposure", a]),
  onJournal: (a) => calls.push(["journal", a]),
  onScenario: (a) => calls.push(["scenario", a]),
  onMacroWorkspace: (a) => calls.push(["macro", a]),
  onSelectIndicator: (c) => calls.push(["selectIndicator", c])
};
var results = [];
var check = (name, cond) => results.push([name, !!cond]);
function mount(el) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = (0, import_client.createRoot)(container);
  (0, import_react5.act)(() => {
    root.render(el);
  });
  return container;
}
var { Simulate } = require("react-dom/test-utils");
var clickByText = (container, text) => {
  const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent.trim() === text);
  if (!btn) throw new Error("button not found: " + text);
  (0, import_react5.act)(() => {
    Simulate.click(btn);
  });
};
(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const React4 = require("react");
  const { createRoot: createRoot2 } = require("react-dom/client");
  const mod = (init_IndicatorMetricModal(), __toCommonJS(IndicatorMetricModal_exports));
  const ctx = (init_indicatorActions(), __toCommonJS(indicatorActions_exports));
  const c1 = mount(React4.createElement(
    ctx.IndicatorActionsProvider,
    { value: actions },
    React4.createElement(mod.IndicatorMetricModal, { countryName: "United States", metric, onClose: () => calls.push(["close"]) })
  ));
  const buttons = Array.from(c1.querySelectorAll("button")).map((b) => b.textContent.trim());
  ["Research", "Profile", "Watch", "Pin", "Alert", "Compare", "Transmission", "Decision Ledger", "Portfolio Exposure", "Export", "Copy Link", "Journal", "Scenario Lab", "Macro Workspace"].forEach((t) => check("present:" + t, buttons.includes(t)));
  const related = c1.querySelectorAll(".imv2-related-card");
  check("relatedIndicators>0", related.length > 0);
  ["Research", "Profile", "Watch", "Pin", "Alert", "Compare", "Transmission", "Decision Ledger", "Portfolio Exposure", "Export", "Copy Link", "Journal", "Scenario Lab", "Macro Workspace"].forEach((t) => clickByText(c1, t));
  const seen = new Set(calls.map((c) => c[0]));
  ["research", "profile", "toggleStar", "pin", "alert", "compare", "transmission", "ledger", "exposure", "export", "copyLink", "journal", "scenario", "macro"].forEach((k) => check("fired:" + k, seen.has(k)));
  check("noCloseOnActions", !calls.some((c) => c[0] === "close"));
  const before = calls.length;
  (0, import_react5.act)(() => {
    Simulate.click(related[0]);
  });
  const sel = calls.slice(before).find((c) => c[0] === "selectIndicator");
  check("drillEmitSelect", !!sel);
  check("drillNoClose", !calls.slice(before).some((c) => c[0] === "close"));
  const c2 = mount(React4.createElement(mod.IndicatorMetricModal, { countryName: "X", metric, onClose: () => {
  } }));
  const disabledFoot = Array.from(c2.querySelectorAll(".imv2-action")).filter((b) => b.disabled);
  check("disabledWhenNoActions", disabledFoot.length === 14);
  const cdb = require(ROOT + "/src/components/AssetCompareDrawer.jsx");
  const cab = require(ROOT + "/src/components/AssetAlertBuilder.jsx");
  const drawer = mount(React4.createElement(cdb.AssetCompareDrawer, { open: true, assets: [{ kind: "indicator", symbol: "CPI", metric: { series: [{ date: "2020", value: 2 }, { date: "2021", value: 3 }] } }], onClose: () => {
  } }));
  check("compareDrawerOpens", drawer.textContent.includes("Compare Assets"));
  check("compareDrawerPicker", drawer.textContent.includes("Select indicator"));
  const builder = mount(React4.createElement(cab.AssetAlertBuilder, { open: true, asset: { kind: "indicator", symbol: "CPI", label: "CPI" }, onClose: () => {
  } }));
  check("alertBuilderOpens", builder.textContent.includes("Alert Builder"));
  check("alertBuilderConditions", builder.textContent.includes("Above Value") && builder.textContent.includes("Volatility Threshold"));
  const pass = results.filter((r) => r[1]).length;
  const fail = results.filter((r) => !r[1]);
  console.log("PASS " + pass + "/" + results.length);
  if (fail.length) {
    console.log("FAILURES:");
    fail.forEach((f) => console.log("  - " + f[0]));
    process.exit(1);
  }
  console.log("ALL GREEN");
  process.exit(0);
})().catch((e) => {
  console.error("HARNESS ERROR:", e && e.stack || e);
  process.exit(2);
});
