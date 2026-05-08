import { useState, useEffect, useMemo, useRef } from "react";
import { OptionsCalculator } from "./OptionsCalculator";
import OptionsStrategySimulator from "./OptionsStrategySimulator";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { zeninFetch } from "../utils/zeninFetch";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
const OPTIONS_CHAIN_REFRESH_MS = 180000; // 3 minutes
const TERM_STRUCTURE_REFRESH_MS = 15 * 60 * 1000;

const StrategySimulatorCard = ({
  activeAsset,
  allAssets,
  onChangeAsset,
  onStrategyChosen,
  chain,
  spotPrices,
  showToast,
  loading = false,
  availableExpiries = [],
}) => {
  const supportedAssets = Array.isArray(getAppRuntimeConfig()?.options?.supportedAssets)
    ? getAppRuntimeConfig().options.supportedAssets
    : ["BTC", "ETH", "SOL", "HYPE"];
  const assetOptions = Array.isArray(allAssets) && allAssets.length
    ? allAssets
    : supportedAssets;

  return (
    <div className="watchlist-panel glass strategy-simulator-panel">
      <div className="section-header">
        <div className="header-left">
          <h2>Strategy Simulator for {activeAsset}</h2>
          <span className="asset-count">
            Express your view → pick a play. Generated from {activeAsset} flow.
          </span>
        </div>
        <div className="asset-dropdown-container">
          <label
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              color: "var(--color-text-secondary, #94a3b8)",
              marginRight: 8,
            }}
          >
            Underlying
          </label>
          <select value={activeAsset} onChange={(e) => onChangeAsset(e.target.value)}>
            {assetOptions.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="strategy-simulator-body">
        <OptionsStrategySimulator
          underlying={activeAsset}
          chain={chain}
          spotPrice={spotPrices[activeAsset]}
          maxVisible={20}
          onStrategyChosen={onStrategyChosen}
          showToast={showToast}
          loading={loading}
          availableExpiries={availableExpiries}
        />
      </div>
    </div>
  );
};

export const OptionsModule = ({ 
  activeOptionsTrades, 
  setActiveOptionsTrades, 
  onOptionTradeExecuted, 
  onOptionTradeClosed, 
  balance = 0,
  spotPrices: externalSpotPrices = {},
  showToast
}) => {
  const supportedAssets = Array.isArray(getAppRuntimeConfig()?.options?.supportedAssets)
    ? getAppRuntimeConfig().options.supportedAssets
    : ["BTC", "ETH", "SOL", "HYPE"];
  const rfqAssets = new Set(
    Array.isArray(getAppRuntimeConfig()?.options?.rfqAssets)
      ? getAppRuntimeConfig().options.rfqAssets.map((asset) => String(asset || "").trim().toUpperCase())
      : ["HYPE"]
  );
  const activeTradesRef = useRef(null);
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [availableExpiries, setAvailableExpiries] = useState([]);
  const [spotPrices, setSpotPrices] = useState(externalSpotPrices);
  const [spotSources, setSpotSources] = useState({});
  const [activeExpiry, setActiveExpiry] = useState(null);
  const [allAssets, setAllAssets] = useState(supportedAssets);
  const [chain, setChain] = useState([]);
  const [multiChainCache, setMultiChainCache] = useState({}); // symbol -> chain
  const [metrics, setMetrics] = useState({ iv: 0, pcr: 0, skew: "N/A" });
  const [loading, setLoading] = useState(false);
  const [optionsError, setOptionsError] = useState("");
  const [optionsStale, setOptionsStale] = useState(false);
  const [optionsNotice, setOptionsNotice] = useState("");
  const [marketStructure, setMarketStructure] = useState("orderbook");
  const [marketStructureLabel, setMarketStructureLabel] = useState("Orderbook");
  const [marketStructureNote, setMarketStructureNote] = useState("");
  const [whaleTrades, setWhaleTrades] = useState([]);
  const [whaleLoading, setWhaleLoading] = useState(false);
  const [whaleStale, setWhaleStale] = useState(false);
  const [whaleNotice, setWhaleNotice] = useState("");
  const [whaleMeta, setWhaleMeta] = useState({});
  const [whalePage, setWhalePage] = useState(1);
  const [whaleMinNotional, setWhaleMinNotional] = useState(10000);
  const [whaleSource, setWhaleSource] = useState("telegram");
  const lastSyncToastRef = useRef(null); // Ref to track the last toasted request key
  const [simulatorError, setSimulatorError] = useState("");
  const [strikeWindow, setStrikeWindow] = useState("all");
  const [earningsCalendar, setEarningsCalendar] = useState([]);
  const [termIvByExpiry, setTermIvByExpiry] = useState({});
  const supplementalFetchStateRef = useRef({
    chainInFlight: new Set(),
    spotInFlight: new Set(),
    lastChainFetchAt: {},
    lastSpotFetchAt: {}
  });
  const termStructureFetchStateRef = useRef({
    inFlight: new Set(),
    lastFetchedAt: {}
  });
  
// strategy states removed, now handled inline
const [strategySubmitting, setStrategySubmitting] = useState(false);


  const closeOptionTrade = (id) => {
    if (onOptionTradeClosed) {
      onOptionTradeClosed(id);
      return;
    }
    if (!setActiveOptionsTrades) return;
    setActiveOptionsTrades((prev) => prev.filter((t) => t.id !== id));
  };
  
  const getInternalOptionPnL = (trade) => {
    const tradeChain = multiChainCache[trade.asset] || (trade.asset === activeAsset ? chain : null);
    const tradeSpot = spotPrices[trade.asset] || (trade.asset === activeAsset ? spotPrices[activeAsset] : null);
    return calculateOptionPnL(trade, tradeChain, tradeSpot);
  };

  const getTradeEntryPremium = (trade) => {
    const direct = Number(trade?.netPremiumAtEntry);
    if (Number.isFinite(direct)) return direct;
    const entry = Number(trade?.entryPrice);
    if (Number.isFinite(entry)) return entry;
    const price = Number(trade?.price);
    if (Number.isFinite(price)) return price;
    if (!Array.isArray(trade?.legs)) return 0;
    const fromLegs = trade.legs.reduce((acc, leg) => {
      const v = Number(leg?.entryPrice);
      if (!Number.isFinite(v)) return acc;
      return acc + (String(leg?.side || "").toLowerCase() === "short" ? -v : v);
    }, 0);
    return Number.isFinite(fromLegs) ? fromLegs : 0;
  };

  const getTradeUsdQuantity = (trade) => {
    const explicit = Number(trade?.totalNotional ?? trade?.notional);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
    const qty = Number(trade?.qty ?? trade?.quantity);
    const entryPremium = getTradeEntryPremium(trade);
    if (Number.isFinite(qty) && Number.isFinite(entryPremium) && qty > 0) {
      return Math.abs(entryPremium * qty);
    }
    return 0;
  };

  const syncActiveTradeSnapshots = (assetSymbol, syncedChain, syncedSpot) => {
    if (!setActiveOptionsTrades) return;
    setActiveOptionsTrades((prev) => {
      if (!Array.isArray(prev) || prev.length === 0) return prev;
      let changed = false;
      const next = prev.map((trade) => {
        if (String(trade?.asset || "").toUpperCase() !== String(assetSymbol || "").toUpperCase()) {
          return trade;
        }
        const entryPremium = getTradeEntryPremium(trade);
        const qty = Number(trade?.qty ?? trade?.quantity);
        const normalizedQty = Number.isFinite(qty) && qty > 0 ? qty : 1;
        const metrics = calculateOptionPnL(trade, syncedChain, syncedSpot);
        const updated = {
          ...trade,
          qty: normalizedQty,
          quantity: normalizedQty,
          netPremiumAtEntry: entryPremium,
          currentMark: metrics.currentMark,
          delta: metrics.delta,
          theta: metrics.theta,
          unrealizedPnl: metrics.pnl,
          isStale: metrics.isStale
        };
        if (
          updated.currentMark !== trade.currentMark ||
          updated.delta !== trade.delta ||
          updated.theta !== trade.theta ||
          updated.unrealizedPnl !== trade.unrealizedPnl ||
          updated.isStale !== trade.isStale ||
          updated.qty !== trade.qty ||
          updated.netPremiumAtEntry !== trade.netPremiumAtEntry
        ) {
          changed = true;
        }
        return updated;
      });
      return changed ? next : prev;
    });
  };


const handleStrategyChosen = async (tradePayload) => {
  if (!tradePayload || !tradePayload.notional) return;
  
  setStrategySubmitting(true);
  setOptionsError(""); // Clear any previous errors
  setSimulatorError(""); // Clear strategy-specific errors

  try {
    let entryPremium = 0;
    let initialDelta = 0;
    let initialTheta = 0;

    if (tradePayload.legs && chain.length > 0) {
      tradePayload.legs.forEach(leg => {
        if (leg.type === 'spot') {
          const spot = spotPrices[activeAsset] || 0;
          entryPremium += (leg.side === 'long' ? spot : -spot);
          initialDelta += (leg.side === 'long' ? 1 : -1);
        } else {
          const row = chain.find(r => Math.abs(r.strike - leg.strike) < 0.01);
          if (row) {
            const instr = leg.type === 'call' ? row.call : row.put;
            if (instr) {
              const mark = (Number(instr.bid || 0) + Number(instr.ask || 0)) / 2 || Number(instr.mark) || 0;
              const delta = Number(instr.delta) || 0;
              const theta = Number(instr.theta) || 0;
              
              if (leg.side === 'long') {
                entryPremium += mark;
                initialDelta += delta;
                initialTheta += theta;
              } else {
                entryPremium -= mark;
                initialDelta -= delta;
                initialTheta -= theta;
              }
            }
          }
        }
      });
    }

    // Balance Enforcement
    const totalCost = (entryPremium || 0) * (tradePayload.qty || 1);
    if (balance <= 0) {
      setSimulatorError("Execution blocked: Your account balance is zero or negative.");
      setStrategySubmitting(false);
      return;
    }
    if (totalCost > 0 && balance < totalCost) {
      setSimulatorError(`Insufficient balance. Required: $${totalCost.toFixed(2)}, Available: $${balance.toFixed(2)}`);
      setStrategySubmitting(false);
      return;
    }

    const id = `sim-${Date.now()}`;
    const newTrade = {
      id,
      asset: activeAsset,
      strategy: tradePayload.name || tradePayload.label || "Strategy",
      status: "OPEN",
      executedAt: new Date().toISOString(),
      legs: tradePayload.legs || [],
      netPremiumAtEntry: entryPremium || tradePayload.netPremiumAtEntry || 0,
      initialDelta: initialDelta || 0,
      initialTheta: initialTheta || 0,
      qty: tradePayload.qty ?? 1,
      quantity: tradePayload.qty ?? 1,
      notional: tradePayload.notional ?? 1,
      totalNotional: tradePayload.notional,
    };

    if (onOptionTradeExecuted) {
      await onOptionTradeExecuted(newTrade);
    } else {
      setActiveOptionsTrades((prev) => [newTrade, ...(prev || [])]);
    }

    // Smooth scroll to the Active Trades card
    setTimeout(() => {
      activeTradesRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);

  } catch (err) {
    console.error("Failed to execute strategy", err);
    const errorMsg = err.message || "Strategy execution failed.";
    if (showToast) {
       showToast(errorMsg, "error");
    } else {
       setOptionsError(errorMsg);
    }
    setStrategySubmitting(false);
  }
};

// handleConfirmStrategyTrade removed as it is now handled inline by handleStrategyChosen

useEffect(() => {
  setAllAssets(supportedAssets);
}, [supportedAssets]);

useEffect(() => {
  let cancelled = false;
  const loadEarnings = async () => {
    try {
      const res = await zeninFetch(`/earnings-calendar`);
      if (!res.ok) return;
      const payload = await res.json();
      if (cancelled) return;
      const rows = Array.isArray(payload?.events)
        ? payload.events
        : Array.isArray(payload?.rows)
        ? payload.rows
        : Array.isArray(payload)
        ? payload
        : [];
      setEarningsCalendar(rows);
    } catch {
      if (!cancelled) setEarningsCalendar([]);
    }
  };
  loadEarnings();
  return () => {
    cancelled = true;
  };
}, []);

useEffect(() => {
  if (externalSpotPrices && Object.keys(externalSpotPrices).length > 0) {
    setSpotPrices(prev => ({ ...prev, ...externalSpotPrices }));
  }
}, [externalSpotPrices]);

  // Fetch chains for all open trade assets
  useEffect(() => {
    if (!activeOptionsTrades || activeOptionsTrades.length === 0) return;
    
    const assetsWithTrades = Array.from(new Set(activeOptionsTrades.map(t => t.asset)));
    const fetchState = supplementalFetchStateRef.current;
    const now = Date.now();
    
    assetsWithTrades.forEach(asset => {
      const symbol = String(asset || "").toUpperCase();
      if (!symbol) return;
      // If not in cache and not the active asset
      if (!multiChainCache[symbol] && symbol !== String(activeAsset || "").toUpperCase()) {
        const lastFetchAt = Number(fetchState.lastChainFetchAt[symbol] || 0);
        if (fetchState.chainInFlight.has(symbol) || now - lastFetchAt < OPTIONS_CHAIN_REFRESH_MS) {
          return;
        }
        fetchState.chainInFlight.add(symbol);
        fetchState.lastChainFetchAt[symbol] = now;
        zeninFetch(`/options/crypto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency: symbol })
        })
          .then(res => res.json())
          .then(data => {
            if (data && data.chain) {
              setMultiChainCache(prev => ({ ...prev, [symbol]: data.chain }));
              const spot = Number(spotPrices?.[symbol]) || Number(data?.market_price) || Number(data?.spot) || null;
              if (Number.isFinite(spot) && spot > 0) {
                setSpotPrices(prev => ({ ...prev, [symbol]: spot }));
              }
              syncActiveTradeSnapshots(symbol, data.chain, spot);
            }
          })
          .catch(err => console.error(`Failed to fetch supplementary chain for ${symbol}`, err))
          .finally(() => {
            fetchState.chainInFlight.delete(symbol);
          });
      }
    });

    // Also sync multiChainCache with the current active chain
    if (chain && chain.length > 0) {
       setMultiChainCache(prev => (prev[activeAsset] === chain ? prev : { ...prev, [activeAsset]: chain }));
    }

    // NEW: Also ensure we have spot prices for these assets
    assetsWithTrades.forEach(asset => {
      const symbol = String(asset || "").toUpperCase();
      if (!symbol || Number(spotPrices[symbol]) > 0) return;
      const lastFetchAt = Number(fetchState.lastSpotFetchAt[symbol] || 0);
      if (fetchState.spotInFlight.has(symbol) || now - lastFetchAt < 120000) return;
      fetchState.spotInFlight.add(symbol);
      fetchState.lastSpotFetchAt[symbol] = now;
      zeninFetch(`/prices?type=crypto&symbols=${symbol}`)
          .then(res => res.json())
          .then(data => {
             const price = Number(data?.prices?.[symbol]?.price);
             if (price) {
               setSpotPrices(prev => ({ ...prev, [symbol]: price }));
             }
          })
          .catch(err => console.warn(`Spot price unavailable for ${symbol}; using fallback pricing.`, err))
          .finally(() => {
            fetchState.spotInFlight.delete(symbol);
          });
    });
  }, [activeOptionsTrades, activeAsset, chain]);

useEffect(() => {
  setActiveExpiry(null); // Reset expiry when asset changes
  setTermIvByExpiry({});
}, [activeAsset]);

const pickNearestExpiry = (expiries = []) => {
  const nowSec = Date.now() / 1000;
  const parsed = (Array.isArray(expiries) ? expiries : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
    .sort((a, b) => a - b);
  if (!parsed.length) return null;
  const future = parsed.filter((v) => v >= nowSec);
  return (future.length ? future[0] : parsed[0]);
};

const deriveIvFromChain = (rows = []) => {
  const ivValues = (Array.isArray(rows) ? rows : [])
    .flatMap((row) => [Number(row?.call?.iv), Number(row?.put?.iv)])
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!ivValues.length) return null;
  return ivValues.reduce((sum, v) => sum + v, 0) / ivValues.length;
};

useEffect(() => {
  let isMounted = true; // prevent state update after unmount
  const controller = new AbortController();
  const requestKey = `${String(activeAsset || "").trim().toUpperCase()}:${activeExpiry || "latest"}`;
  const inferredMarketStructure = rfqAssets.has(String(activeAsset || "").trim().toUpperCase()) ? "rfq" : "orderbook";
  const inferredMarketStructureLabel = inferredMarketStructure === "rfq" ? "RFQ" : "Orderbook";
  const inferredMarketStructureNote = inferredMarketStructure === "rfq"
    ? "HYPE can be quoted via Derive RFQ, so the chain ladder may look sparse even when the market is live."
    : "";

  const getHyperliquidFallbackSpot = async (assetSymbol) => {
    try {
      const res = await zeninFetch(`/crypto-market`, { signal: controller.signal });
      if (!res.ok) return null;
      const data = await res.json();
      if (controller.signal.aborted) return null;
      const rows = Array.isArray(data?.assets) ? data.assets : [];
      const match = rows.find(
        (row) => String(row?.symbol || "").toUpperCase() === String(assetSymbol || "").toUpperCase()
      );
      const price = Number(match?.price);
      return Number.isFinite(price) && price > 0 ? price : null;
    } catch {
      return null;
    }
  };

  const fetchChain = async () => {
      const cacheParams = { asset: activeAsset, expiry: activeExpiry || "latest" };
      const cached = readResilientCache("options-chain", cacheParams);
      if (cached?.payload) {
        const cachedChain = Array.isArray(cached.payload?.chain) ? cached.payload.chain : [];
        setMarketStructure(cached.payload?.market_structure || inferredMarketStructure);
        setMarketStructureLabel(cached.payload?.market_structure_label || inferredMarketStructureLabel);
        setMarketStructureNote(cached.payload?.market_structure_note || inferredMarketStructureNote);
        setOptionsNotice(Boolean(cached.payload?.stale || cached.payload?.unavailable) ? getSnapshotFallbackMessage(cached.payload) : "");
        if (cachedChain.length > 0) {
          setChain(cachedChain);
          setAvailableExpiries(Array.isArray(cached.payload?.expiries) ? cached.payload.expiries : []);
          if (!activeExpiry) {
            const nextExpiry = pickNearestExpiry(cached.payload?.expiries || [cached.payload?.expiry].filter(Boolean));
            if (nextExpiry != null) setActiveExpiry(nextExpiry);
          }
          const cachedIv = Number(cached?.payload?.market_metrics?.iv);
          const resolvedCachedIv = Number.isFinite(cachedIv) && cachedIv > 0 ? cachedIv : deriveIvFromChain(cachedChain) || 0;
          setMetrics({
            iv: resolvedCachedIv,
            pcr: Number(cached?.payload?.market_metrics?.p_c_ratio) || 0,
            skew: resolvedCachedIv > 0 ? "Live" : "Unavailable"
          });
          setOptionsStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
        }
      }
      setLoading(true);
      try {
        setOptionsError("");
        const res = await zeninFetch(`/options/crypto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          currency: activeAsset || "BTC",
          expiry: activeExpiry || null
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();

      if (!isMounted || controller.signal.aborted) return;
      const latestRequestKey = `${String(activeAsset || "").trim().toUpperCase()}:${activeExpiry || "latest"}`;
      if (latestRequestKey !== requestKey) return;

      if (data && data.chain) {
        setMarketStructure(data?.market_structure || inferredMarketStructure);
        setMarketStructureLabel(data?.market_structure_label || inferredMarketStructureLabel);
        setMarketStructureNote(data?.market_structure_note || inferredMarketStructureNote);
        setAvailableExpiries(Array.isArray(data.expiries) ? data.expiries : []);

        if (!activeExpiry) {
          const nextExpiry = pickNearestExpiry(data.expiries || [data.expiry].filter(Boolean));
          if (nextExpiry != null) setActiveExpiry(nextExpiry); // default nearest available expiry
        }

        setChain(data.chain);
        let resolvedSpot = null;
        const lyraSpot = Number(data?.market_price ?? data?.spot);
        if (Number.isFinite(lyraSpot) && lyraSpot > 0) {
          resolvedSpot = lyraSpot;
          setSpotPrices((prev) => ({
            ...prev,
            [activeAsset]: lyraSpot
          }));
          setSpotSources((prev) => ({ ...prev, [activeAsset]: "lyra" }));
        } else {
          const fallbackSpot = await getHyperliquidFallbackSpot(activeAsset);
          if (!isMounted) return;
          if (Number.isFinite(fallbackSpot) && fallbackSpot > 0) {
            resolvedSpot = fallbackSpot;
            setSpotPrices((prev) => ({
              ...prev,
              [activeAsset]: fallbackSpot
            }));
            setSpotSources((prev) => ({ ...prev, [activeAsset]: "hyperliquid" }));
          } else {
            setSpotSources((prev) => ({ ...prev, [activeAsset]: "unavailable" }));
          }
        }
        syncActiveTradeSnapshots(activeAsset, data.chain, resolvedSpot || Number(spotPrices?.[activeAsset]) || null);

        const chainIv = deriveIvFromChain(data.chain || []);
        const responseIv = Number(data?.market_metrics?.iv);
        const resolvedIv = Number.isFinite(responseIv) && responseIv > 0 ? responseIv : chainIv || 0;
        setMetrics({
          iv: resolvedIv,
          pcr: Number(data?.market_metrics?.p_c_ratio) || 0,
          skew: resolvedIv > 0 ? "Live" : "Unavailable"
        });
        setOptionsStale(Boolean(data?.stale || data?.unavailable));
        setOptionsNotice(Boolean(data?.stale || data?.unavailable) ? getSnapshotFallbackMessage(data) : "");
        writeResilientCache("options-chain", cacheParams, data);
        if (data.stale) {
          setOptionsError(`Using cached options data (${data.stale_age_seconds || 0}s old).`);
        } else {
          if (showToast && lastSyncToastRef.current !== requestKey) {
            showToast(`${activeAsset} options chain synchronized.`, "success");
            lastSyncToastRef.current = requestKey;
          }
        }
      } else {
        console.warn("Invalid options response:", data);
        setOptionsError("Options data is syncing.");
        setOptionsStale(true);
        setOptionsNotice("");
        setMarketStructure(inferredMarketStructure);
        setMarketStructureLabel(inferredMarketStructureLabel);
        setMarketStructureNote(inferredMarketStructureNote);
      }

    } catch (err) {
      if (controller.signal.aborted) return;
      console.warn("Options chain unavailable; simulator is using fallback pricing.", err);
      if (isMounted) {
        setOptionsError("");
        setOptionsStale(true);
        setOptionsNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "");
        setMarketStructure(inferredMarketStructure);
        setMarketStructureLabel(inferredMarketStructureLabel);
        setMarketStructureNote(inferredMarketStructureNote);
        const fallbackSpot = await getHyperliquidFallbackSpot(activeAsset);
        if (!isMounted) return;
        if (Number.isFinite(fallbackSpot) && fallbackSpot > 0) {
          setSpotPrices((prev) => ({
            ...prev,
            [activeAsset]: fallbackSpot
          }));
          setSpotSources((prev) => ({ ...prev, [activeAsset]: "hyperliquid" }));
        } else {
          setSpotSources((prev) => ({ ...prev, [activeAsset]: "unavailable" }));
        }
      }
    } finally {
      setLoading(false);
    }
  };

  fetchChain();

  // Refresh chain every 3 minutes while user is on the Options section.
  const interval = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    fetchChain();
  }, OPTIONS_CHAIN_REFRESH_MS);

  return () => {
    isMounted = false;
    controller.abort();
    clearInterval(interval);
  };

}, [activeAsset, activeExpiry]);

useEffect(() => {
  let isMounted = true;

  const fetchWhaleTrades = async () => {
    if (!isMounted) return;
    const cacheParams = { minNotional: whaleMinNotional, source: whaleSource };
    const cached = readResilientCache("options-whale-trades", cacheParams);
    if (cached?.payload && Array.isArray(cached.payload?.trades)) {
      setWhaleTrades(cached.payload.trades);
      setWhaleStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
      setWhaleMeta(cached.payload || {});
      setWhaleNotice(Boolean(cached.payload?.stale || cached.payload?.unavailable) ? getSnapshotFallbackMessage(cached.payload) : "");
    }
    setWhaleLoading(true);
    try {
      const params = new URLSearchParams({
        minNotional: String(whaleMinNotional),
        source: whaleSource
      });
      const res = await zeninFetch(`/options/whale-trades?${params.toString()}`);
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      if (!isMounted) return;
      let parsedTrades = Array.isArray(data?.trades) ? data.trades : [];
      if (whaleSource === "telegram") {
        parsedTrades.sort((a, b) => {
          if (!a.expiration && !b.expiration) return 0;
          if (!a.expiration) return 1;
          if (!b.expiration) return -1;
          return new Date(a.expiration).getTime() - new Date(b.expiration).getTime();
        });
      }
      setWhaleTrades(parsedTrades);
      setWhaleStale(Boolean(data?.stale || data?.unavailable));
      setWhaleMeta(data || {});
      setWhaleNotice(Boolean(data?.stale || data?.unavailable) ? getSnapshotFallbackMessage(data) : "");
      writeResilientCache("options-whale-trades", cacheParams, data || { trades: [] });
      setWhalePage(1);
    } catch (err) {
      if (!isMounted) return;
      setWhaleStale(true);
      setWhaleMeta((prev) => prev || {});
      setWhaleNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "");
    } finally {
      if (isMounted) setWhaleLoading(false);
    }
  };

  fetchWhaleTrades();
  const interval = setInterval(fetchWhaleTrades, 120000); // every 2 minutes

  return () => {
    isMounted = false;
    clearInterval(interval);
  };
}, [whaleMinNotional, whaleSource]);

  const whalePageSize = 10;
  const whaleTotalPages = Math.max(1, Math.ceil(whaleTrades.length / whalePageSize));
  const pagedWhaleTrades = whaleTrades.slice(
    (whalePage - 1) * whalePageSize,
    whalePage * whalePageSize
  );

  useEffect(() => {
    if (whalePage > whaleTotalPages) setWhalePage(whaleTotalPages);
  }, [whalePage, whaleTotalPages]);

  useEffect(() => {
    setWhalePage(1);
  }, [whaleMinNotional, whaleSource]);

  const formatDollar = (value) => {
    const n = Number(value || 0);
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
  };

  const formatGreek = (value, digits = 3) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : "-";
  };

  const formatIv = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? `${(n * 100).toFixed(1)}%` : "-";
  };

  const formatOptionPx = (value) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? `$${n.toFixed(4)}` : "-";
  };

  const formatDate = (ts) => {
    if (!ts) return "";
    return new Date(ts * 1000).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric'
    }).toUpperCase();
  };

  const whaleThresholdOptions = [
    { label: "Above $10K", value: 10000 },
    { label: "Above $100K", value: 100000 },
    { label: "Above $250K", value: 250000 },
    { label: "Above $500K", value: 500000 },
    { label: "Above $750K", value: 750000 },
    { label: "Above $1M", value: 1000000 }
  ];
  const whaleSourceOptions = [
    { label: "Derive", value: "derive" },
    { label: "Telegram", value: "telegram" }
  ];
  const telegramDebug = whaleMeta?.debug_telegram_ingest || null;
  const telegramChannels = Array.isArray(telegramDebug?.channels) ? telegramDebug.channels : [];
  const telegramSourceLabel = telegramChannels.length > 0 ? telegramChannels.map((channel) => `@${channel}`).join(", ") : "@derivetradetape";
  const telegramTransportLabel = telegramDebug?.transport === "public_html"
    ? "Public fallback"
    : telegramDebug?.transport === "mtproto"
      ? "MTProto"
      : null;
  const whaleEmptyStateText = whaleSource === "telegram"
    ? (() => {
        if (telegramDebug?.status === "disabled") {
          return "Telegram whale ingestion is disabled. Configure Telegram MTProto credentials on the backend to load channel trades.";
        }
        if (telegramDebug?.status === "error") {
          return telegramDebug?.error
            ? `Telegram whale ingestion failed: ${telegramDebug.error}`
            : "Telegram whale ingestion failed before any trades could be parsed.";
        }
        if (telegramDebug?.status === "empty" && Number(telegramDebug?.messageCount) > 0) {
          return `Parsed 0 whale trades from ${telegramDebug.messageCount} Telegram messages across ${telegramChannels.length || 1} channel${(telegramChannels.length || 1) === 1 ? "" : "s"}.`;
        }
        if (telegramDebug?.status === "partial") {
          return telegramDebug?.error
            ? `Telegram pulled some channels but others failed: ${telegramDebug.error}`
            : "Telegram whale ingestion returned a partial snapshot.";
        }
        return `Waiting for Telegram whale options trades from ${telegramSourceLabel}...`;
      })()
    : "Waiting for Derive whale options trades...";
  const activeUsesRfq = marketStructure === "rfq" || rfqAssets.has(String(activeAsset || "").trim().toUpperCase());
  const chainInventoryLabel = activeUsesRfq
    ? (chain.length > 0 ? `${chain.length} Ladder Strikes Cached` : "RFQ market")
    : `${chain.length} Strikes Available`;
  const emptyChainText = activeUsesRfq
    ? `${activeAsset} is currently exposed through ${marketStructureLabel} on Derive, so a full chain snapshot may be partial or unavailable here.`
    : `Waiting for options data for ${activeAsset}.`;

  const activeSpot = Number(spotPrices?.[activeAsset] || 0);
  const filteredChain = useMemo(() => {
    if (!Array.isArray(chain) || chain.length === 0) return [];
    if (!Number.isFinite(activeSpot) || activeSpot <= 0 || strikeWindow === "all") return chain;
    const bandPct = strikeWindow === "tight" ? 0.1 : strikeWindow === "medium" ? 0.2 : 0.35;
    return chain.filter((row) => {
      const strike = Number(row?.strike || 0);
      if (!Number.isFinite(strike) || strike <= 0) return false;
      return Math.abs(strike - activeSpot) / activeSpot <= bandPct;
    });
  }, [chain, strikeWindow, activeSpot]);

  const atmStrike = useMemo(() => {
    if (!filteredChain.length || !activeSpot) return null;
    let closest = filteredChain[0].strike;
    let minDiff = Math.abs(closest - activeSpot);
    for (const row of filteredChain) {
      const diff = Math.abs(row.strike - activeSpot);
      if (diff < minDiff) {
        minDiff = diff;
        closest = row.strike;
      }
    }
    return closest;
  }, [filteredChain, activeSpot]);

  const chainScrollRef = useRef(null);

  useEffect(() => {
    if (chainScrollRef.current && atmStrike) {
      const atmRow = chainScrollRef.current.querySelector('.atm-strike-row');
      if (atmRow) {
        const containerHeight = chainScrollRef.current.clientHeight;
        const rowTop = atmRow.offsetTop;
        const rowHeight = atmRow.clientHeight;
        chainScrollRef.current.scrollTop = rowTop - (containerHeight / 2) + (rowHeight / 2);
      }
    }
  }, [atmStrike, filteredChain]);

  const scrollToStrike = (strike) => {
    if (!strike) return;
    // If strike is hidden by window, reset to show all
    setStrikeWindow("all");
    
    // Use a small timeout to allow the window reset to render
    setTimeout(() => {
      if (chainScrollRef.current) {
        const rows = chainScrollRef.current.querySelectorAll('tr');
        for (const row of rows) {
          const strikeCell = row.querySelector('.strike-col span');
          if (strikeCell && strikeCell.textContent.replace(/,/g, '') === String(strike)) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            // Brief highlight
            row.style.transition = 'background-color 0.3s';
            row.style.backgroundColor = 'rgba(56, 189, 248, 0.25)';
            setTimeout(() => {
              row.style.backgroundColor = '';
            }, 1500);
            break;
          }
        }
      }
    }, 100);
  };

  const handleWhaleTradeClick = (trade) => {
    if (!trade) return;
    const symbol = String(trade.symbol || trade.asset || "").split('-')[0].toUpperCase();
    if (symbol && symbol !== activeAsset) {
      setActiveAsset(symbol);
    }
    
    // If the trade has an expiration, try to find a matching ts in availableExpiries
    if (trade.expiration) {
      const tradeExp = new Date(trade.expiration).getTime() / 1000;
      // Find closest timestamp in availableExpiries (within 24h)
      const match = (availableExpiries || []).find(ts => Math.abs(ts - tradeExp) < 86400);
      if (match) setActiveExpiry(match);
    }
  };

  const greekSummary = useMemo(() => {
    const totals = { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    const rows = Array.isArray(activeOptionsTrades) ? activeOptionsTrades : [];
    rows.forEach((trade) => {
      const calc = getInternalOptionPnL(trade);
      totals.delta += Number(calc?.delta || 0);
      totals.theta += Number(calc?.theta || 0);
      totals.gamma += Number(calc?.gamma || 0);
      totals.vega += Number(calc?.vega || 0);
      totals.rho += Number(calc?.rho || 0);
    });
    return totals;
  }, [activeOptionsTrades, multiChainCache, chain, spotPrices, activeAsset]);

  const marketGreekSummary = useMemo(() => {
    const rows = Array.isArray(filteredChain) && filteredChain.length > 0 ? filteredChain : chain;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
    }
    const centerSpot = Number(activeSpot) > 0 ? Number(activeSpot) : Number(rows[Math.floor(rows.length / 2)]?.strike || 0);
    const nearest = rows.reduce((best, row) => {
      if (!best) return row;
      const currentDist = Math.abs(Number(row?.strike || 0) - centerSpot);
      const bestDist = Math.abs(Number(best?.strike || 0) - centerSpot);
      return currentDist < bestDist ? row : best;
    }, null);
    
    // For "Market" greeks, we typically reference the ATM Call option as the benchmark
    const call = nearest?.call || {};
    const callDelta = Number(call?.delta);
    const callGamma = Number(call?.gamma);
    const callTheta = Number(call?.theta);
    const callVega = Number(call?.vega);

    return {
      delta: Number.isFinite(callDelta) ? callDelta : 0,
      gamma: Number.isFinite(callGamma) ? callGamma : 0,
      theta: Number.isFinite(callTheta) ? callTheta : 0,
      vega: Number.isFinite(callVega) ? callVega : 0,
      rho: 0
    };
  }, [filteredChain, chain, activeSpot]);

  const hasActiveTrades = Array.isArray(activeOptionsTrades) && activeOptionsTrades.length > 0;
  const hasPortfolioGreeks = Object.values(greekSummary).some((v) => Math.abs(Number(v) || 0) > 1e-6);
  const displayGreeks = hasActiveTrades && hasPortfolioGreeks ? greekSummary : marketGreekSummary;

  useEffect(() => {
    const expiries = (availableExpiries || []).slice(0, 6);
    if (!expiries.length) return;
    let cancelled = false;
    const run = async () => {
      for (const expiryTs of expiries) {
        const cacheKey = `${String(activeAsset || "").toUpperCase()}:${expiryTs}`;
        const state = termStructureFetchStateRef.current;
        const lastAt = Number(state.lastFetchedAt[cacheKey] || 0);
        if (state.inFlight.has(cacheKey) || Date.now() - lastAt < TERM_STRUCTURE_REFRESH_MS) continue;
        state.inFlight.add(cacheKey);
        state.lastFetchedAt[cacheKey] = Date.now();
        try {
          const res = await zeninFetch(`/options/crypto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currency: activeAsset, expiry: expiryTs })
          });
          if (!res.ok) continue;
          const payload = await res.json();
          if (cancelled) return;
          const iv = Number(payload?.market_metrics?.iv);
          const chainIv = deriveIvFromChain(payload?.chain || []);
          const resolvedIv = Number.isFinite(iv) && iv > 0 ? iv : chainIv;
          if (Number.isFinite(resolvedIv) && resolvedIv > 0) {
            setTermIvByExpiry((prev) => ({ ...prev, [String(expiryTs)]: Number(resolvedIv) }));
          }
        } catch {
          // silent fallback to available data
        } finally {
          state.inFlight.delete(cacheKey);
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [activeAsset, availableExpiries]);

  const termStructureRows = useMemo(() => {
    const liveBaseIv = Number(metrics?.iv);
    const expiries = Array.isArray(availableExpiries) ? availableExpiries : [];
    
    return expiries.map((expiryTs) => {
      const days = Math.max(1, Math.round((Number(expiryTs) * 1000 - Date.now()) / (24 * 60 * 60 * 1000)));
      const mappedIv = termIvByExpiry?.[String(expiryTs)];
      
      let impliedVol = 0;
      if (Number.isFinite(mappedIv) && mappedIv > 0) {
        impliedVol = mappedIv;
      } else if (Number.isFinite(liveBaseIv) && liveBaseIv > 0) {
        impliedVol = liveBaseIv;
      } else {
        // Fallback to a baseline IV if nothing else is available yet
        impliedVol = 0.60; 
      }

      return {
        expiryTs,
        days,
        impliedVol
      };
    }).sort((a, b) => a.days - b.days);
  }, [availableExpiries, metrics?.iv, termIvByExpiry]);

  const upcomingEarningsForAsset = useMemo(() => {
    const symbol = String(activeAsset || "").toUpperCase();
    return (earningsCalendar || []).filter((row) => String(row?.symbol || row?.ticker || "").toUpperCase() === symbol).slice(0, 2);
  }, [earningsCalendar, activeAsset]);

  const assignmentReminders = useMemo(() => {
    const now = Date.now();
    return (activeOptionsTrades || []).map((trade) => {
      const expiryRaw = trade?.legs?.[0]?.expiry;
      const expiryTs = Number.isFinite(Number(expiryRaw))
        ? Number(expiryRaw) * 1000
        : (expiryRaw ? new Date(expiryRaw).getTime() : 0);
      const hoursToExpiry = expiryTs > 0 ? Math.round((expiryTs - now) / (60 * 60 * 1000)) : null;
      const mark = Number(getInternalOptionPnL(trade)?.currentMark || 0);
      const entry = Number(trade?.netPremiumAtEntry || 0);
      return {
        id: trade.id,
        label: `${trade.asset} ${trade.strategy || "Options"}`,
        hoursToExpiry,
        inTheMoneyRisk: mark > entry && mark > 0
      };
    }).filter((row) => row.hoursToExpiry != null && row.hoursToExpiry <= 72);
  }, [activeOptionsTrades, multiChainCache, chain, spotPrices, activeAsset]);

  return (
    <div className="view-container options-terminal">
      <div className="portfolio-analytics-row">
        <div className="metric-card glass">
          <label>Implied Volatility <span className="live-pill">Live</span></label>
          <div className="value">{(metrics.iv * 100).toFixed(1)}%</div>
          <div className="change positive">▲ Real-time</div>
        </div>
        <div className="metric-card glass">
          <label>Put/Call Ratio</label>
          <div className="value">{metrics.pcr.toFixed(2)}</div>
          <div className="change negative">▼ 0.05</div>
        </div>
        <div className="metric-card glass">
          <label>Market Skew</label>
          <div className="value">{metrics.skew}</div>
          <div className="change positive">+14.2</div>
        </div>
      </div>

      {/* NEW: Active Options Trades Card */}
      {activeOptionsTrades && activeOptionsTrades.length > 0 && (
        <div ref={activeTradesRef} className="watchlist-panel glass" style={{ marginBottom: "16px", padding: "16px" }}>
          <div className="section-header">
            <h2>Active Options Trades</h2>
          </div>
          <div className="active-trades-table-container scrollbar-thin">
            <table className="active-trades-table">
              <thead>
                <tr>
                  <th>Strategy</th>
                  <th>Asset</th>
                  <th>Qty</th>
                  <th>Expiry</th>
                  <th>Entry Prem</th>
                  <th>Live Mark</th>
                  <th>Delta</th>
                  <th>Theta</th>
                  <th>Unrealized PnL</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {activeOptionsTrades.map(trade => {
                  const metrics = getInternalOptionPnL(trade);
                  const { currentMark, pnl, delta, theta, isStale } = metrics;
                  
                  const pnlColor = pnl >= 0 ? "#22c55e" : "#ef4444";
                  const formattedPnL = (pnl >= 0 ? "+" : "") + (pnl || 0).toFixed(2);
                  const isLong = String(trade.strategy || "").toLowerCase().includes("long") || 
                                 String(trade.strategy || "").toLowerCase().includes("bull");
                  
                  return (
                    <tr key={trade.id} className={isStale ? "stale-row" : ""}>
                      <td className="strategy-name">
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <span style={{ 
                            width: "4px", 
                            height: "14px", 
                            borderRadius: "2px", 
                            background: isLong ? "#22c55e" : "#ef4444" 
                          }}></span>
                          {trade.strategy}
                        </div>
                      </td>
                      <td className="active-trades-symbol">{trade.asset}</td>
                      <td>{trade.qty || trade.quantity || 1}</td>
                      <td style={{ fontSize: "11px", color: "var(--color-text-secondary, #94a3b8)" }}>
                        {trade.legs?.[0]?.expiry || "—"}
                      </td>
                      <td style={{ color: "var(--color-text-secondary, #94a3b8)" }}>
                        ${getTradeEntryPremium(trade).toFixed(2)}
                      </td>
                      <td style={{ fontWeight: 600, color: "var(--color-text-primary, #e2e8f0)" }}>
                        ${(currentMark || 0).toFixed(2)}
                      </td>
                      <td style={{ color: (delta || 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                        {(delta || 0).toFixed(2)}
                      </td>
                      <td style={{ color: (theta || 0) >= 0 ? "#22c55e" : "#ef4444" }}>
                        {(theta || 0).toFixed(2)}
                      </td>
                      <td className="active-trades-pnl" style={{ color: pnlColor }}>
                        {formattedPnL}
                      </td>
                      <td>
                        <button 
                          className="close-trade-btn"
                          onClick={() => closeOptionTrade(trade.id)}
                        >
                          Close
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <StrategySimulatorCard
        activeAsset={activeAsset}
        allAssets={allAssets}
        onChangeAsset={setActiveAsset}
        onStrategyChosen={handleStrategyChosen}
        chain={chain}
        spotPrices={spotPrices}
        showToast={showToast}
        loading={loading}
        availableExpiries={availableExpiries}
        error={simulatorError}
      />

      <div className="watchlist-panel glass" style={{ marginBottom: "16px" }}>
        <div className="section-header">
          <h2>Greeks & Volatility Context</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className="asset-count">Strike Window</span>
            <select
              value={strikeWindow}
              onChange={(e) => setStrikeWindow(e.target.value)}
              style={{ background: "var(--color-surface-panel, rgba(5,5,5,0.7))", color: "var(--color-text-primary, #e2e8f0)", border: "1px solid var(--color-border-subtle, rgba(148,163,184,0.25))", borderRadius: "8px", padding: "4px 8px", fontSize: "12px" }}
            >
              <option value="all">All Strikes</option>
              <option value="medium">ATM ±20%</option>
              <option value="tight">ATM ±10%</option>
              <option value="wide">ATM ±35%</option>
            </select>
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "8px", marginBottom: "10px" }}>
          {[
            { label: hasActiveTrades && hasPortfolioGreeks ? "Portfolio Delta" : "Market Delta (ATM)", value: displayGreeks.delta },
            { label: hasActiveTrades && hasPortfolioGreeks ? "Portfolio Theta" : "Market Theta (ATM)", value: displayGreeks.theta },
            { label: hasActiveTrades && hasPortfolioGreeks ? "Portfolio Gamma" : "Market Gamma (ATM)", value: displayGreeks.gamma },
            { label: hasActiveTrades && hasPortfolioGreeks ? "Portfolio Vega" : "Market Vega (ATM)", value: displayGreeks.vega },
            { label: "Implied Volatility", value: Number(metrics?.iv || 0) }
          ].map((item) => (
            <div key={item.label} className="journal-stat-card">
              <span className="journal-stat-label">{item.label}</span>
              <span className="journal-stat-value">
                {item.label === "Implied Volatility"
                  ? `${(Number(item.value || 0) * 100).toFixed(2)}%`
                  : Number(item.value || 0).toFixed(3)}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
          <div style={{ border: "1px solid rgba(148,163,184,0.14)", borderRadius: "10px", padding: "10px" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)", marginBottom: "6px" }}>IV / OI Heatmap (sample)</div>
            <div style={{ display: "grid", gap: "6px" }}>
              {filteredChain.slice(0, 8).map((row) => {
                const callIv = Number(row?.call?.iv || 0) * 100;
                const callOi = Number(row?.call?.openInterest || row?.call?.oi || 0);
                const intensity = Math.min(1, Math.max(0.08, (callIv / 120) + (callOi / 100000)));
                return (
                  <div 
                    key={`heat-${row.strike}`} 
                    onClick={() => scrollToStrike(row.strike)}
                    style={{ 
                      borderRadius: "6px", 
                      padding: "6px 8px", 
                      background: `rgba(56,189,248,${intensity.toFixed(2)})`, 
                      display: "flex", 
                      justifyContent: "space-between", 
                      fontSize: "12px",
                      cursor: "pointer",
                      transition: "transform 0.1s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <span>{Number(row.strike).toLocaleString()}</span>
                    <span>IV {callIv.toFixed(1)}% · OI {callOi.toLocaleString()}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div style={{ border: "1px solid rgba(148,163,184,0.14)", borderRadius: "10px", padding: "10px" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)", marginBottom: "6px" }}>Volatility Term Structure</div>
            <div style={{ display: "grid", gap: "6px" }}>
              {termStructureRows.slice(0, 8).map((row) => (
                  <div 
                    key={`term-${row.expiryTs}`} 
                    onClick={() => setActiveExpiry(row.expiryTs)}
                    style={{ 
                      display: "grid", 
                      gridTemplateColumns: "68px 1fr 48px", 
                      gap: "8px", 
                      alignItems: "center", 
                      fontSize: "12px",
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: "4px",
                      transition: "background 0.1s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(148,163,184,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                  <span style={{ color: activeExpiry === row.expiryTs ? "#38bdf8" : "inherit", fontWeight: activeExpiry === row.expiryTs ? "bold" : "normal" }}>{formatDate(row.expiryTs)}</span>
                  <div style={{ height: "8px", background: "var(--color-surface-elevated, rgba(5,5,5,0.8))", borderRadius: "999px", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, row.impliedVol * 100)}%`, height: "100%", background: activeExpiry === row.expiryTs ? "linear-gradient(90deg, #38bdf8, #60a5fa)" : "linear-gradient(90deg, #22c55e, #38bdf8)" }} />
                  </div>
                  <span style={{ color: activeExpiry === row.expiryTs ? "#38bdf8" : "inherit" }}>{(row.impliedVol * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {(upcomingEarningsForAsset.length > 0 || assignmentReminders.length > 0) ? (
        <div className="watchlist-panel glass" style={{ marginBottom: "16px" }}>
          <div className="section-header">
            <h2>Event Risk Warnings</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {upcomingEarningsForAsset.map((evt, idx) => (
              <div key={`earnwarn-${idx}`} style={{ border: "1px solid rgba(245,158,11,0.36)", borderRadius: "8px", padding: "8px 10px", color: "var(--options-warning-text, #fbbf24)", fontSize: "12px", background: "var(--options-warning-bg, rgba(120,53,15,0.2))" }}>
                Earnings volatility warning: {activeAsset} has earnings on {evt?.date || evt?.reportDate || "upcoming"}; avoid overlapping expiries unless intentional.
              </div>
            ))}
            {assignmentReminders.map((item) => (
              <div key={`assign-${item.id}`} style={{ border: "1px solid var(--color-border-subtle, rgba(148,163,184,0.22))", borderRadius: "8px", padding: "8px 10px", color: "var(--color-text-secondary, #cbd5e1)", fontSize: "12px", background: "var(--color-surface-panel, rgba(5,5,5,0.5))" }}>
                {item.label}: expires in {item.hoursToExpiry}h{item.inTheMoneyRisk ? " · Assignment risk elevated (ITM)." : ""}.
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="watchlist-panel glass">
        <div className="section-header">
          <div className="header-left">
            <h2>{activeAsset} Option Chain <span className="live-pill">Live</span></h2>
            <div className="options-market-context">
              <div className="asset-count">{chainInventoryLabel}</div>
              <span className={`options-market-structure-pill ${activeUsesRfq ? "rfq" : "orderbook"}`}>
                {marketStructureLabel}
              </span>
              <span className={`data-health-badge ${loading ? "loading" : optionsStale ? "hazard" : "ok"}`} title={loading ? "Refreshing options chain" : optionsStale ? "Showing previous options snapshot" : "Options chain is up to date"}>
                <span className={`status-icon ${loading ? "spinner" : ""}`}>{loading ? "⟳" : optionsStale ? "⚠" : "✓"}</span>
                Chain
              </span>
            </div>
          </div>
          
          <div className="asset-dropdown-container">
            <select 
              value={activeAsset}
              onChange={(e) => {
                const nextAsset = String(e.target.value || "").trim().toUpperCase();
                setActiveExpiry(null);
                setActiveAsset(nextAsset);
              }}
            >
              {allAssets.map(asset => (
                <option key={asset} value={asset}>{asset}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="expiry-tabs">
          {availableExpiries.map(ts => (
            <button 
              key={ts}
              className={`expiry-pill ${activeExpiry === ts ? "active" : ""}`}
              onClick={() => setActiveExpiry(ts)}
            >
              {formatDate(ts)}
            </button>
          ))}
        </div>
        {activeUsesRfq ? (
          <div className="options-rfq-banner">
            <strong>{activeAsset} uses {marketStructureLabel} mode on Derive.</strong>
            <span>{marketStructureNote || "Full strike ladders can be sparse, so use this as a reference panel rather than a guaranteed complete chain."}</span>
          </div>
        ) : null}

          {filteredChain.length === 0 && loading ? (
            <div className="loading-state">{activeUsesRfq ? `Syncing ${activeAsset} RFQ references...` : `Syncing ${activeAsset} with Lyra Protocol...`}</div>
          ) : filteredChain.length === 0 ? (
            <div className="loading-state">{emptyChainText}</div>
          ) : (
            <div className="table-scroll options-chain-scroll" style={{ maxHeight: "320px", overflowY: "auto", scrollBehavior: "smooth" }} ref={chainScrollRef}>
              <table className="option-chain-table">
                <thead>
                  <tr>
                    <th colSpan="4" className="chain-side-header">Calls</th>
                    <th className="strike-col chain-side-divider">Strike</th>
                    <th colSpan="4" className="chain-side-header">Puts</th>
                  </tr>
                  <tr>
                    <th>IV</th>
                    <th>Delta</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th className="strike-col">Strike</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>Delta</th>
                    <th>IV</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredChain.map((row) => {
                    const isAtm = row.strike === atmStrike;
                    return (
                    <tr key={row.strike} className={isAtm ? "atm-strike-row" : ""}>
                      <td className="greek">{formatIv(row.call?.iv)}</td>
                      <td className="greek">{formatGreek(row.call?.delta, 3)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.bid)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.ask)}</td>
                      <td className="strike-col" style={{ position: "relative" }}>
                        {isAtm ? (
                          <div style={{ position: "absolute", top: "-10px", left: "50%", transform: "translateX(-50%)", background: "#3b82f6", color: "#fff", padding: "1px 6px", borderRadius: "4px", fontSize: "10px", fontWeight: "bold", zIndex: 10, whiteSpace: "nowrap" }}>
                            {activeAsset} {activeSpot.toFixed(2)}
                          </div>
                        ) : null}
                        <span style={{ color: isAtm ? "#60a5fa" : "inherit", fontWeight: isAtm ? "bold" : "normal" }}>{Number(row.strike || 0).toLocaleString()}</span>
                      </td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.bid)}</td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.ask)}</td>
                      <td className="greek">{formatGreek(row.put?.delta, 3)}</td>
                      <td className="greek">{formatIv(row.put?.iv)}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
          {optionsError && (
            <div className="loading-state" style={{ marginTop: "8px", color: "#f59e0b" }}>
              {optionsError}
            </div>
          )}
          {optionsStale && optionsNotice ? (
            <div className="snapshot-inline-note">{optionsNotice}</div>
          ) : null}
      </div>

      <div className="watchlist-panel glass whale-trades-panel" style={{ marginTop: "16px", padding: "16px" }}>
        <div className="section-header" style={{ marginBottom: "10px" }}>
          <div className="header-left">
            <h2>Whale Options Trades <span className="live-pill">Live</span></h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div className="asset-count">BTC / ETH / SOL / HYPE</div>
              <span className={`data-health-badge ${whaleLoading ? "loading" : whaleStale ? "hazard" : "ok"}`} title={whaleLoading ? "Refreshing whale trades" : whaleStale ? "Showing previous whale-trades snapshot" : "Whale trades are up to date"}>
                <span className={`status-icon ${whaleLoading ? "spinner" : ""}`}>{whaleLoading ? "⟳" : whaleStale ? "⚠" : "✓"}</span>
                Whale Flow
              </span>
            </div>
          </div>
          <div className="whale-options-controls">
            <div className="search-type-buttons" style={{ marginLeft: 0 }}>
              <span className="search-type-button active" style={{ pointerEvents: 'none' }}>Telegram</span>
            </div>
            <div className="asset-dropdown-container">
              <select
                value={whaleMinNotional}
                onChange={(e) => setWhaleMinNotional(Number(e.target.value) || 10000)}
              >
                {whaleThresholdOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {whaleSource === "telegram" ? (
          <div style={{ marginBottom: "10px", fontSize: "12px", color: "#64748b" }}>
            Sources: {telegramSourceLabel}
            {telegramTransportLabel ? ` · Transport: ${telegramTransportLabel}` : ""}
            {telegramDebug?.status && telegramDebug.status !== "ok" ? ` · Status: ${telegramDebug.status}` : ""}
          </div>
        ) : null}
        {whaleStale && whaleNotice ? (
          <div className="snapshot-inline-note" style={{ marginBottom: "10px" }}>{whaleNotice}</div>
        ) : null}

        {whaleLoading && whaleTrades.length === 0 ? (
          <div className="loading-state">Loading whale options trades...</div>
        ) : pagedWhaleTrades.length === 0 ? (
          <div className="loading-state">{whaleEmptyStateText}</div>
        ) : (
          <div className="table-scroll">
            <table className="option-chain-table whale-trades-table">
              <thead>
                <tr>
                  <th>Symbol</th>
                  <th>Expiration</th>
                  <th>Reference Price</th>
                  <th>Strategy</th>
                  <th>Total Notional</th>
                </tr>
              </thead>
               <tbody>
                {pagedWhaleTrades.map((trade) => (
                  <tr 
                    key={trade.id} 
                    onClick={() => handleWhaleTradeClick(trade)}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = 'rgba(148,163,184,0.08)'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
                  >
                    <td className="greek">{trade.symbol}</td>
                    <td className="greek">{trade.expiration || "—"}</td>
                    <td className="bid-ask positive">{formatDollar(trade.referencePrice)}</td>
                    <td className="greek">{trade.strategy}</td>
                    <td className="bid-ask positive">{formatDollar(trade.totalNotional)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {whaleTotalPages > 1 && (
          <div className="pagination-controls" style={{ marginTop: "10px" }}>
            <button
              className="pagination-button"
              disabled={whalePage === 1}
              onClick={() => setWhalePage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <div className="pagination-label">
              Page {whalePage} of {whaleTotalPages}
            </div>
            <button
              className="pagination-button"
              disabled={whalePage === whaleTotalPages}
              onClick={() => setWhalePage((p) => Math.min(whaleTotalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>
      <OptionsCalculator
        spotPrice={spotPrices[activeAsset]}
        spotSource={spotSources[activeAsset]}
        assets={allAssets}
        chainData={chain}
        activeAsset={activeAsset}
        marketStructure={marketStructure}
        marketStructureLabel={marketStructureLabel}
        marketStructureNote={marketStructureNote}
        onAssetChange={setActiveAsset}
        activeExpiry={activeExpiry}
      />

    </div>
  );
}
