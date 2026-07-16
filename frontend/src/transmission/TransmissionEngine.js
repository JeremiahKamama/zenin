// TransmissionEngine — single facade for the Transmission Intelligence Platform.
// Every workspace imports THIS. No duplicated transmission logic anywhere else.
// Brand v2: explanation over prediction.

import { getTransmission, invalidate } from "./TransmissionCache.js";
import { signalsFromMacroExecutive, signalsFromCommoditiesExecutive } from "./TransmissionRuleEngine.js";
import { getChain, getAffected as graphGetAffected, chainByHorizon, edgeBetween } from "./TransmissionGraph.js";
import { buildEvidence, formatFreshness } from "./TransmissionEvidence.js";
import { NO_TRANSMISSION } from "./TransmissionFormatter.js";
import { emit, TX_EVENTS } from "./TransmissionEvents.js";

// Ingest an existing normalized executive (macro/commodities) and return transmission.
export function publishExecutive(kind, exec, opts = {}) {
  const signals = kind === "macro" ? signalsFromMacroExecutive(exec) : kind === "commodity" ? signalsFromCommoditiesExecutive(exec) : [];
  const rootConfidence = exec?.confidence ?? opts.rootConfidence ?? 70;
  const result = getTransmission({ signals, rootConfidence });
  emit(TX_EVENTS.CHAIN_UPDATED, { kind, result });
  return result;
}

// Ingest raw signals directly (e.g. from Portfolio exposures).
export function publishSignals(signals = [], opts = {}) {
  const result = getTransmission({ signals, rootConfidence: opts.rootConfidence });
  emit(TX_EVENTS.PUBLISH_SIGNALS, { signals, result });
  return result;
}

// Active chain for a root node (delegates to graph, memoized upstream).
export function getActiveChain(rootNode) {
  return getChain(rootNode);
}

// Affected entities of a dimension from a root.
export function getAffected(rootNode, dimension) {
  return graphGetAffected(rootNode, dimension);
}

// Horizon-grouped chain (for Explorer timeline + card timelines).
export function getHorizons(rootNode) {
  return chainByHorizon(rootNode);
}

// Evidence for a specific edge (provider/method/confidence/freshness/coverage).
export function getEvidence(source, dest) {
  const edge = edgeBetween(source, dest);
  if (!edge) return { providers: [], method: NO_TRANSMISSION, confidence: null, freshness: "n/a", coverage: "Unverified" };
  return { ...buildEvidence(edge), freshness: formatFreshness(edge.lastUpdated) };
}

// Open the Explorer for a node (delegates to Explorer provider via events).
export function openExplorer(node, context = {}) {
  emit(TX_EVENTS.OPEN_EXPLORER, { node, context });
}

export function clearCache() {
  invalidate();
}

// Facade object: consumers import { TransmissionEngine } and call TransmissionEngine.publishExecutive(...).
// Keeps a single import surface and a stable API as the engine grows.
export const TransmissionEngine = {
  publishExecutive,
  publishSignals,
  getActiveChain,
  getAffected,
  getHorizons,
  getEvidence,
  openExplorer,
  clearCache,
  NO_TRANSMISSION,
};

export { NO_TRANSMISSION };
