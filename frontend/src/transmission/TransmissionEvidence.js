// TransmissionEvidence — builds the evidence block for a transmission relationship.
// Every edge exposes: provider(s), method, confidence, data freshness, coverage.
// Reuses the DataQualityIndicator prop shape from deskV2IA (source/updatedAt/confidence/coverage).

import { providerLabel } from "../components/macro/MacroProviderRegistry.js";

// Build an evidence object from a graph edge (or a synthesized edge from live signals).
export function buildEvidence(edge = {}) {
  const providers = Array.isArray(edge.providers) ? edge.providers : [];
  return {
    providers: providers.map((p) => providerLabel(p)),
    rawProviders: providers,
    method: edge.evidence || "Historical relationship",
    confidence: Number(edge.confidence) || null,
    freshness: edge.lastUpdated ? "Updated" : "Not time-sensitive",
    lastUpdated: edge.lastUpdated || null,
    coverage: providers.length ? "Verified" : "Unverified",
  };
}

// Format freshness relative to now (mirrors macro meta strip behavior).
export function formatFreshness(value) {
  if (!value) return "Not time-sensitive";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}
