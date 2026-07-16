// useEtfResearchData — ETFdb-backed research hook for the ETF ARW / modal.
//
// COMPANION to useETFIntelligence (which serves the legacy /profile,/composition
// scraper aliases). This hook targets the NEW ETFdb API adapter routes
// (/overview, /composition, /metrics, /flows). It is capability-driven: when the
// backend adapter is inert (ETF_INTELLIGENCE_ETFDB_API_ENABLED=false) every route
// returns { available:false, freshness:"unavailable" } and this hook surfaces an
// honest `unavailable` state — never fabricated composition/economics.
//
// Live quote + chart history remain Yahoo/FMP sourced (see EtfAdapter /
// useLiveQuote); this hook only carries ETFdb reference data + provenance.

import { useCallback, useEffect, useMemo, useState } from "react";
import { zeninFetchJson } from "../utils/zeninFetch";
import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

const TTL_MS = 24 * 60 * 60 * 1000; // 24h

function etfUrl(path) {
  return `${ZENIN_API_BASE_URL}/api/etf/${path}`;
}

export function useEtfResearchData(symbol) {
  const sym = useMemo(() => String(symbol || "").trim().toUpperCase(), [symbol]);
  const [state, setState] = useState({
    overview: null,
    composition: null,
    metrics: null,
    flows: null,
    loading: Boolean(sym),
    stale: false,
    unavailable: !sym,
    provenance: null,
    error: null,
    fetchedAt: 0,
  });

  const load = useCallback(async () => {
    if (!sym) return;
    setState((s) => ({ ...s, loading: true }));
    const j = (p) =>
      zeninFetchJson(etfUrl(p))
        .then((payload) => (payload && payload.available === false ? null : payload))
        .catch(() => null);

    try {
      const [overview, composition, metrics, flows] = await Promise.all([
        j(`${encodeURIComponent(sym)}/overview`),
        j(`${encodeURIComponent(sym)}/composition`),
        j(`${encodeURIComponent(sym)}/metrics`),
        j(`${encodeURIComponent(sym)}/flows`),
      ]);

      const freshnesses = [overview, composition, metrics, flows]
        .map((d) => d?.freshness)
        .filter(Boolean);
      const anyAvailable = Boolean(overview || composition || metrics || flows);
      const stale = freshnesses.includes("stale");
      const unavailable = !anyAvailable;

      setState({
        overview: overview || null,
        composition: composition || null,
        metrics: metrics || null,
        flows: flows || null,
        loading: false,
        stale,
        unavailable,
        provenance: overview?.provenance || composition?.provenance || metrics?.provenance || flows?.provenance || null,
        error: null,
        fetchedAt: Date.now(),
      });
    } catch (e) {
      setState((s) => ({
        ...s,
        loading: false,
        unavailable: true,
        error: e?.message || "ETF research data unavailable",
      }));
    }
  }, [sym]);

  useEffect(() => {
    if (!sym) return undefined;
    if (Date.now() - state.fetchedAt > TTL_MS) load();
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym, load]);

  return { ...state, refresh: load };
}

export default useEtfResearchData;
