// useETFIntelligence — front-end consumer of the ETF Intelligence provider
// (first implementation: ETFdb scraper via /api/etf/*).
//
// ARCHITECTURE (Principle 1): ARW never talks to the scraper directly. This hook
// calls only the normalized backend routes; the backend owns ETF_INTELLIGENCE.
// Degrades to null on unavailable (honest Ghost states, never fabricated).
//
// Principle 3: provider is ETF_INTELLIGENCE (ETFDB_SCRAPER impl). Swapping to
// ETF.com / VettaFi / Morningstar later requires zero front-end changes.

import { useCallback, useEffect, useMemo, useState } from "react";
import { zeninFetchJson } from "../utils/zeninFetch";
import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days (profile)

function etfUrl(path) {
  return `${ZENIN_API_BASE_URL}/api/etf/${path}`;
}

/**
 * @param {string} symbol
 * @returns {{
 *   loading: boolean,
 *   profile: object|null,     // objective, strategy, benchmark, issuer
 *   composition: object|null, // holdings, sector/country/asset allocation
 *   classification: object|null,
 *   strategy: object|null,
 *   peers: object[],
 *   themes: object[],
 *   available: boolean,
 *   error: string|null,
 * }}
 */
export function useETFIntelligence(symbol) {
  const sym = useMemo(() => String(symbol || "").trim().toUpperCase(), [symbol]);
  const [state, setState] = useState({
    loading: Boolean(sym),
    profile: null,
    composition: null,
    classification: null,
    strategy: null,
    peers: [],
    themes: [],
    available: false,
    error: null,
    fetchedAt: 0,
  });

  const load = useCallback(async () => {
    if (!sym) return;
    setState((s) => ({ ...s, loading: true }));
    const j = (p) => zeninFetchJson(etfUrl(p))
      .then((payload) => payload?.available === false ? null : payload)
      .catch(() => null);
    try {
      const [profile, composition, classification, strategy, peers, themes] = await Promise.all([
        j(`profile?symbol=${encodeURIComponent(sym)}`),
        j(`composition?symbol=${encodeURIComponent(sym)}`),
        j(`classification?symbol=${encodeURIComponent(sym)}`),
        j(`strategy?symbol=${encodeURIComponent(sym)}`),
        j(`peers?symbol=${encodeURIComponent(sym)}`),
        j(`themes?symbol=${encodeURIComponent(sym)}`),
      ]);
      const available = Boolean(profile || composition || classification || strategy || peers?.length || themes?.length);
      setState({
        loading: false,
        profile: profile || null,
        composition: composition || null,
        classification: classification || null,
        strategy: strategy || null,
        peers: Array.isArray(peers) ? peers : [],
        themes: Array.isArray(themes) ? themes : [],
        available,
        error: null,
        fetchedAt: Date.now(),
      });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: e?.message || "ETF intelligence unavailable", available: false }));
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

export default useETFIntelligence;
