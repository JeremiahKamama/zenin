// TransmissionConfidence — confidence math for transmission chains.
// Propagates confidence along a chain with per-hop decay. Never claims certainty (>95).
// Reuses the existing computeConfidence shape from deskIntelligence where possible.

// Per-hop decay: each edge reduces inherited confidence.
const HOP_DECAY = 0.12;

export function clampConfidence(value) {
  const c = Number(value);
  if (!Number.isFinite(c)) return 5;
  return Math.max(5, Math.min(95, Math.round(c)));
}

// Confidence of a node in a chain = incoming edge confidence decayed by hop position.
// rootNode keeps its own signal confidence (passed in).
export function propagateConfidence(rootConfidence, hops) {
  let conf = clampConfidence(rootConfidence);
  for (let i = 0; i < hops; i++) {
    conf = clampConfidence(conf * (1 - HOP_DECAY));
  }
  return conf;
}

// Aggregate chain confidence: weighted by path length (shorter = stronger signal).
export function chainConfidence(edges = []) {
  if (!edges.length) return 0;
  const perEdge = edges.map((e) => Number(e.confidence) || 0);
  const avg = perEdge.reduce((a, b) => a + b, 0) / perEdge.length;
  // Discount multi-hop chains slightly to reflect compounding uncertainty.
  const discount = Math.max(0.7, 1 - (edges.length - 1) * 0.05);
  return clampConfidence(avg * discount);
}

// Star rating 1-5 (used in compact chips). Mirrors registry helper but local to avoid cycle.
export function confidenceStars(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return 0;
  return Math.max(1, Math.min(5, Math.round(c / 20)));
}
