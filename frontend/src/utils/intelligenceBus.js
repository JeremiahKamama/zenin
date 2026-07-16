// IntelligenceBus (Phase 4 — Macro Intelligence Engine)
//
// The single event-driven + on-demand hub for cross-asset intelligence. Phase 4
// target per the asset-intelligence audit §8:
//
//   /api/macro/regime ──► publish('regime', {label, score, drivers})
//        │  (event-driven: recompute only when regime data changes)
//        ▼
//   regime → affectedSectors → affectedCommodities → affectedHoldings
//        → portfolioRecommendation → decision
//
// Design:
//  - Regime is LOW-FREQUENCY → EVENT-DRIVEN publish (compute once, fan out).
//  - Holding-level cascade is portfolio-specific, HIGH-CARDINALITY → ON-DEMAND
//    compute when Portfolio/Profile mounts or regime changes (never per-tick).
//  - Reuses deskIntelligence derivations (no reimplementation) and the Phase 5
//    RelationshipGraph for sector/commodity/holding traversal.
//  - No fabrication: when inputs are absent the bus holds a null signal and
//    consumers render their honest empty state.
//
// This module is framework-free (no React) so any surface — Portfolio, Company
// Profile, Watchlist, Decision Engine — can subscribe without prop-drilling.

import { deriveMacroExecutive, buildMarketSignal, buildCommodityAllocation, freshnessFrom } from "./deskIntelligence";
import { TRANSMISSION_PUBLISHERS } from "../transmission/TransmissionRegistry";
import { emit, subscribe, TX_EVENTS } from "../transmission/TransmissionEvents";
import { getRelated, traverse, NODE_KIND } from "./relationshipGraph";
import { getCompanyCommodities, getCommodityRelations } from "./assetGraph";

const BUS_EVENTS = {
  REGIME: "intelligence:regime",
  CASCADE: "intelligence:cascade",
};

// ── Central store ─────────────────────────────────────────────────────────
let _state = {
  regime: null,        // { label, score, explain, drivers, tone, risk }
  macroSignal: null,   // MarketSignal (Phase 5 schema) from deskIntelligence
  updatedAt: null,
  source: null,        // e.g. "geo:US"
  listeners: new Set(),
};

// ── Intelligence event log (Phase Next: Intelligence Center) ──────────────
// A single, append-only stream of *translated* intelligence events published by
// ANY source (macro/regime, commodities, earnings, ETF flows, FX, portfolio,
// alerts, journal, scenarios…). Consumers (IntelligenceCenter) subscribe and
// filter by context. NO fabrication: the log is empty until a source publishes.
// Event shape:
//   { id, type, headline, impact, confidence, source, timestamp,
//     assets?: string[], contexts?: string[], transmission?: {to, dir}[],
//     actions?: {label, intent}[], detail?: string }
// `contexts` is the set of workspace contexts the event is relevant to
// (e.g. "macro","portfolio","company"); if absent it defaults to [type].
let _events = [];
let _diag = {
  sources: 0,
  confidence: null,
  latencyMs: null,
  fallback: false,
  apiHealth: "unknown",
  coverage: [],
  lastPublish: null,
};
const _eventListeners = new Set();

function notifyEventListeners() {
  for (const fn of _eventListeners) {
    try { fn(_events); } catch { /* isolate listener failures */ }
  }
}

/**
 * Publish a single translated intelligence event. The single entry point for
 * every source in the architecture (FRED, World Bank, EIA, LME, CME, NOAA,
 * USDA, FAO, central banks, SEC, earnings, ETF flows, portfolio decisions,
 * alerts, journal, scenarios). One bus, many sources.
 */
export function publish(event) {
  if (!event || !event.type) return null;
  const e = {
    id: event.id || `ev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: event.timestamp || new Date().toISOString(),
    headline: event.headline || "(untitled event)",
    impact: event.impact || "neutral",
    confidence: typeof event.confidence === "number" ? event.confidence : null,
    source: event.source || "unknown",
    type: event.type,
    assets: Array.isArray(event.assets) ? event.assets : [],
    contexts: Array.isArray(event.contexts) && event.contexts.length
      ? event.contexts
      : [event.type],
    transmission: Array.isArray(event.transmission) ? event.transmission : null,
    actions: Array.isArray(event.actions) ? event.actions : null,
    detail: event.detail || null,
  };
  _events = [e, ..._events].slice(0, 100);
  _diag.lastPublish = e.timestamp;
  notifyEventListeners();
  return e;
}

/** Publish several events at once (batched source refresh). */
export function publishMany(events = []) {
  if (!Array.isArray(events)) return [];
  return events.map((ev) => publish(ev)).filter(Boolean);
}

/** Subscribe to the event log. Replays current events immediately. */
export function subscribeEvents(fn) {
  _eventListeners.add(fn);
  try { fn(_events); } catch { /* noop */ }
  return () => _eventListeners.delete(fn);
}

/** Current event log (newest first). */
export function getEvents() {
  return _events;
}

/**
 * Update diagnostics (coverage / providers / latency / fallback / api health /
 * confidence calculation). Drives the collapsed Diagnostics drawer only — never
 * the primary UI. Called by sources as they refresh.
 */
export function setDiagnostics(patch = {}) {
  _diag = { ..._diag, ...patch };
  return _diag;
}

export function getDiagnostics() {
  return _diag;
}

function notify() {
  for (const fn of _state.listeners) {
    try { fn(_state); } catch (e) { /* isolate listener failures */ }
  }
}

/**
 * Publish a new macro regime. EVENT-DRIVEN: call only when the regime data
 * actually changes (the desk already does this once per fetch). Fans out to
 * TransmissionEvents (for the sibling transmission layer) and local listeners.
 */
export function publishRegime({ label, score, explain, macroRows = [], riskRows = [], updatedAt, source } = {}) {
  if (!label) return null;
  const exec = deriveMacroExecutive({ regimeLabel: label, regimeScore: score, regimeExplain: explain, macroRows, riskRows, updatedAt });
  if (!exec) return null;
  const signal = buildMarketSignal("macro", exec);
  _state = {
    ..._state,
    regime: { label: exec.regime, score, explain, drivers: exec.drivers, tone: exec.tone, risk: exec.risk, confidence: exec.confidence },
    macroSignal: signal,
    updatedAt: updatedAt || new Date().toISOString(),
    source: source || _state.source,
  };
  emit(TX_EVENTS.PUBLISH_SIGNALS, [signal]);
  emit(BUS_EVENTS.REGIME, _state);
  notify();
  // Also publish a translated intelligence event so the Intelligence Center
  // (and any event-log consumer) can surface genuine macro intelligence.
  // Real data only — fed from the regime the macro desk actually published.
  publish({
    type: "macro",
    headline: `Macro regime: ${exec.regime}`,
    impact: exec.tone || "neutral",
    confidence: typeof exec.confidence === "number" ? exec.confidence : null,
    source: source || "macro-desk",
    contexts: ["macro", "portfolio", "watchlist", "briefing", "decision", "transmission"],
    transmission: (exec.drivers || []).map((d) => ({ to: d, dir: (exec.tone === "risk-off" || exec.tone === "bearish") ? "down" : "up" })),
    actions: [
      { label: "Open Macro Workspace", intent: "open-macro" },
      { label: "Explore Transmission", intent: "open-transmission" },
    ],
    detail: exec.explain || null,
    timestamp: (updatedAt || new Date().toISOString()),
  });
  return _state;
}

export function getRegime() {
  return _state.regime;
}
export function getMacroSignal() {
  return _state.macroSignal;
}

/** Subscribe to regime changes. Returns an unsubscribe fn. */
export function subscribeRegime(fn) {
  _state.listeners.add(fn);
  // push current state immediately so new subscribers render correctly
  try { fn(_state); } catch { /* noop */ }
  return () => _state.listeners.delete(fn);
}

// ── On-demand cascade (regime → holdings → recommendation) ────────────────
//
// Computed only when asked (portfolio mount / regime change). Reuses the graph
// for commodity exposure and generalizes buildCommodityAllocation's pattern.

const SECTOR_MAP = {
  expansion: ["Cyclicals", "Technology", "Industrials"],
  recovery: ["Cyclicals", "Financials", "Industrials"],
  goldilocks: ["Technology", "Consumer", "Industrials"],
  inflationary: ["Energy", "Materials", "Commodities"],
  stagflation: ["Energy", "Utilities", "Commodities"],
  slowdown: ["Defensives", "Healthcare", "Staples"],
  contraction: ["Defensives", "Healthcare", "Utilities"],
  recession: ["Defensives", "Cash", "Treasuries"],
  "risk-off": ["Defensives", "Cash", "Treasuries"],
};

/**
 * Map a regime label to affected sectors (graph-style 1-hop from regime node).
 * Returns { label, direction }[] — directional, not advice.
 */
export function affectedSectors(regimeLabel = _state.regime?.label) {
  if (!regimeLabel) return [];
  const r = String(regimeLabel).toLowerCase();
  const sectors = SECTOR_MAP[r] || SECTOR_MAP[String(_state.regime?.label || "").toLowerCase()] || [];
  const tilt = (r.includes("risk") || r === "recession" || r === "contraction" || r === "stagflation")
    ? "down"
    : (r === "slowdown" ? "flat" : "up");
  return sectors.map((s) => ({ label: s, direction: tilt }));
}

/**
 * Map regime → affected commodities via the graph (commodity group raw-materials
 * sensitivity to the macro regime). Reuses RelationshipGraph getRelated where the
 * seed knows the linkage; otherwise derives from the regime's commodity signal.
 */
export function affectedCommodities(regimeLabel = _state.regime?.label) {
  if (!regimeLabel) return [];
  const r = String(regimeLabel).toLowerCase();
  // Energy/Metals lead in inflationary & expansion; defensive in contraction.
  const groups = (r === "inflationary" || r === "stagflation" || r === "expansion" || r === "recovery" || r === "goldilocks")
    ? ["Energy", "Industrial Metals", "Precious Metals"]
    : (r.includes("risk") || r === "recession" || r === "contraction")
      ? ["Precious Metals", "Agriculture"]
      : ["Industrial Metals"];
  return groups.map((g) => ({ group: g, direction: r.includes("risk") || r === "contraction" || r === "recession" ? "down" : "up" }));
}

/**
 * ON-DEMAND: intersect regime-affected commodities with a portfolio's holdings
 * (by commodity exposure, via the graph) to find affected holdings.
 * @param {Array<{symbol, name?, commodityExposure?: string[]}>} holdings
 * @returns {Array<{ symbol, commodities: string[], direction: string }>}
 */
export function affectedHoldings(holdings = [], regimeLabel = _state.regime?.label) {
  if (!regimeLabel || !Array.isArray(holdings)) return [];
  const r = String(regimeLabel).toLowerCase();
  const down = r.includes("risk") || r === "contraction" || r === "recession";
  const out = [];
  for (const h of holdings) {
    const sym = String(h.symbol || "").toUpperCase();
    if (!sym) continue;
    // direct commodity holding?
    const direct = getRelated(sym).commodities.length > 0;
    // company holding → its commodities
    const exposed = getCompanyCommoditiesSafe(sym);
    const touched = direct ? [sym] : exposed;
    if (touched.length) {
      out.push({ symbol: sym, name: h.name || sym, commodities: touched, direction: down ? "down" : "up" });
    }
  }
  return out;
}

function getCompanyCommoditiesSafe(sym) {
  return getCompanyCommodities(sym);
}

/**
 * ON-DEMAND portfolio recommendation: generalize buildCommodityAllocation's
 * rows→recommendation pattern onto the regime-affected commodity set, intersected
 * with the portfolio. Returns recommendation objects (same shape as deskIntelligence).
 */
export function portfolioRecommendation(holdings = [], commodityRows = [], regimeLabel = _state.regime?.label) {
  if (!regimeLabel) return [];
  const r = String(regimeLabel).toLowerCase();
  // Build a synthetic commodity-row set from the portfolio's exposed commodities
  // so buildCommodityAllocation can produce the same recommendation shape.
  const exposed = new Set();
  for (const h of holdings) {
    const syms = getCompanyCommoditiesSafe(String(h.symbol || "").toUpperCase());
    syms.forEach((s) => exposed.add(s));
  }
  const rows = (Array.isArray(commodityRows) && commodityRows.length ? commodityRows : [...exposed].map((s) => ({ symbol: s, group: guessGroup(s), dailyChangePct: 0, ytdChangePct: 0 })));
  const recs = buildCommodityAllocation(rows, r);
  // Attach which holdings drive each recommendation (the "which holdings drive X" answer).
  return recs.map((rec) => ({
    ...rec,
    drivingHoldings: holdings
      .filter((h) => (rec.commodities || []).some((c) => getCompanyCommoditiesSafe(String(h.symbol || "").toUpperCase()).includes(c)))
      .map((h) => String(h.symbol || "").toUpperCase()),
  }));
}

function guessGroup(sym) {
  const rel = getRelated(sym);
  return rel.commodities?.length ? (getCommodityRelations(sym).category || "Energy") : "Energy";
}

export const IntelligenceBus = {
  BUS_EVENTS,
  // regime (existing consumers: MacroDriverRail, Portfolio, MacroAssetWorkspace)
  publishRegime,
  getRegime,
  getMacroSignal,
  subscribeRegime,
  affectedSectors,
  affectedCommodities,
  affectedHoldings,
  portfolioRecommendation,
  // event log + diagnostics (Intelligence Center, Phase Next)
  publish,
  publishMany,
  subscribeEvents,
  getEvents,
  setDiagnostics,
  getDiagnostics,
};
export default IntelligenceBus;
