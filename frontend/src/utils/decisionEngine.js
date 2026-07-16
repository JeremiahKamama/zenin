// DecisionEngine (Phase 6 — Decision reasoning layer)
//
// Wraps the sibling TransmissionEngine's chain/affected/evidence into an
// explainable reasoning layer for portfolio decisions. Per the audit, every
// recommendation must be explainable (Brand v2: "explanation over prediction").
//
// Given a decision context (a root signal + the user's holdings + the current
// macro regime from the IntelligenceBus), it produces a REASONING CHAIN that
// terminates in a Decision link — never a black-box score.
//
// Reuses:
//   - TransmissionEngine.getAffected / getEvidence / openExplorer (sibling)
//   - IntelligenceBus.portfolioRecommendation (Phase 4 on-demand cascade)
//   - relationshipGraph (Phase 5) for "which holdings drive X"
// No duplicated chain/evidence logic.

import { TransmissionEngine } from "../transmission/TransmissionEngine";
import { portfolioRecommendation, getRegime, affectedHoldings as busAffectedHoldings } from "./intelligenceBus";
import { getRelated } from "./relationshipGraph";
import { propagateConfidence } from "../transmission/TransmissionConfidence";

/**
 * Build an explainable decision reasoning chain.
 * @param {object} ctx
 *   - rootSignal: { id, title, category, severity, confidence, drivers, conflictingDrivers, affectedAssets }
 *   - holdings:   [{ symbol, name? }]
 *   - commodityRows: optional real commodity rows (falls back to portfolio-exposed set)
 * @returns {{
 *   rationale: string,
 *   steps: Array<{ kind: string, label: string, detail: string, confidence?: number }>,
 *   affectedHoldings: Array<{ symbol, commodities: string[], direction: string }>,
 *   recommendation: object|null,
 *   decisionLink: { label: string, open: () => void },
 * }}
 */
export function reasonAboutDecision(ctx = {}) {
  const rootSignal = ctx.rootSignal || null;
  const holdings = Array.isArray(ctx.holdings) ? ctx.holdings : [];
  const regime = getRegime();

  // 1) Which holdings does this signal actually touch? (graph traversal)
  // The root signal provides the rationale narrative; the regime-driven bus
  // cascade (Phase 4) is the authoritative source for which holdings are
  // exposed — it intersects regime-affected commodities with the portfolio.
  let affectedHoldings = busAffectedHoldings(holdings, regime?.label);
  if (rootSignal) {
    const affectedAssets = rootSignal.affectedAssets || [];
    const assetIds = affectedAssets.map((a) => (typeof a === "string" ? a : a.label)).filter(Boolean);
    if (assetIds.length) {
      const signalMatched = holdings
        .map((h) => {
          const sym = String(h.symbol || "").toUpperCase();
          const related = getRelated(sym);
          const touched = [...new Set([...related.commodities, ...related.companies])];
          const hit = assetIds.find((id) => touched.includes(String(id).toUpperCase()) || sym === String(id).toUpperCase());
          return hit ? { symbol: sym, name: h.name || sym, commodities: related.commodities, direction: String((typeof hit === "object" && hit.direction) || "flat") } : null;
        })
        .filter(Boolean);
      if (signalMatched.length) affectedHoldings = signalMatched;
    }
  }

  // 2) On-demand portfolio recommendation (Phase 4 cascade, generalized).
  const recs = portfolioRecommendation(holdings, ctx.commodityRows || [], regime?.label);
  const recommendation = recs[0] || null;

  // 3) Evidence for the primary edge (explainability).
  const primaryAsset = affectedHoldings[0]?.symbol || (rootSignal?.affectedAssets || [])[0]?.label;
  const evidence = primaryAsset ? TransmissionEngine.getEvidence(rootSignal?.id || "macro", primaryAsset) : null;

  // 4) Confidence propagation (sibling helper) across hops.
  const hops = 1 + (affectedHoldings.length ? 1 : 0) + (recommendation ? 1 : 0);
  const rootConf = rootSignal?.confidence ?? regime?.confidence ?? 60;
  const propagated = propagateConfidence(rootConf, hops);

  const steps = [];
  if (regime) {
    steps.push({ kind: "regime", label: `Macro regime: ${regime.label}`, detail: `${regime.risk} risk · ${regime.tone} tone`, confidence: regime.confidence });
  }
  if (rootSignal) {
    steps.push({ kind: "signal", label: rootSignal.title, detail: (rootSignal.drivers || []).join("; ") || "No drivers", confidence: rootSignal.confidence });
  }
  if (affectedHoldings.length) {
    steps.push({ kind: "holdings", label: `${affectedHoldings.length} holding(s) exposed`, detail: affectedHoldings.map((h) => h.symbol).join(", "), confidence: propagated });
  }
  if (recommendation) {
    steps.push({ kind: "recommendation", label: recommendation.title, detail: (recommendation.drivers || []).join("; "), confidence: recommendation.confidence });
  }

  const rationale = buildRationale({ regime, rootSignal, affectedHoldings, recommendation, evidence });

  return {
    rationale,
    steps,
    affectedHoldings,
    recommendation,
    decisionLink: {
      label: recommendation ? `Open Decision: ${recommendation.title}` : "Open Decision Explorer",
      open: () => TransmissionEngine.openExplorer(rootSignal?.id || "macro", { regime: regime?.label, holdings: affectedHoldings }),
    },
  };
}

function buildRationale({ regime, rootSignal, affectedHoldings, recommendation, evidence }) {
  const parts = [];
  if (regime) parts.push(`Under a ${regime.label} regime (${regime.risk} risk)`);
  if (rootSignal) parts.push(`${rootSignal.title} drives the signal`);
  if (affectedHoldings.length) parts.push(`exposing ${affectedHoldings.map((h) => h.symbol).join(", ")}`);
  if (recommendation) parts.push(`→ recommendation: ${recommendation.title}`);
  if (evidence && evidence.method && evidence.method !== TransmissionEngine.NO_TRANSMISSION) parts.push(`(evidence: ${evidence.method})`);
  if (!parts.length) return "No verified signal available — awaiting regime or research input.";
  return parts.join(" ");
}

export const DecisionEngine = { reasonAboutDecision };
export default DecisionEngine;
