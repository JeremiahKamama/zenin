// useMarketIntel — second data layer for ARW + Compare, sourcing the
// /api/market/* routes (FMP-backed company fundamentals, news, insiders,
// analysts, decision threads).
//
// Design contract (per the Unified Execution Plan):
//  - Graceful degradation: any failed/empty fetch resolves to null. Components
//    keep their GuidedEmptyState. Never throws to the UI, never renders a bare "—"
//    where the data simply isn't available yet.
//  - Mirrors the zeninFetch + resilient-cache pattern of useAssetReference.
//  - Every route is optional; callers pass the subset they need.

import { useEffect, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";

const ENDPOINTS = {
  income: (s) => `/api/market/company/${s}/income`,
  balance: (s) => `/api/market/company/${s}/balance`,
  cashflow: (s) => `/api/market/company/${s}/cashflow`,
  ratios: (s) => `/api/market/company/${s}/ratios`,
  keyMetrics: (s) => `/api/market/company/${s}/key-metrics`,
  profile: (s) => `/api/market/company/${s}/profile`,
  executives: (s) => `/api/market/company/${s}/executives`,
  analysts: (s) => `/api/market/company/${s}/analysts`,
  news: (s) => `/api/market/news?symbol=${s}`,
  insiders: (s) => `/api/market/insiders/${s}`,
  decisionThreads: (s) => `/api/decision-threads?symbol=${s}`,
};

async function safeFetch(url, signal) {
  try {
    const res = await zeninFetch(url, { signal });
    if (!res || res.error) return null;
    return res;
  } catch {
    return null;
  }
}

// Fetches one or more market-intel datasets for a symbol.
// sources: array of keys from ENDPOINTS (e.g. ["news","insiders","ratios"]).
export function useMarketIntel(symbol, sources = [], { cacheNs = "market-intel" } = {}) {
  const [state, setState] = useState({ loading: true, error: null, data: null });
  const sym = symbol ? String(symbol).toUpperCase() : null;

  useEffect(() => {
    if (!sym || !sources || sources.length === 0) {
      setState({ loading: false, error: null, data: null });
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const cacheKey = { symbol: sym, sources: [...sources].sort().join(",") };

    const load = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const cached = readResilientCache(cacheNs, cacheKey);
      if (cached?.payload) {
        setState({ loading: false, error: null, data: cached.payload });
      }
      try {
        const entries = await Promise.all(
          sources.map(async (key) => {
            const urlFn = ENDPOINTS[key];
            if (!urlFn) return [key, null];
            const res = await safeFetch(urlFn(sym), signal);
            return [key, res ?? null];
          })
        );
        const data = Object.fromEntries(entries);
        writeResilientCache(cacheNs, cacheKey, data);
        setState({ loading: false, error: null, data });
      } catch (err) {
        if (signal.aborted) return;
        // Degrade: keep cached if present, else null data (empty state shows).
        setState((s) => ({ loading: false, error: String(err?.message || err), data: s.data || null }));
      }
    };

    load();
    return () => controller.abort();
  }, [sym, JSON.stringify(sources), cacheNs]);

  return state;
}

// Single-source convenience for the common News + Ownership pair.
export function useAssetMarketIntel(symbol) {
  return useMarketIntel(symbol, ["news", "insiders", "analysts", "ratios", "keyMetrics"], {
    cacheNs: "asset-market-intel"
  });
}

export default useMarketIntel;
