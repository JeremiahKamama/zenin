import { useState, useEffect, useMemo, useRef } from "react";
import { DataHealthBadge } from "@/components/ui/async-state";
import { DataTable } from "./data-table/DataTable";
import { OptionsCalculator } from "./OptionsCalculator";
import OptionsStrategySimulator from "./OptionsStrategySimulator";
import { OptionsInstitutionalPanel } from "./InstitutionalPanels";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { zeninFetchJson } from "../utils/zeninFetch";
import { canUseWebSocket, resolveZeninWsUrl } from "../utils/livePriceStream";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { GuidedEmptyState } from "./CompactWorkspaceUI";
import { recomputeGreeks } from "../utils/optionGreeks";
import { EquityOptionsDesk } from "./EquityOptionsDesk";
const OPTIONS_CHAIN_REFRESH_MS = 180000; // 3 minutes
const CRYPTO_CHAIN_REFRESH_MS = 20000; // 20 seconds — accelerated crypto poll (O6)
const TERM_STRUCTURE_REFRESH_MS = 15 * 60 * 1000;
const OPTIONS_SAVED_VIEWS_KEY = "zenin_options_saved_views";
const OPTIONS_MARKET_MODE_KEY = "zenin_options_market_mode_v1";
const EQUITY_OPTIONS_DEFAULT_UNDERLYINGS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "AMZN", "META", "TSLA"];

function readStoredOptionViews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OPTIONS_SAVED_VIEWS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatSavedTimestamp(value) {
  if (!value) return "Saved recently";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Saved recently";
  return parsed.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readStoredOptionsMarketMode() {
  try {
    const stored = String(localStorage.getItem(OPTIONS_MARKET_MODE_KEY) || "").trim().toLowerCase();
    return stored === "equity" ? "equity" : "crypto";
  } catch {
    return "crypto";
  }
}

function getEquityOptionsNotice(payload, fallback = "") {
  const message = getSnapshotFallbackMessage(payload, fallback);
  if (message) return message;
  if (payload?.expiryFallback && payload?.requestedExpiry && payload?.activeExpiry) {
    return `${payload.requestedExpiry} is not available; showing ${payload.activeExpiry} instead.`;
  }
  if (payload?.unavailable) {
    return "Equity options data is temporarily unavailable. Retry the snapshot or choose another supported underlying.";
  }
  if (payload?.stale) {
    return "Showing the last saved equity options snapshot while the live feed recovers.";
  }
  return "";
}

function toFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function mergeEquityOptionsContractWithLive(contract = {}, liveQuote = null, liveTrade = null) {
  const next = { ...contract };
  if (liveQuote) {
    const bid = toFiniteNumber(liveQuote.bid, contract.bid);
    const ask = toFiniteNumber(liveQuote.ask, contract.ask);
    next.bid = bid;
    next.ask = ask;
    next.bidSize = toFiniteNumber(liveQuote.bidSize, contract.bidSize);
    next.askSize = toFiniteNumber(liveQuote.askSize, contract.askSize);
    next.bidExchangeId = toFiniteNumber(liveQuote.bidExchangeId, contract.bidExchangeId);
    next.askExchangeId = toFiniteNumber(liveQuote.askExchangeId, contract.askExchangeId);
    next.mid = bid != null && ask != null ? Number(((bid + ask) / 2).toFixed(4)) : toFiniteNumber(liveQuote.mid, contract.mid);
    next.spread = bid != null && ask != null ? Number((ask - bid).toFixed(4)) : toFiniteNumber(liveQuote.spread, contract.spread);
    next.venueLabel = liveQuote.venueLabel || contract.venueLabel || null;
    next.updatedAt = liveQuote.updatedAt || contract.updatedAt || null;
  }
  if (liveTrade) {
    next.lastTradePrice = toFiniteNumber(liveTrade.lastTradePrice, contract.lastTradePrice);
    next.lastTradeSize = toFiniteNumber(liveTrade.lastTradeSize, contract.lastTradeSize);
    next.tradeExchangeId = toFiniteNumber(liveTrade.tradeExchangeId, contract.tradeExchangeId);
    next.lastTradeAt = liveTrade.lastTradeAt || contract.lastTradeAt || null;
    next.updatedAt = liveTrade.updatedAt || next.updatedAt || contract.updatedAt || null;
    if (!Number.isFinite(Number(next.mid)) && Number.isFinite(Number(next.lastTradePrice))) {
      next.mid = Number(next.lastTradePrice);
    }
    if (liveTrade.venueLabel) {
      next.venueLabel = liveTrade.venueLabel;
    }
  }
  return next;
}

function mergeEquityOptionsChainWithLiveUpdate(prevData, payload = {}) {
  if (!prevData || !Array.isArray(prevData.chain) || !prevData.chain.length) return prevData;
  const quotes = payload?.quotes && typeof payload.quotes === "object" ? payload.quotes : {};
  const trades = payload?.trades && typeof payload.trades === "object" ? payload.trades : {};
  // O3 — live greeks recompute: use the freshest spot (WS payload -> chain summary)
  // and each contract's strike/IV/expiry to recompute BS greeks on every tick.
  const liveSpot = Number(payload?.spotPrice || prevData?.summary?.spotPrice) || null;
  const riskFreeRate = Number(payload?.riskFreeRate || prevData?.summary?.riskFreeRate || 0.0425) || 0.0425;
  let changed = false;
  const nextChain = prevData.chain.map((row) => {
    let nextRow = row;
    const callTicker = row?.call?.contractTicker;
    const putTicker = row?.put?.contractTicker;
    const callLive = callTicker ? (quotes[callTicker] || trades[callTicker]) : null;
    const putLive = putTicker ? (quotes[putTicker] || trades[putTicker]) : null;
    if (callTicker && callLive) {
      nextRow = nextRow === row ? { ...row } : nextRow;
      nextRow.call = mergeEquityOptionsContractWithLive(row.call, quotes[callTicker], trades[callTicker]);
      if (liveSpot) {
        const g = recomputeGreeks({
          strike: row.strike,
          optionType: "call",
          spotPrice: liveSpot,
          impliedVolatility: nextRow.call.impliedVolatility ?? row.call.impliedVolatility,
          expiry: row.expiry,
          riskFreeRate,
        });
        nextRow.call = { ...nextRow.call, ...g, greeksRecomputedAt: payload?.updatedAt || null };
      }
      changed = true;
    }
    if (putTicker && putLive) {
      nextRow = nextRow === row ? { ...row } : nextRow;
      nextRow.put = mergeEquityOptionsContractWithLive(row.put, quotes[putTicker], trades[putTicker]);
      if (liveSpot) {
        const g = recomputeGreeks({
          strike: row.strike,
          optionType: "put",
          spotPrice: liveSpot,
          impliedVolatility: nextRow.put.impliedVolatility ?? row.put.impliedVolatility,
          expiry: row.expiry,
          riskFreeRate,
        });
        nextRow.put = { ...nextRow.put, ...g, greeksRecomputedAt: payload?.updatedAt || null };
      }
      changed = true;
    }
    return nextRow;
  });
  if (!changed) return prevData;
  return {
    ...prevData,
    summary: liveSpot ? { ...prevData.summary, spotPrice: liveSpot } : prevData.summary,
    chain: nextChain,
    updatedAt: payload?.updatedAt || prevData.updatedAt
  };
}

function buildEquityOptionsLiveTapeEntries(payload = {}) {
  const quoteRows = Object.values(payload?.quotes || {}).map((row) => ({
    id: `quote:${row.contractTicker}:${row.updatedAt}:${row.bid ?? "na"}:${row.ask ?? "na"}`,
    kind: "quote",
    contractTicker: row.contractTicker,
    venue: row.venueLabel || "Composite",
    updatedAt: row.updatedAt,
    summary: [row.bid != null ? `Bid $${Number(row.bid).toFixed(2)}` : null, row.ask != null ? `Ask $${Number(row.ask).toFixed(2)}` : null]
      .filter(Boolean)
      .join(" · ")
  }));
  const tradeRows = Object.values(payload?.trades || {}).map((row) => ({
    id: `trade:${row.contractTicker}:${row.lastTradeAt || row.updatedAt}:${row.lastTradePrice ?? "na"}:${row.lastTradeSize ?? "na"}`,
    kind: "trade",
    contractTicker: row.contractTicker,
    venue: row.venueLabel || "Composite",
    updatedAt: row.lastTradeAt || row.updatedAt,
    summary: [row.lastTradePrice != null ? `$${Number(row.lastTradePrice).toFixed(2)}` : null, row.lastTradeSize != null ? `x ${Number(row.lastTradeSize).toLocaleString()}` : null]
      .filter(Boolean)
      .join(" ")
  }));
  return [...tradeRows, ...quoteRows]
    .filter((row) => row.contractTicker && row.updatedAt)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

function mergeEquityOptionsLiveTape(previousRows = [], nextRows = []) {
  const merged = new Map();
  [...nextRows, ...previousRows].forEach((row) => {
    if (!row?.id || merged.has(row.id)) return;
    merged.set(row.id, row);
  });
  return [...merged.values()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 18);
}

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
  error = "",
}) => {
  const supportedAssets = Array.isArray(getAppRuntimeConfig()?.options?.supportedAssets)
    ? getAppRuntimeConfig().options.supportedAssets
    : ["BTC", "ETH", "SOL", "HYPE"];
  const assetOptions = Array.isArray(allAssets) && allAssets.length
    ? allAssets
    : supportedAssets;

  return (
    <div className="watchlist-panel glass strategy-simulator-panel options-exec-panel options-exec-strategy-panel">
      <div className="section-header options-exec-panel-head">
        <div className="header-left">
          <h2>Scenario Simulator for {activeAsset}</h2>
          <span className="asset-count">
            Express your view and save a research scenario from {activeAsset} flow.
          </span>
        </div>
        <div className="asset-dropdown-container">
          <label
            style={{
              fontSize: "0.75rem",
              textTransform: "uppercase",
              color: "var(--color-text-secondary)",
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
        {error ? (
          <GuidedEmptyState
            eyebrow="Scenario review"
            title="Scenario needs attention"
            description={error}
            steps={[
              "Reduce notional or adjust sizing before retrying.",
              "Keep the chain synced so entry pricing reflects the latest market marks.",
            ]}
            cta="Retry after review"
            onAction={() => showToast?.("Review size, balance, and chain pricing before retrying.", "info")}
            tone="warning"
            className="guided-empty-state--compact"
          />
        ) : null}
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
  const equityUnderlyings = Array.isArray(getAppRuntimeConfig()?.options?.equitySupportedAssets)
    ? getAppRuntimeConfig().options.equitySupportedAssets
    : EQUITY_OPTIONS_DEFAULT_UNDERLYINGS;
  const rfqAssets = new Set(
    Array.isArray(getAppRuntimeConfig()?.options?.rfqAssets)
      ? getAppRuntimeConfig().options.rfqAssets.map((asset) => String(asset || "").trim().toUpperCase())
      : ["HYPE"]
  );
  const activeTradesRef = useRef(null);
  const [optionsMarketMode, setOptionsMarketMode] = useState(() => readStoredOptionsMarketMode());
  const [activeAsset, setActiveAsset] = useState("BTC");
  const [equityUnderlying, setEquityUnderlying] = useState(equityUnderlyings[0] || "SPY");
  const [equityExpiry, setEquityExpiry] = useState(null);
  const [equityOptionsData, setEquityOptionsData] = useState(null);
  const [equityOptionsLoading, setEquityOptionsLoading] = useState(false);
  const [equityOptionsError, setEquityOptionsError] = useState("");
  const [equityOptionsNotice, setEquityOptionsNotice] = useState("");
  const [equityOptionsLiveTape, setEquityOptionsLiveTape] = useState([]);
  const [equityOptionsLiveConnected, setEquityOptionsLiveConnected] = useState(false);
  const [equityOptionsLiveUpdatedAt, setEquityOptionsLiveUpdatedAt] = useState("");
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
  const [chainRefreshTick, setChainRefreshTick] = useState(0);
  const [whaleRefreshTick, setWhaleRefreshTick] = useState(0);
  const lastSyncToastRef = useRef(null); // Ref to track the last toasted request key
  const [simulatorError, setSimulatorError] = useState("");
  const [strikeWindow, setStrikeWindow] = useState("all");
  const [earningsCalendar, setEarningsCalendar] = useState([]);
  const [showSavedItemsDrawer, setShowSavedItemsDrawer] = useState(false);
  const [savedOptionViews, setSavedOptionViews] = useState(() => readStoredOptionViews());
  const [termIvByExpiry, setTermIvByExpiry] = useState({});
  const equityOptionsSocketRef = useRef(null);
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

    // Research desk mode: never place or simulate an executable order.
    const totalCost = (entryPremium || 0) * (tradePayload.qty || 1);
    if (balance <= 0) {
      setSimulatorError("Scenario blocked: available balance is zero or negative.");
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

    setActiveOptionsTrades((prev) => [newTrade, ...(prev || [])]);
    showToast?.(`Saved ${newTrade.strategy} scenario on ${newTrade.asset}.`, "success");

    // Smooth scroll to the saved scenarios card
    setTimeout(() => {
      activeTradesRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 100);

  } catch (err) {
    console.error("Failed to save strategy scenario", err);
    const errorMsg = err.message || "Strategy scenario failed.";
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
  const normalizedAssets = Array.from(
    new Set(
      (Array.isArray(supportedAssets) ? supportedAssets : ["BTC", "ETH", "SOL", "HYPE"])
        .map((asset) => String(asset || "").trim().toUpperCase())
        .filter(Boolean)
    )
  );
  setAllAssets(normalizedAssets);
  setActiveAsset((current) => {
    const normalizedCurrent = String(current || "").trim().toUpperCase();
    if (normalizedAssets.includes(normalizedCurrent)) return normalizedCurrent;
    return normalizedAssets[0] || "BTC";
  });
}, [supportedAssets]);

useEffect(() => {
  let cancelled = false;
  const loadEarnings = async () => {
    try {
      const payload = await zeninFetchJson(`/earnings-calendar`);
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

  // Fetch chains for all saved scenario assets
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
        zeninFetchJson(`/options/crypto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ currency: symbol })
        })
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
      zeninFetchJson(`/prices?type=crypto&symbols=${symbol}`)
          .then(data => {
             const price = Number(data?.prices?.[symbol]?.price);
             if (price) {
               setSpotPrices(prev => ({ ...prev, [symbol]: price }));
             }
          })
          .catch(err => console.warn(`Spot price unavailable for ${symbol}; leaving source-backed pricing unavailable.`, err))
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

  const fetchHyperliquidSpot = async (assetSymbol) => {
    try {
      const data = await zeninFetchJson(`/crypto-market`, { signal: controller.signal });
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
        const data = await zeninFetchJson(`/options/crypto`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            currency: activeAsset || "BTC",
            expiry: activeExpiry || null
          })
        });

      if (!isMounted || controller.signal.aborted) return;
      const latestRequestKey = `${String(activeAsset || "").trim().toUpperCase()}:${activeExpiry || "latest"}`;
      if (latestRequestKey !== requestKey) return;

      if (data && data.chain) {
        const responseExpiries = Array.isArray(data.expiries) ? data.expiries : [];
        const nextNearestExpiry = pickNearestExpiry(responseExpiries);
        setMarketStructure(data?.market_structure || inferredMarketStructure);
        setMarketStructureLabel(data?.market_structure_label || inferredMarketStructureLabel);
        setMarketStructureNote(data?.market_structure_note || inferredMarketStructureNote);
        setAvailableExpiries(responseExpiries);

        if (!activeExpiry) {
          const nextExpiry = pickNearestExpiry(responseExpiries || [data.expiry].filter(Boolean));
          if (nextExpiry != null) setActiveExpiry(nextExpiry); // default nearest available expiry
        } else if (responseExpiries.length > 0 && !responseExpiries.includes(activeExpiry) && nextNearestExpiry != null) {
          setActiveExpiry(nextNearestExpiry);
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
          const hyperliquidSpot = await fetchHyperliquidSpot(activeAsset);
          if (!isMounted) return;
          if (Number.isFinite(hyperliquidSpot) && hyperliquidSpot > 0) {
            resolvedSpot = hyperliquidSpot;
            setSpotPrices((prev) => ({
              ...prev,
              [activeAsset]: hyperliquidSpot
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
        if (!Array.isArray(data.chain) || data.chain.length === 0) {
          const noListedExpiries = responseExpiries.length === 0;
          const expiryAdjusted = Boolean(activeExpiry && responseExpiries.length > 0 && !responseExpiries.includes(activeExpiry));
          const supportedUniverse = Array.isArray(data?.supported_assets) && data.supported_assets.length
            ? data.supported_assets.join(", ")
            : allAssets.join(", ");
          setOptionsError(
            data?.unsupported
              ? `${activeAsset} is not enabled for the live options ladder here. Supported live underlyings: ${supportedUniverse}.`
              : activeUsesRfq
              ? `${activeAsset} is currently being quoted through ${marketStructureLabel} on Derive, so only partial ladder references may be available right now.`
              : noListedExpiries
                ? `Derive returned no live ${activeAsset} option ladder right now. Try another supported underlying or refresh once the venue republishes strikes.`
                : expiryAdjusted
                  ? `The selected expiry no longer had live rows. Zenin moved you to the nearest available ${activeAsset} expiry.`
                  : `No ${activeAsset} chain rows were returned for the selected expiry yet. Try another expiry or refresh the snapshot.`
          );
          setOptionsStale(Boolean(data?.stale || data?.unavailable || noListedExpiries));
        } else if (data.stale) {
          setOptionsError(`Using cached options data (${data.stale_age_seconds || 0}s old).`);
        } else {
          setOptionsError("");
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
      if (controller.signal.aborted || err?.code === "REQUEST_ABORTED") return;
      console.warn("Options chain unavailable; keeping source-backed chain data unavailable.", err);
      if (isMounted) {
        setOptionsError(cached?.payload ? "" : (err?.message || "Options data is temporarily unavailable."));
        setOptionsStale(true);
        setOptionsNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : (err?.message || ""));
        setMarketStructure(inferredMarketStructure);
        setMarketStructureLabel(inferredMarketStructureLabel);
        setMarketStructureNote(inferredMarketStructureNote);
        const hyperliquidSpot = await fetchHyperliquidSpot(activeAsset);
        if (!isMounted) return;
        if (Number.isFinite(hyperliquidSpot) && hyperliquidSpot > 0) {
          setSpotPrices((prev) => ({
            ...prev,
            [activeAsset]: hyperliquidSpot
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

  // O6: accelerated poll for crypto options (Derive flow moves fast); equity uses
  // the slower 3-minute snapshot cadence. Re-evaluated each tick so switching
  // modes picks up the right cadence without tearing down the effect.
  const interval = setInterval(() => {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const fast = optionsMarketMode === "crypto";
    const lastKey = cryptoPollLastAtRef.current;
    const nowTs = Date.now();
    if (fast && lastKey && nowTs - lastKey < CRYPTO_CHAIN_REFRESH_MS) return;
    if (!fast && lastKey && nowTs - lastKey < OPTIONS_CHAIN_REFRESH_MS) return;
    cryptoPollLastAtRef.current = nowTs;
    fetchChain();
  }, optionsMarketMode === "crypto" ? Math.min(CRYPTO_CHAIN_REFRESH_MS, 5000) : 5000);

  return () => {
    isMounted = false;
    controller.abort();
    clearInterval(interval);
  };

}, [activeAsset, activeExpiry, allAssets, chainRefreshTick]);

useEffect(() => {
  try {
    localStorage.setItem(OPTIONS_MARKET_MODE_KEY, optionsMarketMode);
  } catch {
    // ignore local persistence issues
  }
}, [optionsMarketMode]);

useEffect(() => {
  if (optionsMarketMode !== "equity") return undefined;
  let isMounted = true;
  const cacheParams = {
    underlying: equityUnderlying,
    expiry: equityExpiry || "nearest"
  };

  const fetchEquityOptions = async () => {
    const cached = readResilientCache("options-equity-chain", cacheParams);
    if (isMounted && cached?.payload) {
      setEquityOptionsData(cached.payload);
      setEquityOptionsError("");
      setEquityOptionsNotice(getEquityOptionsNotice(
        cached.payload,
        "Showing a saved equity options snapshot while Zenin refreshes Massive."
      ));
    }
    setEquityOptionsLoading(true);
    try {
      const params = new URLSearchParams({ underlying: equityUnderlying });
      if (equityExpiry) params.set("expiry", equityExpiry);
      const payload = await zeninFetchJson(`/options/equity?${params.toString()}`);
      if (!isMounted) return;
      setEquityOptionsData(payload);
      setEquityOptionsError("");
      setEquityOptionsNotice(getEquityOptionsNotice(payload));
      writeResilientCache("options-equity-chain", cacheParams, payload);
      if (payload?.activeExpiry && (!equityExpiry || payload?.expiryFallback)) {
        setEquityExpiry(payload.activeExpiry);
      }
    } catch (error) {
      if (!isMounted) return;
      if (cached?.payload) {
        setEquityOptionsData({
          ...cached.payload,
          stale: true,
          unavailable: false,
          stale_reason: error?.message || "massive_equity_options_refresh_failed"
        });
        setEquityOptionsError("Unable to refresh Massive right now; showing the last saved equity options snapshot.");
        setEquityOptionsNotice(getEquityOptionsNotice(cached.payload));
      } else {
        setEquityOptionsError(error?.message || "Equity options snapshot is temporarily unavailable.");
        setEquityOptionsNotice("Retry the snapshot or switch to another supported underlying.");
      }
    } finally {
      if (isMounted) setEquityOptionsLoading(false);
    }
  };

  fetchEquityOptions();
  const interval = setInterval(fetchEquityOptions, OPTIONS_CHAIN_REFRESH_MS);
  return () => {
    isMounted = false;
    clearInterval(interval);
  };
}, [optionsMarketMode, equityUnderlying, equityExpiry, chainRefreshTick]);

const equityOptionsContracts = useMemo(() => {
  if (optionsMarketMode !== "equity") return [];
  const rows = Array.isArray(equityOptionsData?.chain) ? equityOptionsData.chain : [];
  return [...new Set(
    rows.flatMap((row) => [row?.call?.contractTicker, row?.put?.contractTicker]).filter(Boolean)
  )].slice(0, 320);
}, [optionsMarketMode, equityOptionsData]);

const equityOptionsContractsKey = useMemo(
  () => equityOptionsContracts.join("|"),
  [equityOptionsContracts]
);

useEffect(() => {
  setEquityOptionsLiveTape([]);
  setEquityOptionsLiveUpdatedAt("");
  setEquityOptionsLiveConnected(false);
}, [optionsMarketMode, equityUnderlying, equityOptionsData?.activeExpiry]);

useEffect(() => {
  if (equityOptionsSocketRef.current) {
    try {
      equityOptionsSocketRef.current.close();
    } catch {
      // ignore close issues
    }
    equityOptionsSocketRef.current = null;
  }
  if (optionsMarketMode !== "equity" || !canUseWebSocket() || !equityOptionsContracts.length) {
    setEquityOptionsLiveConnected(false);
    return undefined;
  }

  const socket = new WebSocket(resolveZeninWsUrl("/live"));
  equityOptionsSocketRef.current = socket;
  const expectedUnderlying = String(equityUnderlying || "").trim().toUpperCase();
  const expectedExpiry = equityOptionsData?.activeExpiry || equityExpiry || null;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      type: "subscribeEquityOptions",
      underlying: expectedUnderlying,
      expiry: expectedExpiry,
      contracts: equityOptionsContracts
    }));
  });

  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload?.type === "subscribed" && payload?.channel === "equity_options") {
        setEquityOptionsLiveConnected(true);
        return;
      }
      if (payload?.type === "equity_options_error") {
        setEquityOptionsLiveConnected(false);
        return;
      }
      if (payload?.type !== "equity_options_update") return;
      if (String(payload?.underlying || "").trim().toUpperCase() !== expectedUnderlying) return;
      if ((payload?.expiry || null) !== expectedExpiry) return;
      setEquityOptionsLiveConnected(true);
      setEquityOptionsLiveUpdatedAt(payload?.updatedAt || "");
      setEquityOptionsData((previous) => mergeEquityOptionsChainWithLiveUpdate(previous, payload));
      const nextTapeRows = buildEquityOptionsLiveTapeEntries(payload);
      if (nextTapeRows.length) {
        setEquityOptionsLiveTape((previous) => mergeEquityOptionsLiveTape(previous, nextTapeRows));
      }
    } catch {
      // ignore malformed websocket payloads
    }
  });

  socket.addEventListener("close", () => {
    setEquityOptionsLiveConnected(false);
  });

  socket.addEventListener("error", () => {
    setEquityOptionsLiveConnected(false);
  });

  return () => {
    if (equityOptionsSocketRef.current === socket) {
      equityOptionsSocketRef.current = null;
    }
    try {
      socket.close();
    } catch {
      // ignore close issues
    }
  };
}, [optionsMarketMode, equityUnderlying, equityExpiry, equityOptionsData?.activeExpiry, equityOptionsContractsKey]);

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
      const data = await zeninFetchJson(`/options/whale-trades?${params.toString()}`);
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
      setWhaleNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : (err?.message || "Whale trade data is temporarily unavailable."));
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
}, [whaleMinNotional, whaleSource, whaleRefreshTick]);

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

  const formatCompact = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return "—";
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return `${Math.round(n)}`;
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
          return "Telegram whale ingestion is disabled. Configure Telegram MTProto credentials on the backend to load channel flow.";
        }
        if (telegramDebug?.status === "error") {
          return telegramDebug?.error
            ? `Telegram whale ingestion failed: ${telegramDebug.error}`
            : "Telegram whale ingestion failed before any flow could be parsed.";
        }
        if (telegramDebug?.status === "empty" && Number(telegramDebug?.messageCount) > 0) {
          return `Parsed 0 whale-flow items from ${telegramDebug.messageCount} Telegram messages across ${telegramChannels.length || 1} channel${(telegramChannels.length || 1) === 1 ? "" : "s"}.`;
        }
        if (telegramDebug?.status === "partial") {
          return telegramDebug?.error
            ? `Telegram pulled some channels but others failed: ${telegramDebug.error}`
            : "Telegram whale ingestion returned a partial snapshot.";
        }
        return `Waiting for Telegram whale options flow from ${telegramSourceLabel}...`;
      })()
    : "Waiting for Derive whale options flow...";
  const activeUsesRfq = marketStructure === "rfq" || rfqAssets.has(String(activeAsset || "").trim().toUpperCase());
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
  const chainInventoryLabel = activeUsesRfq
    ? (chain.length > 0 ? `${chain.length} Ladder Strikes Cached` : "RFQ market")
    : `${chain.length} Strikes Available`;
  const chainHealthLabel = loading
    ? "Syncing"
    : optionsStale
      ? "Snapshot"
      : filteredChain.length > 0
        ? "Live"
        : activeUsesRfq
          ? "RFQ"
          : "Pending";
  const emptyChainText = activeUsesRfq
    ? `${activeAsset} is currently exposed through ${marketStructureLabel} on Derive, so a full chain snapshot may be partial or unavailable here.`
    : `Waiting for ${activeAsset} option rows from Derive.`;

  // Real 25-delta risk-reversal skew: OTM call IV minus OTM put IV at the
  // strikes nearest a fixed delta band. Null when chain data can't support it.
  const chainSkew = useMemo(() => {
    const rows = Array.isArray(filteredChain) ? filteredChain : [];
    if (!rows.length || !Number.isFinite(activeSpot) || activeSpot <= 0) return null;
    const otmCalls = rows
      .filter((r) => Number(r.strike) > activeSpot && Number(r.delta) >= 0.2 && Number(r.delta) <= 0.3)
      .sort((a, b) => Math.abs(Number(a.delta) - 0.25) - Math.abs(Number(b.delta) - 0.25));
    const otmPuts = rows
      .filter((r) => Number(r.strike) < activeSpot && Number(r.delta) >= -0.3 && Number(r.delta) <= -0.2)
      .sort((a, b) => Math.abs(Number(a.delta) + 0.25) - Math.abs(Number(b.delta) + 0.25));
    const callIv = Number(otmCalls[0]?.iv);
    const putIv = Number(otmPuts[0]?.iv);
    if (!(callIv > 0) || !(putIv > 0)) return null;
    return Number((callIv - putIv).toFixed(2));
  }, [filteredChain, activeSpot]);

  const handleRefreshOptionsView = () => {
    setChainRefreshTick((tick) => tick + 1);
    setWhaleRefreshTick((tick) => tick + 1);
    if (showToast) showToast("Refreshing options workspace.", "success");
  };

  const optionsRecoveryDescription = optionsError
    ? optionsError
    : optionsStale && optionsNotice
      ? optionsNotice
      : emptyChainText;

  const handleJumpToSavedItems = () => {
    if (!savedOptionViews.length && !(activeOptionsTrades && activeOptionsTrades.length > 0)) {
      if (showToast) showToast("No saved options items yet.", "info");
      return;
    }
    setShowSavedItemsDrawer(true);
  };

  const handleSaveOptionsView = () => {
    try {
      const nextViews = [
        {
          id: `options-view-${Date.now()}`,
          marketMode: optionsMarketMode,
          activeAsset,
          activeExpiry,
          equityUnderlying,
          equityExpiry,
          strikeWindow,
          whaleMinNotional,
          whaleSource,
          savedAt: new Date().toISOString(),
        },
        ...savedOptionViews,
      ].slice(0, 12);
      localStorage.setItem(OPTIONS_SAVED_VIEWS_KEY, JSON.stringify(nextViews));
      setSavedOptionViews(nextViews);
      setShowSavedItemsDrawer(true);
      if (showToast) showToast("Options view saved to Saved Items.", "success");
    } catch {
      if (showToast) showToast("Couldn't save this view locally.", "error");
    }
  };

  const applySavedOptionsView = (view) => {
    if (!view || typeof view !== "object") return;
    const requestedMode = String(view.marketMode || "crypto").toLowerCase() === "equity" ? "equity" : "crypto";
    setOptionsMarketMode(requestedMode);
    if (requestedMode === "equity") {
      const requestedUnderlying = String(view.equityUnderlying || equityUnderlying).trim().toUpperCase() || equityUnderlying;
      const resolvedUnderlying = equityUnderlyings.includes(requestedUnderlying) ? requestedUnderlying : (equityUnderlyings[0] || equityUnderlying);
      setEquityUnderlying(resolvedUnderlying);
      setEquityExpiry(view.equityExpiry || null);
      setShowSavedItemsDrawer(false);
      if (showToast) showToast("Saved equity options view applied.", "success");
      return;
    }
    const requestedAsset = String(view.activeAsset || activeAsset).trim().toUpperCase() || activeAsset;
    const resolvedAsset = allAssets.includes(requestedAsset) ? requestedAsset : (allAssets[0] || activeAsset);
    setActiveAsset(resolvedAsset);
    setActiveExpiry(view.activeExpiry || null);
    setStrikeWindow(view.strikeWindow || "all");
    setWhaleMinNotional(Number(view.whaleMinNotional) || 10000);
    setWhaleSource(view.whaleSource || "telegram");
    setShowSavedItemsDrawer(false);
    if (showToast) showToast("Saved options view applied.", "success");
  };

  const openActiveTradesFromSavedItems = () => {
    setShowSavedItemsDrawer(false);
    if (activeTradesRef.current) {
      activeTradesRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (showToast) showToast("No active options trades saved yet.", "info");
  };

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
  const cryptoPollLastAtRef = useRef(0); // O6: throttles accelerated crypto poll
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
            row.style.backgroundColor = 'rgba(255, 255, 255, 0.25)';
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

    // O4: recompute rho from BS where the feed omits it (e.g. Derive/Massive).
    let rho = Number(call?.rho);
    if (!Number.isFinite(rho) || rho === 0) {
      const g = recomputeGreeks({
        strike: Number(nearest?.strike),
        optionType: "call",
        spotPrice: centerSpot,
        impliedVolatility: Number(call?.iv || call?.impliedVolatility),
        expiry: call?.expiry,
        riskFreeRate: 0.0425,
      });
      rho = Number.isFinite(g.rho) ? g.rho : 0;
    }

    return {
      delta: Number.isFinite(callDelta) ? callDelta : 0,
      gamma: Number.isFinite(callGamma) ? callGamma : 0,
      theta: Number.isFinite(callTheta) ? callTheta : 0,
      vega: Number.isFinite(callVega) ? callVega : 0,
      rho,
    };
  }, [filteredChain, chain, activeSpot]);

  // O4: Max Pain = strike where total options OI expires worthless (calls above /
  // puts below that strike) is minimized. Computed from the current chain OI.
  const maxPain = useMemo(() => {
    const rows = (Array.isArray(filteredChain) && filteredChain.length ? filteredChain : chain) || [];
    if (!rows.length) return null;
    const strikes = rows.map((r) => Number(r?.strike || 0)).filter((s) => s > 0);
    if (!strikes.length) return null;
    let best = null;
    for (const mp of strikes) {
      let pain = 0;
      for (const r of rows) {
        const k = Number(r?.strike || 0);
        const callOi = Number(r?.call?.openInterest ?? r?.call?.oi ?? 0);
        const putOi = Number(r?.put?.openInterest ?? r?.put?.oi ?? 0);
        if (mp > k) pain += callOi * (mp - k);
        if (mp < k) pain += putOi * (k - mp);
      }
      if (best === null || pain < best.pain) best = { strike: mp, pain };
    }
    return best ? best.strike : null;
  }, [filteredChain, chain]);

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
          const payload = await zeninFetchJson(`/options/crypto`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ currency: activeAsset, expiry: expiryTs })
          });
          if (cancelled) return;
          const iv = Number(payload?.market_metrics?.iv);
          const chainIv = deriveIvFromChain(payload?.chain || []);
          const resolvedIv = Number.isFinite(iv) && iv > 0 ? iv : chainIv;
          if (Number.isFinite(resolvedIv) && resolvedIv > 0) {
            setTermIvByExpiry((prev) => ({ ...prev, [String(expiryTs)]: Number(resolvedIv) }));
          }
        } catch (error) {
          console.warn("[Options] Term IV fetch failed for expiry", expiryTs, ":", error?.message || error);
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
      
      let impliedVol = null;
      if (Number.isFinite(mappedIv) && mappedIv > 0) {
        impliedVol = mappedIv;
      } else if (Number.isFinite(liveBaseIv) && liveBaseIv > 0) {
        impliedVol = liveBaseIv;
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
    <div className="view-container options-terminal options-exec">
      <header className="options-exec-header">
        <div>
          <div className="options-exec-eyebrow">Derivatives desk</div>
          <h1>Options Risk Desk</h1>
          <p>
            {optionsMarketMode === "equity"
              ? "Listed chains, surface context, and risk context for equity underlyings."
              : "Crypto volatility, flow, exposure scenarios, and expiry pressure in one workstation."}
          </p>
        </div>
        <span className="options-exec-live-badge">
          <span aria-hidden="true" />
          {optionsMarketMode === "equity"
            ? (equityOptionsLoading ? "Syncing" : equityOptionsData?.unavailable ? "Offline" : equityOptionsLiveConnected ? "Live" : "Snapshot")
            : (optionsMarketMode === "crypto" ? "~30s refresh" : "~3m refresh")}
        </span>
        <div className="options-exec-header-actions" aria-label="Options view actions">
          <div className="options-exec-mode-toggle" role="tablist" aria-label="Options market mode">
            <button
              type="button"
              className={optionsMarketMode === "crypto" ? "active" : ""}
              onClick={() => setOptionsMarketMode("crypto")}
            >
              Crypto Options
            </button>
            <button
              type="button"
              className={optionsMarketMode === "equity" ? "active" : ""}
              onClick={() => setOptionsMarketMode("equity")}
            >
              Equity Options
            </button>
          </div>
          <div className="options-exec-segmented-actions">
            <button type="button" className="active" onClick={handleJumpToSavedItems}>
              Saved Items
            </button>
            <button type="button" onClick={handleRefreshOptionsView} disabled={loading || whaleLoading}>
              Refresh
            </button>
          </div>
          <button type="button" className="options-exec-secondary-action" onClick={handleSaveOptionsView}>
            Save View
          </button>
        </div>
      </header>

      {optionsMarketMode === "equity" ? (
        <EquityOptionsDesk
          underlying={equityUnderlying}
          onUnderlyingChange={(value) => {
            setEquityExpiry(null);
            setEquityUnderlying(String(value || "").trim().toUpperCase());
          }}
          expiry={equityExpiry}
          onExpiryChange={setEquityExpiry}
          supportedUnderlyings={equityUnderlyings}
          loading={equityOptionsLoading}
          error={equityOptionsError}
          notice={equityOptionsNotice}
          data={equityOptionsData}
          liveTape={equityOptionsLiveTape}
          liveConnected={equityOptionsLiveConnected}
          liveUpdatedAt={equityOptionsLiveUpdatedAt}
          onRefresh={handleRefreshOptionsView}
        />
      ) : (
      <>
      <div className="portfolio-analytics-row options-exec-metrics">
        <div className="metric-card glass options-exec-metric-card">
          <label>Implied Volatility <span className="live-pill">Live</span></label>
          <div className="value">{(metrics.iv * 100).toFixed(1)}%</div>
          <div className="change positive">▲ Real-time</div>
        </div>
        <div className="metric-card glass options-exec-metric-card">
          <label>Put/Call Ratio</label>
          <div className="value">{metrics.pcr > 0 ? metrics.pcr.toFixed(2) : "—"}</div>
          <div className="change info">{metrics.pcr > 0 ? "Live" : "Unavailable"}</div>
        </div>
        <div className="metric-card glass options-exec-metric-card">
          <label>Market Skew</label>
          <div className="value">{chainSkew != null ? `${chainSkew > 0 ? "+" : ""}${chainSkew.toFixed(2)}` : "—"}</div>
          <div className="change info">{chainSkew != null ? "25Δ RR" : "Unavailable"}</div>
        </div>
        <div className="metric-card glass options-exec-metric-card options-exec-session-card">
          <label>Session Status</label>
          <div className="value">{activeUsesRfq ? "RFQ" : "Open Flow"}</div>
          <div className="change info">{allAssets.slice(0, 3).join(" / ")}</div>
        </div>
      </div>

      {/* Saved Options Scenarios Card */}
      {activeOptionsTrades && activeOptionsTrades.length > 0 && (
        <div ref={activeTradesRef} className="watchlist-panel glass options-exec-panel" style={{ marginBottom: "16px", padding: "16px" }}>
          <div className="section-header options-exec-panel-head">
            <h2>Saved Options Scenarios</h2>
          </div>
          <div className="active-trades-table-container scrollbar-thin">
            <DataTable
              columns={[
                {
                  key: "strategy",
                  header: "Strategy",
                  sortable: false,
                  cell: (trade) => {
                    const isLong = String(trade.strategy || "").toLowerCase().includes("long") ||
                                   String(trade.strategy || "").toLowerCase().includes("bull");
                    return (
                      <div className="strategy-name" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{
                          width: "4px",
                          height: "14px",
                          borderRadius: "2px",
                          background: isLong ? "var(--color-success)" : "var(--color-danger)"
                        }}></span>
                        {trade.strategy}
                      </div>
                    );
                  },
                },
                { key: "asset", header: "Asset", sortable: false, cell: (t) => <span className="active-trades-symbol">{t.asset}</span> },
                { key: "qty", header: "Qty", sortable: false, cell: (t) => t.qty || t.quantity || 1 },
                { key: "expiry", header: "Expiry", sortable: false, cell: (t) => <span style={{ fontSize: "var(--fs-sm)", color: "var(--color-text-secondary)" }}>{t.legs?.[0]?.expiry || "—"}</span> },
                {
                  key: "prem",
                  header: "Scenario Prem",
                  sortable: false,
                  cell: (t) => <span style={{ color: "var(--color-text-secondary)" }}>${getTradeEntryPremium(t).toFixed(2)}</span>,
                },
                {
                  key: "mark",
                  header: "Live Mark",
                  sortable: false,
                  cell: (t) => {
                    const { currentMark } = getInternalOptionPnL(t);
                    return <span style={{ fontWeight: 600, color: "var(--color-text-primary)" }}>${(currentMark || 0).toFixed(2)}</span>;
                  },
                },
                {
                  key: "delta",
                  header: "Delta",
                  sortable: false,
                  cell: (t) => {
                    const { delta } = getInternalOptionPnL(t);
                    return <span style={{ color: (delta || 0) >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>{(delta || 0).toFixed(2)}</span>;
                  },
                },
                {
                  key: "theta",
                  header: "Theta",
                  sortable: false,
                  cell: (t) => {
                    const { theta } = getInternalOptionPnL(t);
                    return <span style={{ color: (theta || 0) >= 0 ? "var(--color-success)" : "var(--color-danger)" }}>{(theta || 0).toFixed(2)}</span>;
                  },
                },
                {
                  key: "pnl",
                  header: "Unrealized PnL",
                  sortable: false,
                  cell: (t) => {
                    const { pnl } = getInternalOptionPnL(t);
                    const color = pnl >= 0 ? "var(--color-success)" : "var(--color-danger)";
                    return <span className="active-trades-pnl" style={{ color }}>{(pnl >= 0 ? "+" : "") + (pnl || 0).toFixed(2)}</span>;
                  },
                },
                {
                  key: "action",
                  header: "Manage",
                  sortable: false,
                  cell: (t) => <button className="close-trade-btn" onClick={(e) => { e.stopPropagation(); closeOptionTrade(t.id); }}>Remove</button>,
                },
              ]}
              data={activeOptionsTrades}
              getRowId={(t) => t.id}
              getRowClassName={(t) => {
                const { isStale } = getInternalOptionPnL(t);
                return isStale ? "stale-row" : "";
              }}
              className="active-trades-table"
            />
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

      <div className="watchlist-panel glass options-exec-panel options-exec-greeks-panel" style={{ marginBottom: "16px" }}>
        <div className="section-header options-exec-panel-head">
          <h2>Greeks & Volatility Context</h2>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <span className="asset-count">Strike Window</span>
            <select
              value={strikeWindow}
              onChange={(e) => setStrikeWindow(e.target.value)}
              style={{ background: "var(--color-surface-panel)", color: "var(--color-text-primary)", border: "1px solid var(--color-border-subtle)", borderRadius: "8px", padding: "4px 8px", fontSize: "12px" }}
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
            { label: hasActiveTrades && hasPortfolioGreeks ? "Portfolio Rho" : "Market Rho (ATM)", value: displayGreeks.rho },
            { label: "Implied Volatility", value: Number(metrics?.iv || 0) },
            { label: "Max Pain", value: maxPain != null ? Number(maxPain) : null }
          ].map((item) => (
            <div key={item.label} className="journal-stat-card">
              <span className="journal-stat-label">{item.label}</span>
              <span className="journal-stat-value">
                {item.label === "Implied Volatility"
                  ? `${(Number(item.value || 0) * 100).toFixed(2)}%`
                  : item.label === "Max Pain"
                  ? (item.value != null ? Number(item.value).toLocaleString() : "—")
                  : Number(item.value || 0).toFixed(3)}
              </span>
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "10px" }}>
          <div className="options-exec-mini-visual" style={{ border: "1px solid rgba(160, 160, 160, 0.14)", borderRadius: "10px", padding: "10px" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>IV / OI Heatmap</div>
            <div style={{ display: "grid", gap: "6px" }}>
              {filteredChain.slice(0, 8).map((row) => {
                const callIv = Number(row?.call?.iv || 0) * 100;
                const callOi = Number(row?.call?.openInterest || row?.call?.oi || 0);
                const intensity = Math.min(1, Math.max(0.08, (callIv / 120) + (callOi / 100000)));
                return (
                  <button
                    type="button"
                    key={`heat-${row.strike}`} 
                    onClick={() => scrollToStrike(row.strike)}
                    className="options-exec-heat-row"
                    style={{ 
                      width: "100%",
                      border: "none",
                      borderRadius: "6px", 
                      padding: "6px 8px", 
                      background: `rgba(255,255,255,${intensity.toFixed(2)})`, 
                      display: "flex", 
                      justifyContent: "space-between", 
                      fontSize: "12px",
                      color: "var(--color-data-slate-bright)",
                      cursor: "pointer",
                      transition: "transform 0.1s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.02)'}
                    onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}
                  >
                    <span>{Number(row.strike).toLocaleString()}</span>
                    <span>IV {callIv.toFixed(1)}% · OI {callOi.toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="options-exec-mini-visual" style={{ border: "1px solid rgba(160, 160, 160, 0.14)", borderRadius: "10px", padding: "10px" }}>
            <div style={{ fontSize: "12px", color: "var(--color-text-secondary)", marginBottom: "6px" }}>Volatility Term Structure</div>
            <div style={{ display: "grid", gap: "6px" }}>
              {termStructureRows.slice(0, 8).map((row) => (
                  <button
                    type="button"
                    key={`term-${row.expiryTs}`} 
                    onClick={() => setActiveExpiry(row.expiryTs)}
                    className="options-exec-term-row"
                    style={{ 
                      width: "100%",
                      border: "none",
                      display: "grid", 
                      gridTemplateColumns: "68px 1fr 48px", 
                      gap: "8px", 
                      alignItems: "center", 
                      fontSize: "12px",
                      color: "inherit",
                      background: "transparent",
                      cursor: "pointer",
                      padding: "2px 4px",
                      borderRadius: "4px",
                      transition: "background 0.1s"
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(160, 160, 160, 0.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                  <span style={{ color: activeExpiry === row.expiryTs ? "var(--color-data-primary)" : "inherit", fontWeight: activeExpiry === row.expiryTs ? "bold" : "normal" }}>{formatDate(row.expiryTs)}</span>
                  <div style={{ height: "8px", background: "var(--color-surface-elevated, rgba(5,5,5,0.8))", borderRadius: "999px", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, row.impliedVol * 100)}%`, height: "100%", background: activeExpiry === row.expiryTs ? "linear-gradient(90deg, var(--color-data-primary), var(--color-data-secondary))" : "linear-gradient(90deg, var(--color-success), var(--color-data-primary))" }} />
                  </div>
                  <span style={{ color: activeExpiry === row.expiryTs ? "var(--color-data-primary)" : "inherit" }}>{(row.impliedVol * 100).toFixed(1)}%</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {(upcomingEarningsForAsset.length > 0 || assignmentReminders.length > 0) ? (
        <div className="watchlist-panel glass options-exec-panel" style={{ marginBottom: "16px" }}>
          <div className="section-header options-exec-panel-head">
            <h2>Event Risk Warnings</h2>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {upcomingEarningsForAsset.map((evt, idx) => (
              <div key={`earnwarn-${idx}`} style={{ border: "1px solid rgba(245,158,11,0.36)", borderRadius: "8px", padding: "8px 10px", color: "var(--color-data-amber-bright)", fontSize: "12px", background: "var(--color-warning-soft)" }}>
                Earnings volatility warning: {activeAsset} has earnings on {evt?.date || evt?.reportDate || "upcoming"}; avoid overlapping expiries unless intentional.
              </div>
            ))}
            {assignmentReminders.map((item) => (
              <div key={`assign-${item.id}`} style={{ border: "1px solid var(--color-border-subtle)", borderRadius: "8px", padding: "8px 10px", color: "var(--color-text-secondary)", fontSize: "12px", background: "var(--color-surface-panel)" }}>
                {item.label}: expires in {item.hoursToExpiry}h{item.inTheMoneyRisk ? " · Assignment risk elevated (ITM)." : ""}.
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="watchlist-panel glass options-exec-panel options-exec-chain-panel">
        <div className="section-header options-exec-panel-head">
          <div className="header-left">
            <h2>{activeAsset} Option Chain <span className="live-pill">{chainHealthLabel}</span></h2>
            <div className="options-market-context">
              <div className="asset-count">{chainInventoryLabel}</div>
              <span className={`options-market-structure-pill ${activeUsesRfq ? "rfq" : "orderbook"}`}>
                {marketStructureLabel}
              </span>
              <span className={`data-health-badge ${loading ? "loading" : optionsStale ? "hazard" : "ok"}`} title={loading ? "Refreshing options chain" : optionsStale ? "Showing previous options snapshot" : "Options chain is up to date"}>
                <DataHealthBadge status={loading ? "loading" : optionsStale ? "stale" : "ok"} />
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
            <div className="loading-state">{activeUsesRfq ? `Syncing ${activeAsset} RFQ references...` : `Syncing ${activeAsset} with Derive...`}</div>
          ) : filteredChain.length === 0 ? (
            <GuidedEmptyState
              eyebrow="Options workflow"
              title={`No ${activeAsset} chain rows ready yet`}
              description={optionsRecoveryDescription}
              steps={[
                "Retry the chain snapshot or switch to a different underlying with live rows.",
                "Use the strategy simulator only after the ladder and spot reference are in sync.",
              ]}
              cta="Retry snapshot"
              onAction={handleRefreshOptionsView}
              tone={optionsStale || optionsError ? "warning" : "default"}
              className="guided-empty-state--compact options-guided-empty"
            />
          ) : (
            <div className="table-scroll options-chain-scroll options-exec-table-scroll" style={{ maxHeight: "min(60vh, 540px)", minHeight: "260px", overflowY: "auto", scrollBehavior: "smooth" }} ref={chainScrollRef}>
              <table className="option-chain-table">
                <thead>
                  <tr>
                    <th colSpan="6" className="chain-side-header">Calls</th>
                    <th className="strike-col chain-side-divider">Strike</th>
                    <th colSpan="6" className="chain-side-header">Puts</th>
                  </tr>
                  <tr>
                    <th>IV</th>
                    <th>Delta</th>
                    <th>OI</th>
                    <th>Vol</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th className="strike-col">Strike</th>
                    <th>Bid</th>
                    <th>Ask</th>
                    <th>OI</th>
                    <th>Vol</th>
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
                      <td className="oi-vol">{formatCompact(row.call?.openInterest ?? row.call?.oi)}</td>
                      <td className="oi-vol">{formatCompact(row.call?.volume)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.bid)}</td>
                      <td className="bid-ask positive">{formatOptionPx(row.call?.ask)}</td>
                      <td className="strike-col" style={{ position: "relative" }}>
                        {isAtm ? (
                          <div style={{ position: "absolute", top: "-10px", left: "50%", transform: "translateX(-50%)", background: "var(--color-data-primary)", color: "var(--color-text-inverse)", padding: "1px 6px", borderRadius: "4px", fontSize: "var(--fs-xs)", fontWeight: "bold", zIndex: 10, whiteSpace: "nowrap" }}>
                            {activeAsset} {activeSpot.toFixed(2)}
                          </div>
                        ) : null}
                        <span style={{ color: isAtm ? "var(--color-data-primary)" : "inherit", fontWeight: isAtm ? "bold" : "normal" }}>{Number(row.strike || 0).toLocaleString()}</span>
                      </td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.bid)}</td>
                      <td className="bid-ask negative">{formatOptionPx(row.put?.ask)}</td>
                      <td className="oi-vol">{formatCompact(row.put?.openInterest ?? row.put?.oi)}</td>
                      <td className="oi-vol">{formatCompact(row.put?.volume)}</td>
                      <td className="greek">{formatGreek(row.put?.delta, 3)}</td>
                      <td className="greek">{formatIv(row.put?.iv)}</td>
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}
          {optionsError || (optionsStale && optionsNotice) ? (
            <div style={{ marginTop: "10px" }}>
              <GuidedEmptyState
                eyebrow="Recovery"
                title={optionsError ? "Chain snapshot needs review" : "Showing a previous chain snapshot"}
                description={optionsRecoveryDescription}
                steps={[
                  "Refresh the workspace to pull a fresh chain and whale snapshot.",
                  "If the warning persists, switch expiries or underlyings before executing.",
                ]}
                cta="Refresh options"
                onAction={handleRefreshOptionsView}
                tone="warning"
                className="guided-empty-state--compact options-guided-empty"
              />
            </div>
          ) : null}
      </div>

      <div className="watchlist-panel glass whale-trades-panel options-exec-panel options-exec-whale-panel" style={{ marginTop: "16px", padding: "16px" }}>
        <div className="section-header options-exec-panel-head" style={{ marginBottom: "10px" }}>
          <div className="header-left">
            <h2>Whale Options Flow <span className="live-pill">Live</span></h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <div className="asset-count">BTC / ETH / SOL / HYPE</div>
            </div>
          </div>
          <div className="whale-options-controls">
            <div className="search-type-buttons" style={{ marginLeft: 0 }}>
              {whaleSourceOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`search-type-button${whaleSource === opt.value ? " active" : ""}`}
                  onClick={() => {
                    if (whaleSource !== opt.value) {
                      setWhaleSource(opt.value);
                      setWhaleRefreshTick((t) => t + 1);
                    }
                  }}
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
          <div style={{ marginBottom: "10px", fontSize: "12px", color: "var(--color-data-slate-dim)" }}>
            Sources: {telegramSourceLabel}
            {telegramTransportLabel ? ` · Transport: ${telegramTransportLabel}` : ""}
            {telegramDebug?.status && telegramDebug.status !== "ok" ? ` · Status: ${telegramDebug.status}` : ""}
          </div>
        ) : null}
        {whaleStale && whaleNotice ? (
          <div className="snapshot-inline-note" style={{ marginBottom: "10px" }}>{whaleNotice}</div>
        ) : null}

        {whaleLoading && whaleTrades.length === 0 ? (
          <div className="loading-state">Loading whale options flow...</div>
        ) : pagedWhaleTrades.length === 0 ? (
          <div className="loading-state">{whaleEmptyStateText}</div>
        ) : (
          <div className="table-scroll options-exec-table-scroll">
            <DataTable
              columns={[
                { key: "symbol", header: "Symbol", sortable: false, cell: (t) => <span className="greek">{t.symbol}</span> },
                { key: "expiration", header: "Expiration", sortable: false, cell: (t) => <span className="greek">{t.expiration || "—"}</span> },
                { key: "referencePrice", header: "Reference Price", sortable: false, cell: (t) => <span className="bid-ask positive">{formatDollar(t.referencePrice)}</span> },
                { key: "strategy", header: "Strategy", sortable: false, cell: (t) => <span className="greek">{t.strategy}</span> },
                { key: "totalNotional", header: "Total Notional", sortable: false, cell: (t) => <span className="bid-ask positive">{formatDollar(t.totalNotional)}</span> },
              ]}
              data={pagedWhaleTrades}
              getRowId={(t) => t.id}
              onRowClick={(t) => handleWhaleTradeClick(t)}
              className="option-chain-table whale-trades-table"
            />
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

      <OptionsInstitutionalPanel
        chain={filteredChain}
        activeOptionsTrades={activeOptionsTrades || []}
        activeAsset={activeAsset}
      />
      </>
      )}

      <OptionsSavedItemsDrawer
        open={showSavedItemsDrawer}
        onClose={() => setShowSavedItemsDrawer(false)}
        savedViews={savedOptionViews}
        activeTrades={activeOptionsTrades || []}
        assignmentReminders={assignmentReminders}
        onApplyView={applySavedOptionsView}
        onOpenActiveTrades={openActiveTradesFromSavedItems}
      />

    </div>
  );
}

function OptionsSavedItemsDrawer({
  open,
  onClose,
  savedViews,
  activeTrades,
  assignmentReminders,
  onApplyView,
  onOpenActiveTrades,
}) {
  if (!open) return null;

  return (
    <div className="home-v3-drawer-overlay" onMouseDown={onClose}>
      <aside
        className="home-v3-detail-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Saved items"
        style={{ maxWidth: 720 }}
      >
        <div className="home-v3-drawer-head">
          <h2>Saved Items</h2>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div style={{ display: "grid", gap: 18 }}>
          <section style={{ display: "grid", gap: 10 }}>
            <div>
              <strong style={{ display: "block", marginBottom: 4 }}>Saved Views</strong>
              <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>
                {savedViews.length ? `${savedViews.length} saved view${savedViews.length === 1 ? "" : "s"}` : "No saved options views yet."}
              </span>
            </div>
            {savedViews.map((view) => (
              <SavedOptionsRow
                key={view.id}
                title={`${view.activeAsset || "Asset"} · ${String(view.strikeWindow || "all").toUpperCase()} strikes`}
                subtitle={`${view.whaleMinNotional ? `$${Number(view.whaleMinNotional).toLocaleString()} min notional` : "Whale flow"} · ${formatSavedTimestamp(view.savedAt)}`}
                actionLabel="Apply"
                onAction={() => onApplyView(view)}
              />
            ))}
          </section>
          <section style={{ display: "grid", gap: 10 }}>
            <div>
              <strong style={{ display: "block", marginBottom: 4 }}>Saved Scenarios</strong>
              <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>
                {activeTrades.length ? `${activeTrades.length} saved scenario${activeTrades.length === 1 ? "" : "s"}` : "No saved options scenarios yet."}
              </span>
            </div>
            {activeTrades.length ? (
              <SavedOptionsRow
                title="Saved scenarios"
                subtitle={`${activeTrades.slice(0, 3).map((trade) => trade.asset).join(" / ")}${activeTrades.length > 3 ? "…" : ""}`}
                actionLabel="Open"
                onAction={onOpenActiveTrades}
              />
            ) : null}
          </section>
          {assignmentReminders.length ? (
            <section style={{ display: "grid", gap: 10 }}>
              <div>
                <strong style={{ display: "block", marginBottom: 4 }}>Assignment Reminders</strong>
                <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>
                  {assignmentReminders.length} expiring position{assignmentReminders.length === 1 ? "" : "s"} under watch.
                </span>
              </div>
              {assignmentReminders.slice(0, 5).map((item) => (
                <SavedOptionsRow
                  key={item.id}
                  title={item.label}
                  subtitle={`Expires in ${item.hoursToExpiry}h${item.inTheMoneyRisk ? " · ITM risk elevated" : ""}`}
                  actionLabel="Open"
                  onAction={onOpenActiveTrades}
                />
              ))}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

function SavedOptionsRow({ title, subtitle, actionLabel, onAction }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "center",
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(160, 160, 160, 0.18)",
        background: "rgba(10, 10, 10, 0.45)",
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <strong>{title}</strong>
        <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>{subtitle}</span>
      </div>
      <button type="button" className="options-exec-secondary-action" onClick={onAction}>
        {actionLabel}
      </button>
    </div>
  );
}
