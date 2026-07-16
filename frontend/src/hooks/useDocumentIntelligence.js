// useDocumentIntelligence — front-end consumer of the Document Intelligence
// provider (first implementation: SEC EDGAR via /api/document/*).
//
// ARCHITECTURE (Principle 1): ARW never talks to SEC directly. This hook only
// calls the normalized backend routes; the backend owns the provider. If the
// backend route is unavailable (provider not yet wired), every field degrades
// to null and the panels render their honest Ghost state — never fabricated.
//
// Principle 2: the provider is DOCUMENT_INTELLIGENCE (SEC_API_PROVIDER impl).
// This hook is provider-agnostic; swapping to Companies House / SEDAR / EDINET
// later requires zero front-end changes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { zeninFetchJson } from "../utils/zeninFetch";
import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

const TTL_MS = 15 * 60 * 1000; // 15 min (latest filings)

function docUrl(path) {
  return `${ZENIN_API_BASE_URL}/api/document/${path}`;
}

/**
 * @param {string} symbol
 * @returns {{
 *   loading: boolean,
 *   latestFiling: object|null,
 *   timeline: object[],
 *   recentEvents: object[],
 *   filings: object[],
 *   ownership: object|null,     // 13F: institutional %, top holders, trend, concentration
 *   insiders: object|null,      // Form 4: recent trades, net buy/sell
 *   governance: object|null,    // proxy: board, comp, proposals
 *   corporateActions: object[],
 *   sections: object|null,      // extracted filing sections (Business/MD&A/Risk)
 *   available: boolean,
 *   error: string|null,
 * }}
 */
export function useDocumentIntelligence(symbol) {
  const sym = useMemo(() => String(symbol || "").trim().toUpperCase(), [symbol]);
  const [state, setState] = useState({
    loading: Boolean(sym),
    latestFiling: null,
    timeline: [],
    recentEvents: [],
    filings: [],
    ownership: null,
    insiders: null,
    governance: null,
    corporateActions: [],
    sections: null,
    available: false,
    error: null,
    fetchedAt: 0,
  });

  const load = useCallback(async () => {
    if (!sym) return;
    setState((s) => ({ ...s, loading: true }));
    const j = (p) => zeninFetchJson(docUrl(p)).catch(() => null);
    try {
      const [company, ownership, insiders, governance, corp, sections] = await Promise.all([
        j(`${encodeURIComponent(sym)}/company`),
        j(`${encodeURIComponent(sym)}/ownership`),
        j(`${encodeURIComponent(sym)}/insiders`),
        j(`${encodeURIComponent(sym)}/governance`),
        j(`${encodeURIComponent(sym)}/corporate-actions`),
        j(`${encodeURIComponent(sym)}/sections`),
      ]);
      const latestFiling = company?.latestFiling || company?.filing || null;
      const timeline = Array.isArray(company?.timeline) ? company.timeline : [];
      const recentEvents = Array.isArray(company?.recentEvents) ? company.recentEvents : [];
      const filings = Array.isArray(company?.filings) ? company.filings : [];
      const sectionsData = sections?.data || sections?.sections || null; // extracted Business/MD&A/Risk
      const corporateActions = Array.isArray(corp?.corporateActions)
        ? corp.corporateActions
        : Array.isArray(corp)
          ? corp
          : [];
      const available = Boolean(
        latestFiling || ownership?.data?.institutionalPct != null || insiders?.data?.trades?.length || governance?.data || corporateActions.length
      );
      setState({
        loading: false,
        latestFiling,
        timeline,
        recentEvents,
        filings,
        ownership: ownership?.data || null,
        insiders: insiders?.data || null,
        governance: governance?.data || null,
        corporateActions,
        sections: sectionsData,
        provider: company?.provider || ownership?.provider || insiders?.provider || null,
        freshness: company?.freshness || ownership?.freshness || insiders?.freshness || null,
        sourceUrl: latestFiling?.url || company?.sourceUrl || null,
        available,
        error: null,
        fetchedAt: Date.now(),
      });
      // NOTE (spec §4): ingestion, deduplication, matching, and alerts now occur
      // ONLY on the backend (SecApiStreamWorker). The browser no longer publishes
      // document-intelligence events as the source of truth; it renders persisted
      // events instead. The publish calls below were removed intentionally.
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e?.message || "Document intelligence unavailable", available: false }));
    }
  }, [sym]);

  useEffect(() => {
    if (!sym) return undefined;
    let alive = true;
    if (Date.now() - state.fetchedAt > TTL_MS) {
      load();
    }
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, load]);

  return { ...state, refresh: load };
}

export default useDocumentIntelligence;
