// TransmissionRuleEngine — ingests normalized signals and computes transmission.
// Pure functions. Single source of transmission logic (no duplication across desks).
// Reuses existing normalized executives (macroExecutive / commoditiesExecutive) as inputs.

import { getChain, getAffected, chainByHorizon, nodeType } from "./TransmissionGraph.js";
import { chainConfidence, propagateConfidence, clampConfidence } from "./TransmissionConfidence.js";

// Map a macro/commodity driver label to a graph root node.
// Driver labels are free-text like "Oil improving" / "Inflation rising" — scan for known factors.
const DRIVER_TO_NODE = {
  "oil": "Oil", "crude": "Oil", "energy": "Oil", "wti": "Oil", "brent": "Oil",
  "inflation": "Inflation", "cpi": "Inflation", "pce": "Inflation",
  "rates": "Rates", "fed": "Rates", "tighten": "Rates",
  "yield": "Yield Curve", "curve": "Yield Curve", "inversion": "Yield Curve",
  "dollar": "Dollar", "usd": "Dollar", "dxy": "Dollar",
  "growth": "Growth", "gdp": "Growth", "expansion": "Growth",
  "copper": "Copper", "gold": "Gold", "credit": "Credit", "spread": "Credit",
};

function resolveRoot(driverLabel) {
  const key = String(driverLabel || "").toLowerCase();
  // Direct match on a known factor keyword inside the label.
  for (const k of Object.keys(DRIVER_TO_NODE)) {
    if (key.includes(k)) return DRIVER_TO_NODE[k];
  }
  return titleCase(key);
}

function titleCase(s) {
  return String(s || "").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Pick the strongest root driver from a set of signals.
function pickRoots(signals = []) {
  const roots = [];
  for (const s of signals) {
    const label = s?.label || s?.indicator || s?.name || "";
    const node = resolveRoot(label);
    if (node) roots.push({ node, positive: s.positive !== false, weight: Number(s.strength) || 1 });
  }
  return roots;
}

// Compute transmission for a workspace given its normalized signals.
// signals: array of { label, positive, strength?, confidence? }
// Returns { active: [{root, chain, confidence, affected, horizons}], confidence }
export function computeTransmission({ signals = [], rootConfidence = 70 } = {}) {
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
        portfolios: getAffected(r.node, "portfolios"),
      },
      horizons: chainByHorizon(r.node),
    };
  });
  const overall = clampConfidence(active.reduce((a, b) => a + b.confidence, 0) / active.length);
  return { active, confidence: overall, hasTransmission: true };
}

// Convenience: build signals from an existing macroExecutive.
export function signalsFromMacroExecutive(exec) {
  if (!exec) return [];
  const out = [];
  if (exec.drivers) for (const d of exec.drivers) out.push({ label: d.label, positive: d.positive !== false });
  if (exec.regime) out.push({ label: exec.regime, positive: exec.tone !== "negative" });
  // Map macro factor groups to roots.
  out.push({ label: "Inflation", positive: exec.tone !== "negative" });
  out.push({ label: "Rates", positive: exec.tone !== "negative" });
  return out;
}

// Convenience: build signals from a commoditiesExecutive (theme group -> node).
export function signalsFromCommoditiesExecutive(exec) {
  if (!exec || !exec.states) return [];
  return exec.states.map((s) => ({ label: s.group, positive: s.tone === "positive" }));
}
