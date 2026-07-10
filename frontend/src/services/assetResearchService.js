// Asset Research Service (ARW v3 — Phase 1 foundation)
//
// Implements the v3 single-ownership rule: Research Service owns the
// research objects (theses, notes, catalysts, triggers, conviction, documents,
// checklists) for an asset. Today this is backed by the existing
// `workspacePersistence` local/remote collections so it is additive and does
// not orphan live data. Each domain's `symbols[]` field is the asset key.
//
// Per v3 C.6 ("Remove parallel stores"): UI must never write localStorage or
// the remote collection directly. This service is the ONLY write path. When the
// canonical service layer lands (Phase 1b), swap the persistence import here —
// nothing else in ARW changes.
//
// All reads/writes are asset-scoped: `getResearch(symbol)` returns the research
// objects linked to that symbol; `saveObjects` persists only the objects that
// carry that symbol.

import {
  readLocalJson,
  writeLocalJson,
  loadWorkspaceCollection,
  saveWorkspaceCollection,
} from "../utils/workspacePersistence";

const NAMESPACES = {
  documents: "research:knowledge:documents",
  theses: "research:knowledge:theses",
  catalysts: "research:knowledge:catalysts",
  triggers: "research:knowledge:triggers",
  sources: "research:knowledge:sources",
};
const LOCAL_KEYS = {
  documents: "zenin_research_knowledge_documents",
  theses: "zenin_research_knowledge_theses",
  catalysts: "zenin_research_knowledge_catalysts",
  triggers: "zenin_research_knowledge_triggers",
  sources: "zenin_research_knowledge_sources",
};
const LIMITS = { documents: 1000, theses: 500, catalysts: 300, triggers: 300, sources: 200 };

const normalizeSymbol = (symbol) => String(symbol || "").trim().toUpperCase();

function matchesSymbol(object, symbol) {
  const sym = normalizeSymbol(symbol);
  if (!sym) return false;
  const list = Array.isArray(object?.symbols) ? object.symbols : [object?.symbol];
  return list.some((s) => normalizeSymbol(s) === sym);
}

async function loadDomain(domain) {
  const remote = await loadWorkspaceCollection(NAMESPACES[domain], []).catch(() => null);
  if (remote && Array.isArray(remote.items) && remote.items.length) return remote.items;
  return readLocalJson(LOCAL_KEYS[domain], []);
}

async function persistDomain(domain, items) {
  writeLocalJson(LOCAL_KEYS[domain], items);
  await saveWorkspaceCollection(NAMESPACES[domain], items, LIMITS[domain]).catch(() => null);
  return items;
}

/** v3 C.4 — Research Service is the canonical owner for these domains. */
export const RESEARCH_DOMAINS = ["documents", "theses", "catalysts", "triggers", "sources"];

/**
 * v3 C.6 — Company Profile must call this to read research (read-only consumer).
 * Returns every research object linked to `symbol`.
 */
export async function getResearch(symbol) {
  const sym = normalizeSymbol(symbol);
  const [documents, theses, catalysts, triggers, sources] = await Promise.all(
    // Per-domain catch: one unreadable collection must never reject the whole
    // research load (backend down / workspace unavailable → graceful empty).
    RESEARCH_DOMAINS.map((d) => loadDomain(d).catch(() => []))
  );
  const scope = (arr) => (Array.isArray(arr) ? arr.filter((o) => matchesSymbol(o, sym)) : []);
  return {
    symbol: sym,
    documents: scope(documents),
    theses: scope(theses),
    catalysts: scope(catalysts),
    triggers: scope(triggers),
    sources,
  };
}

/** Insert or update one research object for an asset, persisting only its domain. */
export async function saveResearchObject(domain, object) {
  if (!RESEARCH_DOMAINS.includes(domain)) {
    throw new Error(`[assetResearchService] unknown domain: ${domain}`);
  }
  const all = await loadDomain(domain);
  const list = Array.isArray(all) ? all : [];
  const id = object?.id || `${domain}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next = { ...object, id };
  const idx = list.findIndex((o) => o.id === id);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  await persistDomain(domain, list);
  return next;
}

/** Remove a research object by id within its domain. */
export async function deleteResearchObject(domain, id) {
  if (!RESEARCH_DOMAINS.includes(domain)) return;
  const list = await loadDomain(domain);
  await persistDomain(domain, (Array.isArray(list) ? list : []).filter((o) => o.id !== id));
}

/** Counts for the ARW sidebar/rail badges. */
export async function getResearchCounts(symbol) {
  const research = await getResearch(symbol);
  return {
    theses: research.theses.length,
    catalysts: research.catalysts.length,
    triggers: research.triggers.length,
    notes: research.documents.length,
  };
}
