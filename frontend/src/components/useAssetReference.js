import { useEffect, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";

// Shared reference-data hook for the ARW Asset Header and rails.
// Mirrors useComparisonAsset's fetch pattern (single asset) so ARW and Compare
// consume ONE real-data source. No fabricated values — missing fields stay null.
export function useAssetReference(symbol, type = "equity") {
  const [state, setState] = useState({ loading: true, stale: false, error: null, data: null });

  useEffect(() => {
    const sym = String(symbol || "").trim().toUpperCase();
    if (!sym) {
      setState({ loading: false, stale: false, error: null, data: null });
      return undefined;
    }
    const controller = new AbortController();
    const { signal } = controller;

    const load = async () => {
      setState((s) => ({ ...s, loading: true, error: null }));
      const cacheKey = { symbol: sym, type };
      const cached = readResilientCache("asset-reference", cacheKey);
      if (cached?.payload) {
        setState((s) => ({ ...s, loading: false, stale: Boolean(cached.payload.stale), data: cached.payload }));
      }
      try {
        const params = new URLSearchParams({ symbol: sym, type });
        const [pricesRes, earningsRes, finvizRes] = await Promise.all([
          zeninFetch(`/prices?${params.toString()}`, { signal }).catch(() => null),
          zeninFetch(`/earnings?symbol=${sym}`, { signal }).catch(() => null),
          zeninFetch(`/finviz?symbol=${sym}`, { signal }).catch(() => null),
        ]);
        const earnings = earningsRes || null;
        const finviz = finvizRes && !finvizRes.error ? finvizRes : null;
        const price = pricesRes?.price ?? earnings?.profile?.price ?? null;
        const change = pricesRes?.change ?? null;
        const changePct = pricesRes?.changePercent ?? pricesRes?.priceChangePercent ?? null;
        const data = {
          symbol: sym,
          type,
          name: earnings?.profile?.companyName || finviz?.name || sym,
          exchange: earnings?.profile?.exchange || finviz?.exchange || null,
          sector: earnings?.profile?.sector || finviz?.sector || null,
          industry: earnings?.profile?.industry || finviz?.industry || null,
          country: earnings?.profile?.country || finviz?.country || null,
          beta: earnings?.profile?.beta ?? finviz?.beta ?? null,
          price,
          change,
          changePct,
          marketCap: earnings?.profile?.marketCap ?? finviz?.marketCap ?? null,
          high52: earnings?.profile?.fiftyTwoWeekHigh ?? finviz?.fiftyTwoWeekHigh ?? null,
          low52: earnings?.profile?.fiftyTwoWeekLow ?? finviz?.fiftyTwoWeekLow ?? null,
          assetClass: type,
          earnings,
          finviz,
          stale: Boolean(pricesRes?.stale || earningsRes?.stale),
          fetchedAt: Date.now(),
        };
        writeResilientCache("asset-reference", cacheKey, data);
        setState({ loading: false, stale: Boolean(data.stale), error: null, data });
      } catch (err) {
        if (signal.aborted) return;
        if (cached?.payload) setState((s) => ({ ...s, loading: false, stale: true, error: "partial" }));
        else setState({ loading: false, stale: false, error: String(err?.message || err), data: null });
      }
    };

    load();
    return () => controller.abort();
  }, [symbol, type]);

  return state;
}
