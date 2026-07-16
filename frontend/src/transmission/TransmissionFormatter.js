// TransmissionFormatter — presentation helpers for transmission (monochrome, compact).
import { horizonLabel, horizonWindow, confidenceStars } from "./TransmissionRegistry.js";

export const NO_TRANSMISSION = "No verified transmission available.";

// Render a chain as an indented hierarchy (chevron disclosure handled by component).
export function chainToHierarchy(chain = []) {
  return chain.map((c, idx) => ({
    node: c.node,
    depth: c.depth,
    isRoot: idx === 0,
    edge: c.edge || null,
    direction: c.edge?.direction || "flat",
    confidence: c.edge?.confidence ?? null,
  }));
}

// Compact "Immediate / Next: 2–6 weeks" string for cards.
export function compactHorizon(horizonId, nextHorizonId) {
  const cur = horizonLabel(horizonId);
  const next = nextHorizonId ? `${horizonLabel(nextHorizonId)} (${horizonWindow(nextHorizonId)})` : null;
  return next ? `${cur} · Next: ${next}` : cur;
}

// Star string e.g. "★★★★☆" from confidence.
export function stars(confidence) {
  const n = confidenceStars(confidence);
  return "★".repeat(n) + "☆".repeat(Math.max(0, 5 - n));
}

// Direction glyph for compact arrows.
export function directionGlyph(dir) {
  if (dir === "up") return "↑";
  if (dir === "down") return "↓";
  return "→";
}
