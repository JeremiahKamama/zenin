import { useState, useEffect } from "react";
import { OptionsCalculator } from "./OptionsCalculator";
import OptionsStrategySimulator from "./OptionsStrategySimulator";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const OPTIONS_CHAIN_REFRESH_MS = 180000; // 3 minutes
const SUPPORTED_OPTIONS_ASSETS = ["BTC", "ETH", "SOL", "HYPE"];
const RFQ_OPTIONS_ASSETS = new Set(["HYPE"]);

export function OptionsModule({activeOptionsTrades,
  setActiveOptionsTrades,
}) {
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [availableExpiries, setAvailableExpiries] = useState([]);
  const [spotPrices, setSpotPrices] = useState({});
  const [spotSources, setSpotSources] = useState({});
  const [activeExpiry, setActiveExpiry] = useState(null);
  const [allAssets, setAllAssets] = useState(SUPPORTED_OPTIONS_ASSETS);
  const [chain, setChain] = useState([]);
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
  
const [strategyTradeModal, setStrategyTradeModal] = useState(null);
// shape: { asset, strategy, probability, description }
const [strategyAmount, setStrategyAmount] = useState("");
const [strategySubmitting, setStrategySubmitting] = useState(false);
const [strategyError, setStrategyError] = useState("");


  const closeOptionTrade = (id) => {
    if (!setActiveOptionsTrades) return;
    setActiveOptionsTrades((prev) => prev.filter((t) => t.id !== id));
  };
  const calculateOptionPnL = (trade) => {
     // Here you would match trade.legs with the live `chain` data fetched from Derive
     // PnL = (Current Mark Price - netPremiumAtEntry) * Qty * Direction
     // For mock purposes, returning a static format:
     return { currentMark: 0.85, pnl: 0.15 };

  };


const handleStrategyChosen = (strategy) => {
  // `strategy` can include whatever OptionsStrategySimulator returns:
  // { name, probability, legs, notes, ... }
  setStrategyError("");
  setStrategyAmount("");
  setStrategyTradeModal({
    asset: activeAsset,
    strategy,
  });
};

const handleConfirmStrategyTrade = async () => {
  if (!strategyTradeModal) return;
  const notional = Number(strategyAmount);
  if (!Number.isFinite(notional) || notional <= 0) {
    setStrategyError("Enter a valid notional amount greater than zero.");
    return;
  }

  setStrategySubmitting(true);
  try {
    const base = strategyTradeModal.strategy;
    const id = `sim-${Date.now()}`;

    const newTrade = {
      id,
      asset: strategyTradeModal.asset,
      strategy: base.name || base.label || "Strategy",
      status: "OPEN",
      executedAt: new Date().toISOString(),
      legs: base.legs || [],
      netPremiumAtEntry: base.netPremiumAtEntry ?? 1.0,
      qty: base.qty ?? 1,
      totalNotional: notional,
    };

    // Push into active options trades
    setActiveOptionsTrades((prev) => [newTrade, ...(prev || [])]);

    // Optional: here you could POST to your backend /api/db/execute-strategy

    setStrategyTradeModal(null);
    setStrategyAmount("");
    setStrategyError("");
  } catch (err) {
    console.error("Failed to execute strategy", err);
    setStrategyError("Failed to execute strategy. Please try again.");
  } finally {
    setStrategySubmitting(false);
  }
};

// OptionsModule.jsx

const StrategySimulatorCard = ({
  activeAsset,
  allAssets,
  onChangeAsset,
  onStrategyChosen,
}) => {
  const assetOptions = Array.isArray(allAssets) && allAssets.length
    ? allAssets
    : ["BTC", "ETH", "SOL", "HYPE"];

  return (
    <div className="watchlist-panel glass strategy-simulator-panel">
      <div className="section-header">
        <div className="header-left">
          <h2>Strategy simulator</h2>
          <span className="asset-count">
            Generate option structures from BTC / ETH / SOL / HYPE flow.
          </span>
        </div>
        <div className="asset-dropdown-container">
          <label
            style={{
              fontSize: 11,
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

      {/* Scrollable strategy list */}
      <div className="strategy-simulator-list">
        <OptionsStrategySimulator
          underlying={activeAsset}
          maxVisible={5}
          onStrategyChosen={onStrategyChosen}
        />
      </div>
    </div>
  );
};

 useEffect(() => {
  setAllAssets(SUPPORTED_OPTIONS_ASSETS);
}, []);

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
      const res = await fetch(`${BACKEND_URL}/crypto-market`, { signal: controller.signal });
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
        const res = await fetch(`${BACKEND_URL}/options/crypto`, {
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
      const res = await fetch(`${BACKEND_URL}/options/whale-trades?${params.toString()}`);
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
    <div className="view-container options-terminal">
      {/* ... top metrics ... */}

      {/* NEW: Active Options Trades Card */}
      {activeOptionsTrades && activeOptionsTrades.length > 0 && (
        <div className="watchlist-panel glass" style={{ marginBottom: "16px", padding: "16px" }}>
          <div className="section-header">
            <h2>Active Options Trades</h2>
          </div>
          <table className="option-chain-table">
            <thead>
              <tr>
                <th>Strategy</th>
                <th>Asset</th>
                <th>Exp</th>
                <th>Entry Premium</th>
                <th>Live Mark (Derive)</th>
                <th>Delta</th>
                <th>Theta</th>
                <th>Unrealized PnL</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {activeOptionsTrades.map(trade => {
                const { currentMark, pnl } = calculateOptionPnL(trade);
                const isProfit = pnl >= 0;
                return (
                  <tr key={trade.id}>
                    <td>{trade.strategy}</td>
                    <td>{trade.asset}</td>
                    <td>{trade.legs.expiry}</td>
                    <td>${trade.netPremiumAtEntry.toFixed(4)}</td>
                    <td>${currentMark.toFixed(4)}</td>
                    <td className="greek">+0.15</td> {/* Map from live chain */}
                    <td className="greek">+$1.20</td> {/* Map from live chain */}
                    <td style={{ color: isProfit ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                      {isProfit ? "+" : ""}${pnl.toFixed(2)}
                    </td>
                    <td>
                      <button 
                        onClick={() => closeOptionTrade(trade.id)}
                        style={{ background: "rgba(239,68,68,0.2)", color: "#ef4444", border: "none", padding: "4px 8px", borderRadius: "4px", cursor: "pointer" }}
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
      )}
      <StrategySimulatorCard
        activeAsset={activeAsset}
        allAssets={allAssets}
        onChangeAsset={setActiveAsset}
        onStrategyChosen={handleStrategyChosen}
      />

      {/* ... Option Chain Panel ... */}
    </div>
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

    {strategyTradeModal && (
  <div
    className="connect-account-overlay"
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(15,23,42,0.85)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 50,
    }}
    onClick={() => !strategySubmitting && setStrategyTradeModal(null)}
  >
    <div
      className="connect-account-window"
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 420,
        maxWidth: "90vw",
        background: "rgba(15,23,42,0.98)",
        borderRadius: 16,
        border: "1px solid rgba(51,65,85,0.8)",
        padding: 20,
        color: "#e2e8f0",
      }}
    >
      <div
        className="settings-window-header"
        style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 600 }}>
          Execute Strategy
        </h2>
        <button
          onClick={() => !strategySubmitting && setStrategyTradeModal(null)}
          style={{
            border: "none",
            background: "transparent",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: 18,
          }}
        >
          ×
        </button>
      </div>

      <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 12 }}>
        {strategyTradeModal.strategy.name || "Selected strategy"} on{" "}
        <strong>{strategyTradeModal.asset}</strong>.
      </p>

      <label
        className="settings-field"
        style={{ display: "block", marginBottom: 12, fontSize: 13 }}
      >
        <span style={{ display: "block", marginBottom: 4, color: "#cbd5e1" }}>
          Notional amount (USD)
        </span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={strategyAmount}
          onChange={(e) => setStrategyAmount(e.target.value)}
          style={{
            width: "100%",
            background: "#020617",
            borderRadius: 8,
            border: "1px solid rgba(51,65,85,0.9)",
            padding: "8px 10px",
            color: "#e2e8f0",
            fontSize: 13,
          }}
          placeholder="e.g. 1000"
        />
      </label>

      {strategyError && (
        <p
          style={{
            color: "#f97373",
            fontSize: 12,
            marginBottom: 8,
          }}
        >
          {strategyError}
        </p>
      )}

      <div
        className="settings-inline-actions"
        style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}
      >
        <button
          className="settings-secondary-btn"
          onClick={() => !strategySubmitting && setStrategyTradeModal(null)}
          style={{
            borderRadius: 8,
            border: "1px solid rgba(51,65,85,0.8)",
            background: "transparent",
            color: "#cbd5e1",
            padding: "6px 10px",
            fontSize: 13,
            cursor: "pointer",
          }}
          disabled={strategySubmitting}
        >
          Cancel
        </button>
        <button
          className="settings-primary-btn"
          onClick={handleConfirmStrategyTrade}
          disabled={strategySubmitting}
          style={{
            borderRadius: 8,
            border: "none",
            background: "#22c55e",
            color: "#020617",
            padding: "6px 14px",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            opacity: strategySubmitting ? 0.8 : 1,
          }}
        >
          {strategySubmitting ? "Placing…" : "Execute Trade"}
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}
