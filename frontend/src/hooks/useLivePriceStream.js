import { startTransition, useEffect, useMemo, useState, useRef } from "react";
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
  const [retryCount, setRetryCount] = useState(0);
  const reconnectTimerRef = useRef(null);
  const heartbeatTimerRef = useRef(null);
  const watchdogTimerRef = useRef(null);
  
  const WATCHDOG_TIMEOUT_MS = 45000; // 45s without a message = dead connection
  const HEARTBEAT_INTERVAL_MS = 30000; // 30s ping to keep alive

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

    const resetWatchdog = () => {
      clearTimeout(watchdogTimerRef.current);
      watchdogTimerRef.current = setTimeout(() => {
        if (cancelled) return;
        console.warn("Live stream watchdog triggered: No messages received for 45s. Reconnecting...");
        handleConnectionFailure();
      }, WATCHDOG_TIMEOUT_MS);
    };

    const applyLiveQuotes = (prices, updatedAt) => {
      resetWatchdog();
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

      startTransition(() => {
        setAssets?.((prev) => prev.map(enrichRow));
        setWatchlistAssets?.((prev) => prev.map(enrichRow));
        setPortfolio?.((prev) => prev.map(enrichRow));
        setSelectedAsset?.((prev) => (prev ? enrichRow(prev) : prev));
        setLastUpdatedAt(updatedAt || new Date().toISOString());
      });
    };

    const handleConnectionFailure = () => {
      if (cancelled) return;
      setStatus("degraded");
      sockets.forEach(s => { try { s.close(); } catch {} });
      
      const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled) setRetryCount(c => c + 1);
      }, delay);
    };

    subscriptions.forEach(({ quoteType, symbols }) => {
      try {
        const ws = new WebSocket(socketUrl);
        sockets.push(ws);

        ws.addEventListener("open", () => {
          if (cancelled) return;
          setStatus("connected");
          setRetryCount(0);
          ws.send(JSON.stringify({ type: "subscribePrices", quoteType, symbols }));
          
          // Start heartbeat
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = setInterval(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: "ping" }));
            }
          }, HEARTBEAT_INTERVAL_MS);
          
          resetWatchdog();
        });

        ws.addEventListener("message", (event) => {
          if (cancelled) return;
          resetWatchdog();
          try {
            const payload = JSON.parse(event.data);
            if (payload?.type === "price_update") {
              setStatus("connected");
              applyLiveQuotes(payload.prices, payload.updatedAt);
            } else if (payload?.type === "pong") {
              // Heartbeat acknowledged
            } else if (payload?.type === "price_error") {
              setStatus("degraded");
            }
          } catch (err) {
            console.warn("Live price stream message ignored:", err);
          }
        });

        ws.addEventListener("error", handleConnectionFailure);
        ws.addEventListener("close", handleConnectionFailure);
      } catch (err) {
        console.warn("Failed to initiate WebSocket:", err);
        handleConnectionFailure();
      }
    });

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimerRef.current);
      clearTimeout(watchdogTimerRef.current);
      clearInterval(heartbeatTimerRef.current);
      sockets.forEach((ws) => {
        try { ws.close(); } catch {}
      });
    };
  }, [symbolsByType.crypto.join(","), symbolsByType.tradfi.join(","), retryCount]);

  return { liveStreamStatus: status, lastLivePriceAt: lastUpdatedAt };
}
