import { useEffect, useState } from "react";
import { zeninFetch } from "../../utils/zeninFetch";
import { readResilientCache, writeResilientCache } from "../../utils/resilientData";
import { computeReturns } from "./comparisonUtils";
import { normalizeAssetData } from "../../utils/normalizeAssetData";

// Fetches the data needed to compare one asset: price, history (for performance),
// earnings (fundamentals/valuation/consensus) and finviz. Mirrors AssetModal's
// fetch patterns. No fabricated values — missing fields stay null/"—".
export function useComparisonAsset(symbol, type = "equity") {
  const [state, setState] = useState({
    loading: true,
    stale: false,
    error: null,
    data: null
  });

  useEffect(() => {
    if (!symbol) {
      setState({ loading: false, stale: false, error: null, data: null });
      return;
    }
    const controller = new AbortController();
    const { signal } = controller;
    const sym = String(symbol).toUpperCase();

    const load = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));

      const cacheKey = { symbol: sym, type };
      const cached = readResilientCache("comparison-asset", cacheKey);
      let partial = null;
      if (cached?.payload) {
        partial = cached.payload;
        setState((s) => ({ ...s, loading: false, stale: Boolean(cached.payload?.stale), data: cached.payload }));
      }

      try {
        const params = new URLSearchParams({ symbol: sym, type });
        const [pricesRes, historyRes, earningsRes, finvizRes] = await Promise.all([
          zeninFetch(`/prices?${params.toString()}`, { signal }).catch(() => null),
          zeninFetch(`/history?${params.toString()}&interval=5Y`, { signal }).catch(() => null),
          zeninFetch(`/earnings?symbol=${sym}`, { signal }).catch(() => null),
          zeninFetch(`/finviz?symbol=${sym}`, { signal }).catch(() => null)
        ]);

        const history = Array.isArray(historyRes?.history) ? historyRes.history : [];
        const returns = computeReturns(history);

        const data = {
          ...normalizeAssetData({ pricesRes, earningsRes, finvizRes, symbol: sym }),
          type,
          history,
          returns,
          stale: Boolean(pricesRes?.stale || earningsRes?.stale || historyRes?.stale)
        };
        writeResilientCache("comparison-asset", cacheKey, data);
        setState({ loading: false, stale: Boolean(data.stale), error: null, data });
      } catch (err) {
        if (signal.aborted) return;
        if (partial) {
          setState((s) => ({ ...s, loading: false, stale: true, error: "partial" }));
        } else {
          setState({ loading: false, stale: false, error: String(err?.message || err), data: null });
        }
      }
    };

    load();
    return () => controller.abort();
  }, [symbol, type]);

  return state;
}
