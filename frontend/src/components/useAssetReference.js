import { useEffect, useState } from "react";
import { zeninFetch } from "../utils/zeninFetch";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { normalizeAssetData } from "../utils/normalizeAssetData";

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
        const [pricesRes, earningsRes, finvizRes, massiveRes] = await Promise.all([
          zeninFetch(`/prices?${params.toString()}`, { signal }).catch(() => null),
          zeninFetch(`/earnings?symbol=${sym}`, { signal }).catch(() => null),
          zeninFetch(`/finviz?symbol=${sym}`, { signal }).catch(() => null),
          // 4th parallel call: Massive per-symbol real-time depth (OHLCV series
          // + last trade/quote). Degrades gracefully to null when Massive is
          // unconfigured (routes return 503 { error: "massive_unconfigured" }
          // or 502). Additive — never replaces the existing reference fetches.
          Promise.all([
            zeninFetch(`/api/equities/${sym}/aggregates?resolution=day&timespan=1Y`, { signal }).catch(() => null),
            zeninFetch(`/api/equities/${sym}/last-trade`, { signal }).catch(() => null),
            zeninFetch(`/api/equities/${sym}/last-quote`, { signal }).catch(() => null),
          ]).then(([agg, lastTrade, lastQuote]) => ({ agg, lastTrade, lastQuote }))
            .catch(() => null),
        ]);

        // Normalize the Massive payloads into optional series + realtime fields.
        const series = normalizeMassiveSeries(massiveRes?.agg);
        const realtime = normalizeMassiveRealtime(massiveRes?.lastTrade, massiveRes?.lastQuote);

        const data = {
          ...normalizeAssetData({ pricesRes, earningsRes, finvizRes, symbol: sym }),
          type,
          assetClass: type,
          series,
          realtime,
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

// --- Massive payload normalizers (additive, optional) -----------------------
// Aggregates route returns either Polygon-style { data: { results: [{ t, o, h,
// l, c, v }] } } or a Yahoo fallback { history: [{ t, o, h, l, c, v }] }. Both
// degrade to null when Massive is unconfigured (503/502) or the payload is empty.
function normalizeMassiveSeries(aggRes) {
  if (!aggRes || aggRes.error) return null;
  const results = aggRes.data?.results || aggRes.history || null;
  if (!Array.isArray(results) || results.length === 0) return null;
  const points = results
    .map((p) => ({
      t: p.t || p.timestamp || null,
      o: Number(p.o ?? p.open ?? null),
      h: Number(p.h ?? p.high ?? null),
      l: Number(p.l ?? p.low ?? null),
      c: Number(p.c ?? p.close ?? null),
      v: Number(p.v ?? p.volume ?? null),
    }))
    .filter((p) => Number.isFinite(p.c));
  if (!points.length) return null;
  return { source: aggRes.source || null, isFallback: Boolean(aggRes.isFallback), points };
}

// Last-trade → { price, ts }; last-quote → { bid, ask, bidSize, askSize }.
function normalizeMassiveRealtime(lastTradeRes, lastQuoteRes) {
  if ((!lastTradeRes || lastTradeRes.error) && (!lastQuoteRes || lastQuoteRes.error)) return null;
  const lt = lastTradeRes?.data || null;
  const lq = lastQuoteRes?.data || null;
  const price = lt ? Number(lt.p ?? lt.price ?? lt.last ?? null) : null;
  const out = {
    price: Number.isFinite(price) ? price : null,
    ts: lt?.t ?? lt?.timestamp ?? null,
    bid: lq ? Number(lq.bp ?? lq.bid ?? null) : null,
    ask: lq ? Number(lq.ap ?? lq.ask ?? null) : null,
    bidSize: lq?.bs ?? lq?.bidSize ?? null,
    askSize: lq?.as ?? lq?.askSize ?? null,
    source: lastTradeRes?.source || lastQuoteRes?.source || null,
  };
  const hasAny = out.price != null || out.bid != null || out.ask != null;
  return hasAny ? out : null;
}
