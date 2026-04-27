import { useEffect, useMemo, useState } from "react";
import { canUseWebSocket, resolveZeninWsUrl } from "../utils/livePriceStream";

const normalizeSymbol = (symbol) => String(symbol || "").trim().toUpperCase();

const normalizeAssetType = (asset) => {
  const raw = String(asset?.type || "").toLowerCase();
  const marketType = String(asset?.marketType || "").toLowerCase();
  const category = String(asset?.category || "").toLowerCase();
  if (["stock", "stocks", "equity", "etf", "etfs"].includes(raw) || marketType === "equity") return "tradfi";
  if (raw === "crypto" || raw === "stablecoin" || raw === "exchange token" || marketType === "spot" || marketType === "perp") return "crypto";
  if (raw === "indicator" || category === "indicators" || marketType === "macro") return "indicator";
  if (marketType === "options") return "options";
  return asset?.theme || category ? "tradfi" : "tradfi";
};

export function useLivePriceStream({
  watchlistAssets = [],
  portfolio = [],
  selectedAsset = null,
  priceCacheRef,
  setAssets,
  setWatchlistAssets,
  setPortfolio,
  setSelectedAsset,
} = {}) {
  const [status, setStatus] = useState("idle");
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const symbolsByType = useMemo(() => {
    const groups = { tradfi: new Set(), crypto: new Set() };
    const addAsset = (asset) => {
      const symbol = normalizeSymbol(asset?.symbol || asset?.asset);
      if (!symbol) return;
      const type = normalizeAssetType(asset);
      if (type === "indicator" || type === "options") return;
      groups[type === "crypto" ? "crypto" : "tradfi"].add(symbol);
    };

    (Array.isArray(watchlistAssets) ? watchlistAssets : []).forEach(addAsset);
    (Array.isArray(portfolio) ? portfolio : []).forEach(addAsset);
    if (selectedAsset) addAsset(selectedAsset);

    return {
      tradfi: [...groups.tradfi].slice(0, 80),
      crypto: [...groups.crypto].slice(0, 80),
    };
  }, [portfolio, selectedAsset, watchlistAssets]);

  useEffect(() => {
    if (!canUseWebSocket()) {
      setStatus("degraded");
      return;
    }

    const subscriptions = [
      { quoteType: "tradfi", symbols: symbolsByType.tradfi },
      { quoteType: "crypto", symbols: symbolsByType.crypto },
    ].filter((subscription) => subscription.symbols.length > 0);

    if (subscriptions.length === 0) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    const sockets = [];
    const socketUrl = resolveZeninWsUrl("/live");

    const applyLiveQuotes = (prices, updatedAt) => {
      const entries = Object.entries(prices || {})
        .map(([symbol, quote]) => {
          const normalizedSymbol = normalizeSymbol(symbol);
          const price = Number(quote?.price);
          const priceChangePercent = Number(quote?.priceChangePercent);
          if (!normalizedSymbol || (!Number.isFinite(price) && !Number.isFinite(priceChangePercent))) return null;
          return [
            normalizedSymbol,
            {
              price: Number.isFinite(price) ? price : null,
              priceChangePercent: Number.isFinite(priceChangePercent) ? priceChangePercent : null,
              updatedAt: updatedAt || new Date().toISOString(),
            },
          ];
        })
        .filter(Boolean);
      if (!entries.length) return;

      const quoteMap = new Map(entries);
      quoteMap.forEach((quote, symbol) => {
        const previous = priceCacheRef?.current?.get(symbol);
        priceCacheRef?.current?.set(symbol, {
          price: quote.price ?? previous?.price ?? null,
          priceChangePercent: quote.priceChangePercent ?? previous?.priceChangePercent ?? null,
          updatedAt: quote.updatedAt,
        });
      });

      const enrichRow = (row) => {
        const symbol = normalizeSymbol(row?.symbol || row?.asset);
        const quote = quoteMap.get(symbol);
        if (!quote) return row;
        const previousPrice = Number(row?.price);
        const nextPrice = quote.price ?? row?.price;
        const direction = Number.isFinite(previousPrice) && Number.isFinite(Number(nextPrice)) && Number(nextPrice) !== previousPrice
          ? (Number(nextPrice) > previousPrice ? "up" : "down")
          : row?._liveDirection || null;
        return {
          ...row,
          price: quote.price ?? row?.price,
          priceChangePercent: quote.priceChangePercent ?? row?.priceChangePercent,
          _liveDirection: direction,
          _liveUpdatedAt: quote.updatedAt,
        };
      };

      setAssets?.((prev) => prev.map(enrichRow));
      setWatchlistAssets?.((prev) => prev.map(enrichRow));
      setPortfolio?.((prev) => prev.map(enrichRow));
      setSelectedAsset?.((prev) => (prev ? enrichRow(prev) : prev));
      setLastUpdatedAt(updatedAt || new Date().toISOString());
    };

    subscriptions.forEach(({ quoteType, symbols }) => {
      const ws = new WebSocket(socketUrl);
      sockets.push(ws);

      ws.addEventListener("open", () => {
        if (cancelled) return;
        setStatus("connected");
        ws.send(JSON.stringify({ type: "subscribePrices", quoteType, symbols }));
      });

      ws.addEventListener("message", (event) => {
        if (cancelled) return;
        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "price_update") {
            setStatus("connected");
            applyLiveQuotes(payload.prices, payload.updatedAt);
          } else if (payload?.type === "price_error") {
            setStatus("degraded");
          }
        } catch (err) {
          console.warn("Live price stream message ignored:", err);
        }
      });

      ws.addEventListener("error", () => {
        if (!cancelled) setStatus("degraded");
      });

      ws.addEventListener("close", () => {
        if (!cancelled) setStatus("degraded");
      });
    });

    return () => {
      cancelled = true;
      sockets.forEach((ws) => {
        try { ws.close(); } catch {}
      });
    };
  }, [symbolsByType.crypto.join(","), symbolsByType.tradfi.join(",")]);

  return { liveStreamStatus: status, lastLivePriceAt: lastUpdatedAt };
}
