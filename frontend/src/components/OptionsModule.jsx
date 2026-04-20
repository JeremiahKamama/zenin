import { useState, useEffect, useRef } from "react";
import { OptionsCalculator } from "./OptionsCalculator";
import OptionsStrategySimulator from "./OptionsStrategySimulator";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
import { zeninFetch } from "../utils/zeninFetch";


const OPTIONS_CHAIN_REFRESH_MS = 300000; // 5 minutes
const SUPPORTED_OPTIONS_ASSETS = ["BTC", "ETH", "SOL", "HYPE"];
const RFQ_OPTIONS_ASSETS = new Set(["HYPE"]);

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
  const assetOptions = Array.isArray(allAssets) && allAssets.length
    ? allAssets
    : ["BTC", "ETH", "SOL", "HYPE"];

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
              color: "#94a3b8",
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
  const activeTradesRef = useRef(null);
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [availableExpiries, setAvailableExpiries] = useState([]);
  const [spotPrices, setSpotPrices] = useState(externalSpotPrices);
  const [spotSources, setSpotSources] = useState({});
  const [activeExpiry, setActiveExpiry] = useState(null);
  const [allAssets, setAllAssets] = useState(SUPPORTED_OPTIONS_ASSETS);
  const [chain, setChain] = useState([]);
  const [multiChainCache, setMultiChainCache] = useState({}); // symbol -> chain
  const [metrics, setMetrics] = useState({ iv: 0.245, pcr: 0.82, skew: "Bullish" });
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
  const [whaleSource, setWhaleSource] = useState("derive");
  const lastSyncToastRef = useRef(null); // Ref to track the last toasted request key
  const [simulatorError, setSimulatorError] = useState("");
  
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
  const calculateOptionPnL = (trade) => {
    const tradeChain = multiChainCache[trade.asset] || (trade.asset === activeAsset ? chain : null);
    const tradeSpot = spotPrices[trade.asset] || (trade.asset === activeAsset ? spotPrices[activeAsset] : null);
    
    const isAssetStale = !tradeChain || tradeChain.length === 0 || !tradeSpot;
    
    // Default to stored entry values if live data isn't currently loaded for this asset
    const result = {
      currentMark: isAssetStale ? trade.netPremiumAtEntry : 0,
      pnl: isAssetStale ? 0 : null,
      delta: isAssetStale ? (trade.initialDelta || 0) : 0,
      theta: isAssetStale ? (trade.initialTheta || 0) : 0,
      isStale: isAssetStale
    };

    if (isAssetStale) return result;

    let totalMark = 0;
    let totalDelta = 0;
    let totalTheta = 0;

    (trade.legs || []).forEach(leg => {
      if (leg.type === 'spot') {
        const spot = tradeSpot || leg.strike || 0;
        totalMark += leg.side === 'long' ? spot : -spot;
        totalDelta += leg.side === 'long' ? 1 : -1;
      } else {
        const row = tradeChain.find(r => Math.abs(r.strike - leg.strike) < 0.01);
        if (row) {
          const instr = leg.type === 'call' ? row.call : row.put;
          if (instr) {
            const mark = (Number(instr.bid || 0) + Number(instr.ask || 0)) / 2 || Number(instr.mark) || 0;
            const delta = Number(instr.delta) || 0;
            const theta = Number(instr.theta) || 0;
            
            if (leg.side === 'long') {
              totalMark += mark;
              totalDelta += delta;
              totalTheta += theta;
            } else {
              totalMark -= mark;
              totalDelta -= delta;
              totalTheta -= theta;
            }
          }
        }
      }
    });

    result.currentMark = totalMark;
    result.delta = totalDelta;
    result.theta = totalTheta;
    result.pnl = (totalMark - (trade.netPremiumAtEntry || 0)) * (trade.qty || 1);
    result.isStale = false;
    return result;
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
  setAllAssets(SUPPORTED_OPTIONS_ASSETS);
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
    
    assetsWithTrades.forEach(asset => {
      // If not in cache and not the active asset
      if (!multiChainCache[asset] && asset !== activeAsset) {
        zeninFetch(`/options/crypto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency: asset })
        })
          .then(res => res.json())
          .then(data => {
            if (data && data.chain) {
              setMultiChainCache(prev => ({ ...prev, [asset]: data.chain }));
            }
          })
          .catch(err => console.error(`Failed to fetch supplementary chain for ${asset}`, err));
      }
    });

    // Also sync multiChainCache with the current active chain
    if (chain && chain.length > 0) {
       setMultiChainCache(prev => ({ ...prev, [activeAsset]: chain }));
    }

    // NEW: Also ensure we have spot prices for these assets
    assetsWithTrades.forEach(asset => {
      if (!spotPrices[asset]) {
        zeninFetch(`/prices?type=crypto&symbols=${asset}`)
          .then(res => res.json())
          .then(data => {
             const price = Number(data?.prices?.[asset]?.price);
             if (price) {
               setSpotPrices(prev => ({ ...prev, [asset]: price }));
             }
          })
          .catch(err => console.error(`Failed to fetch spot price for ${asset}`, err));
      }
    });
  }, [activeOptionsTrades, activeAsset, chain]);

  useEffect(() => {
    setActiveExpiry(null); // Reset expiry when asset changes
  }, [activeAsset]);

useEffect(() => {
  let isMounted = true; // prevent state update after unmount
  const controller = new AbortController();
  const requestKey = `${String(activeAsset || "").trim().toUpperCase()}:${activeExpiry || "latest"}`;
  const inferredMarketStructure = RFQ_OPTIONS_ASSETS.has(String(activeAsset || "").trim().toUpperCase()) ? "rfq" : "orderbook";
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
          if (!activeExpiry && cached.payload?.expiry) setActiveExpiry(cached.payload.expiry);
          setMetrics(cached.payload?.market_metrics ? {
            iv: parseFloat(cached.payload.market_metrics?.iv) || 0.42,
            pcr: cached.payload.market_metrics?.p_c_ratio || 0.85,
            skew: "Volatile"
          } : { iv: 0.42, pcr: 0.85, skew: "Volatile" });
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

        if (!activeExpiry && data.expiry) {
          setActiveExpiry(data.expiry); // 🔥 prevents flicker + duplicate fetch
        }

        setChain(data.chain);
        const lyraSpot = Number(data?.market_price ?? data?.spot);
        if (Number.isFinite(lyraSpot) && lyraSpot > 0) {
          setSpotPrices((prev) => ({
            ...prev,
            [activeAsset]: lyraSpot
          }));
          setSpotSources((prev) => ({ ...prev, [activeAsset]: "lyra" }));
        } else {
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

        setMetrics({
          iv: parseFloat(data?.market_metrics?.iv) || 0.42,
          pcr: data?.market_metrics?.p_c_ratio || 0.85,
          skew: "Volatile"
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
      console.error("Error fetching crypto options:", err);
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
  const activeUsesRfq = marketStructure === "rfq" || RFQ_OPTIONS_ASSETS.has(String(activeAsset || "").trim().toUpperCase());
  const chainInventoryLabel = activeUsesRfq
    ? (chain.length > 0 ? `${chain.length} Ladder Strikes Cached` : "RFQ market")
    : `${chain.length} Strikes Available`;
  const emptyChainText = activeUsesRfq
    ? `${activeAsset} is currently exposed through ${marketStructureLabel} on Derive, so a full chain snapshot may be partial or unavailable here.`
    : `Waiting for options data for ${activeAsset}.`;

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
                  const metrics = calculateOptionPnL(trade);
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
                      <td>{trade.notional || 1}</td>
                      <td style={{ fontSize: "11px", color: "#94a3b8" }}>
                        {trade.legs?.[0]?.expiry || "—"}
                      </td>
                      <td style={{ color: "#94a3b8" }}>
                        ${(trade.netPremiumAtEntry || 0).toFixed(2)}
                      </td>
                      <td style={{ fontWeight: 600, color: "#e2e8f0" }}>
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

          {chain.length === 0 && loading ? (
            <div className="loading-state">{activeUsesRfq ? `Syncing ${activeAsset} RFQ references...` : `Syncing ${activeAsset} with Lyra Protocol...`}</div>
          ) : chain.length === 0 ? (
            <div className="loading-state">{emptyChainText}</div>
          ) : (
            <div className="table-scroll options-chain-scroll" style={{ maxHeight: "320px", overflowY: "auto" }}>
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
                  {chain.map((row) => (
                    <tr key={row.strike}>
                      <td className="greek">{formatIv(row.call?.iv)}</td>
                      <td className="greek">{formatGreek(row.call?.delta, 3)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.bid)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.ask)}</td>
                      <td className="strike-col">{Number(row.strike || 0).toLocaleString()}</td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.bid)}</td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.ask)}</td>
                      <td className="greek">{formatGreek(row.put?.delta, 3)}</td>
                      <td className="greek">{formatIv(row.put?.iv)}</td>
                    </tr>
                  ))}
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
              {whaleSourceOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`search-type-button ${whaleSource === opt.value ? "active" : ""}`}
                  onClick={() => setWhaleSource(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
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
                  <tr key={trade.id}>
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
