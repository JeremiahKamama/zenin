// ETFEventPublisher — Corrections 5 & 6.
// Receives provider updates, normalizes to the unified event schema (Correction
// 8), and publishes to the Intelligence Bus. CRITICAL RULE (Correction 5):
// NEVER publish placeholder/simulated events. If the provider returns nothing,
// nothing is published. Until the ETF Intelligence / SEC providers are wired
// this publisher stays DORMANT — start() is a no-op that resolves immediately.
import { publishMany } from "../utils/intelligenceBus";
import { resolveCapability } from "../utils/DataCoverageRegistry";

// Normalize a raw provider event into the unified schema (Correction 8).
export function normalizeEtfEvent(raw = {}) {
  return {
    id: raw.id || `etf-${raw.asset || "?"}-${raw.timestamp || Date.now()}`,
    assetType: "ETF",
    asset: raw.asset || raw.symbol || null,
    provider: raw.provider || null,
    category: raw.category || "fund",
    headline: raw.headline || "",
    summary: raw.summary || "",
    importance: raw.importance ?? raw.impact ?? "neutral",
    confidence: raw.confidence ?? null,
    timestamp: raw.timestamp || new Date().toISOString(),
    document: raw.document || null,
    affectedAssets: raw.affectedAssets || raw.assets || [],
    deepLinks: raw.deepLinks || [],
    // bus compatibility
    type: "etf",
    contexts: ["etf", "portfolio", "watchlist"],
  };
}

// Pull from a provider and publish ONLY real events. Returns count published.
export async function publishEtfEvents(provider) {
  if (!provider || typeof provider.getEvents !== "function") return 0;
  const raw = await provider.getEvents();
  const events = Array.isArray(raw) ? raw : [];
  if (!events.length) return 0; // Correction 5: no data → no publication.
  const normalized = events.map(normalizeEtfEvent).filter((e) => e.asset && e.headline);
  if (!normalized.length) return 0;
  publishMany(normalized);
  return normalized.length;
}

// Is the ETF event capability actually live? Consults the Capability Registry.
export function isEtfEventStreamLive() {
  const cap = resolveCapability("ETF_DOCUMENT_INTELLIGENCE");
  return cap.status === "available";
}

// Start the publisher. Dormant while the capability is unavailable — no polling,
// no fake events, no timers.
export function startEtfEventPublisher(provider) {
  if (!isEtfEventStreamLive()) {
    return { active: false, reason: "ETF Document Intelligence provider not connected" };
  }
  publishEtfEvents(provider);
  return { active: true };
}

export default { normalizeEtfEvent, publishEtfEvents, isEtfEventStreamLive, startEtfEventPublisher };
