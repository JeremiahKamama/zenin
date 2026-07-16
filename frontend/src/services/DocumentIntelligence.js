// DocumentIntelligence — Correction 9.
// Provider abstraction for document intelligence. The ARW (and every consumer)
// calls THIS, never a concrete provider (SEC API, Companies House, EDINET…).
// Flow:  DocumentIntelligence → <Adapter> → Normalizer → Capability Registry → Bus
// Today no adapter is wired, so every method resolves to a capability-status
// object (never fabricated documents — Correction 10/13).
import { resolveCapability } from "../utils/DataCoverageRegistry";

const CAP = "ETF_DOCUMENT_INTELLIGENCE";

// Registered adapters keyed by provider id. Empty until a real adapter (e.g.
// SecApiAdapter) is registered — the abstraction never changes when one is.
const adapters = {};

export function registerDocumentAdapter(providerId, adapter) {
  if (providerId && adapter) adapters[providerId] = adapter;
}

function activeAdapter() {
  const cap = resolveCapability(CAP);
  if (cap.status === "unavailable") return null;
  return adapters[cap.providerId] || null;
}

// Every method returns { available, capability, data } — consumers render the
// CapabilityStatusCard when available === false rather than an empty tab.
function guard(methodName) {
  return async (...args) => {
    const adapter = activeAdapter();
    const cap = resolveCapability(CAP);
    if (!adapter || typeof adapter[methodName] !== "function") {
      return { available: false, capability: cap, data: null };
    }
    const data = await adapter[methodName](...args);
    return { available: true, capability: cap, data };
  };
}

export const DocumentIntelligence = {
  capability: () => resolveCapability(CAP),
  isAvailable: () => resolveCapability(CAP).status !== "unavailable",
  getDocuments: guard("getDocuments"),
  getFilings: guard("getFilings"),
  getDocument: guard("getDocument"),
  search: guard("search"),
};

export default DocumentIntelligence;
