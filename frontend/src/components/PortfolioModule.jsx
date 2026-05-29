import { useEffect, useMemo, useRef, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { TradingViewChart } from "./TradingViewChart";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { formatCurrency, getCurrencySymbol, convertToUSD, convertFromUSD, DEFAULT_FX_RATES } from "../utils/currencyUtils";
import { hasWorkspaceSession, loadWorkspaceDoc, saveWorkspaceCollection, saveWorkspaceDoc } from "../utils/workspacePersistence";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";

const PORTFOLIO_VIEW_STORAGE_KEY = "zenin_portfolio_view_state_v1";
const PORTFOLIO_SAVED_VIEWS_KEY = "zenin_portfolio_saved_views";
const PORTFOLIO_ALERTS_KEY = "zenin_portfolio_alerts";
const PORTFOLIO_REBALANCE_QUEUE_KEY = "zenin_portfolio_rebalance_queue";
const PORTFOLIO_REBALANCE_HISTORY_KEY = "zenin_portfolio_rebalance_history";
const PORTFOLIO_EXPORTS_KEY = "zenin_portfolio_exports";
const JOURNAL_STORAGE_KEY = "zenin_journal_entries";
const FEE_SOURCE_EXCHANGE_REPORTED = "exchange_reported";
const FEE_SOURCE_CHEAPEST_AVENUE = "cheapest_avenue";

function formatRiskLabel(value, fallback = "Watch") {
  const normalized = String(value || "").trim();
  return (normalized || fallback).replace(/-/g, " ");
}

function normalizeFeeSourceValue(value, fallback = FEE_SOURCE_EXCHANGE_REPORTED) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!normalized) return fallback;
  if (["exchange_reported", "exchange", "reported", "venue_reported", "broker_reported"].includes(normalized)) {
    return FEE_SOURCE_EXCHANGE_REPORTED;
  }
  if ([
    "cheapest_avenue",
    "cheapest",
    "best_avenue",
    "best_venue",
    "internal",
    "estimated",
    "internal_estimate",
    "zenin_estimated",
    "zenin"
  ].includes(normalized)) {
    return FEE_SOURCE_CHEAPEST_AVENUE;
  }
  return normalized;
}

function formatFeeSourceLabel(value) {
  const normalized = normalizeFeeSourceValue(value);
  if (normalized === FEE_SOURCE_EXCHANGE_REPORTED) return "Exchange Reported";
  if (normalized === FEE_SOURCE_CHEAPEST_AVENUE) return "Cheapest Avenue";
  return normalized
    .split("_")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function readStoredJson(key, fallback) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "null");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function appendStoredRecord(key, record, limit = 30) {
  const existing = readStoredJson(key, []);
  const rows = Array.isArray(existing) ? existing : [];
  localStorage.setItem(key, JSON.stringify([record, ...rows].slice(0, limit)));
  return [record, ...rows].slice(0, limit);
}

function formatSavedTimestamp(value) {
  const timestamp = new Date(value || Date.now());
  if (Number.isNaN(timestamp.getTime())) return "Saved recently";
  return timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function PortfolioModule({
  portfolio,
  trades = [],
  balance = 0,
  accountMetrics = null,
  calculatePortfolioValue,
  calculatePortfolioGain,
  activeOptionsTrades = [],
  tradeFeeSummary = null,
  multiChainCache = {},
  spotPrices = {},
  isSignedIn = false,
  onEstimateRebalance = null,
  onExecuteRebalance = null,
  onRemove,
  onSellAsset,
  onSelectAsset,
  onOpenPredictions,
  onOpenJournal,
  onOpenMarketContext,
  onOpenConnections,
  connectedAccounts = [],
  hasDeskFeatureAccess = false,
  onOpenPlans
}){
  const g7Currencies = Array.isArray(getAppRuntimeConfig()?.ui?.g7Currencies)
    ? getAppRuntimeConfig().ui.g7Currencies
    : ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"];
  const intervals = Array.isArray(getAppRuntimeConfig()?.ui?.portfolioIntervals)
    ? getAppRuntimeConfig().ui.portfolioIntervals
    : ["1D", "1W", "1M", "3M", "1Y", "YTD", "ALL"];
  const [chartMode, setChartMode] = useState("equity");
  const [performanceView, setPerformanceView] = useState("chart");
  const [chartInterval, setChartInterval] = useState("1D");
  const [showDiversificationModal, setShowDiversificationModal] = useState(false);
  const [holdingsSortBy, setHoldingsSortBy] = useState("value");
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [benchmarkSymbol, setBenchmarkSymbol] = useState("SPY");
  const [selectedTaxLotMethod, setSelectedTaxLotMethod] = useState("hifo");
  const [activeInsightFlow, setActiveInsightFlow] = useState(null);
  const [insightFlowStep, setInsightFlowStep] = useState(1);
  const [flowSelection, setFlowSelection] = useState(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowActionLabel, setFlowActionLabel] = useState("");
  const [flowOutcome, setFlowOutcome] = useState({ title: "", message: "", tone: "success" });
  const [displayCurrency, setDisplayCurrency] = useState("USD");
  const [assetClassFilter, setAssetClassFilter] = useState("all");
  const [activePortfolioTab, setActivePortfolioTab] = useState("holdings");
  const [showPredictionGuide, setShowPredictionGuide] = useState(false);
  const [showSavedWorkspaceDrawer, setShowSavedWorkspaceDrawer] = useState(false);
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const isSyncing = false;
  const [rebalanceEstimate, setRebalanceEstimate] = useState(null);
  const [rebalanceEstimateStatus, setRebalanceEstimateStatus] = useState("idle");
  const [savedPortfolioViews, setSavedPortfolioViews] = useState(() => readStoredJson(PORTFOLIO_SAVED_VIEWS_KEY, []));
  const [savedPortfolioAlerts, setSavedPortfolioAlerts] = useState(() => readStoredJson(PORTFOLIO_ALERTS_KEY, []));
  const [savedPortfolioQueue, setSavedPortfolioQueue] = useState(() => readStoredJson(PORTFOLIO_REBALANCE_QUEUE_KEY, []));
  const [savedPortfolioHistory, setSavedPortfolioHistory] = useState(() => readStoredJson(PORTFOLIO_REBALANCE_HISTORY_KEY, []));
  const [savedPortfolioExports, setSavedPortfolioExports] = useState(() => readStoredJson(PORTFOLIO_EXPORTS_KEY, []));
  const prefsHydratedRef = useRef(false);
  const analysisSectionRef = useRef(null);
  const getSaveTargetLabel = () => hasWorkspaceSession() ? "your Zenin workspace" : "this browser";
  const openPortfolioTab = (tabId) => {
    setActivePortfolioTab(tabId);
    requestAnimationFrame(() => {
      analysisSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  };
  const handleOpenConnections = () => {
    if (Array.isArray(connectedAccounts) && connectedAccounts.length) {
      setShowConnectionsModal(true);
      return;
    }
    if (typeof onOpenConnections === "function") {
      onOpenConnections();
    }
  };

  const syncPortfolioCollection = async (namespace, rows, limit = 100) => {
    return saveWorkspaceCollection(namespace, rows, limit);
  };

  const filteredTrades = useMemo(() => {
    if (assetClassFilter === "all") return trades;
    return (trades || []).filter(t => {
      const type = String(t.type || t.marketType || "").toLowerCase();
      if (assetClassFilter === "equities") return ["stock", "equity", "etf"].includes(type);
      if (assetClassFilter === "options") return false;
      if (assetClassFilter === "commodities") return ["commodity", "commodities", "future", "futures"].includes(type);
      if (assetClassFilter === "crypto") return type === "crypto";
      return false;
    });
  }, [trades, assetClassFilter]);

  const filteredPortfolio = useMemo(() => {
    if (assetClassFilter === "all") return portfolio;
    return (portfolio || []).filter(p => {
      const type = String(p.type || p.marketType || "").toLowerCase();
      if (assetClassFilter === "equities") return ["stock", "equity", "etf"].includes(type);
      if (assetClassFilter === "commodities") return ["commodity", "commodities", "future", "futures"].includes(type);
      if (assetClassFilter === "crypto") return type === "crypto";
      return false;
    });
  }, [portfolio, assetClassFilter]);

  const filteredOptionsTrades = useMemo(() => {
    if (assetClassFilter === "all" || assetClassFilter === "options") return activeOptionsTrades;
    return [];
  }, [activeOptionsTrades, assetClassFilter]);

  // ✅ 1) compute portfolioValue first
  const portfolioValue = useMemo(() => {
    return (filteredPortfolio || []).reduce((sum, item) => sum + ((Number(item?.price) || 0) * (Number(item?.quantity) || 0)), 0);
  }, [filteredPortfolio]);

// ✅ 2) compute metrics next
const derivedAccountMetrics = useMemo(
  () =>
    calculateAccountSnapshot({
      trades: filteredTrades,
      portfolioValue,
      balance: assetClassFilter === "all" ? balance : 0, // Only use cash balance for 'all' view
    }),
  [filteredTrades, portfolioValue, balance, assetClassFilter]
);

const activeAccountMetrics = accountMetrics || derivedAccountMetrics;
const initialBalance =
  Number(activeAccountMetrics?.initialBalance) || INITIAL_ACCOUNT_BALANCE;

const tradeTimeline = Array.isArray(activeAccountMetrics?.tradeTimeline)
  ? activeAccountMetrics.tradeTimeline
  : [];

// ✅ 3) now liveAvailableBalance exists
const liveAvailableBalance = Number.isFinite(
  Number(activeAccountMetrics?.liveAvailableBalance)
)
  ? Number(activeAccountMetrics.liveAvailableBalance)
  : initialBalance;

// ✅ 4) compute totalOptionsValue safely (NO undefined helpers)
const totalOptionsValue = (Array.isArray(filteredOptionsTrades)
  ? filteredOptionsTrades
  : []
).reduce((acc, trade) => {
  const chain = multiChainCache[trade.asset];
  const spot = spotPrices[trade.asset];
  const metrics = calculateOptionPnL(trade, chain, spot);
  const value = Number(metrics.pnl || 0);
  return acc + (Number.isFinite(value) ? value : 0);
}, 0);

const optionTimelineAdjustments = useMemo(() => {
  return (Array.isArray(filteredOptionsTrades) ? filteredOptionsTrades : [])
    .map((trade) => {
      const openedAtRaw = trade?.executedAt || trade?.openedAt || trade?.createdAt || trade?.date;
      const openedAt = new Date(openedAtRaw || 0).getTime();
      if (!Number.isFinite(openedAt) || openedAt <= 0) return null;
      const chain = multiChainCache?.[trade.asset];
      const spot = spotPrices?.[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      const currentPnl = Number(metrics?.pnl || 0);
      if (!Number.isFinite(currentPnl)) return null;
      return { openedAt, currentPnl };
    })
    .filter(Boolean)
    .sort((a, b) => a.openedAt - b.openedAt);
}, [activeOptionsTrades, multiChainCache, spotPrices]);

// ✅ 5) now totalAccountEquity is safe
const totalAccountEquity =
  liveAvailableBalance + portfolioValue + totalOptionsValue;

// keep your existing name
const currentAccountEquity = totalAccountEquity;

const isProfitable = currentAccountEquity >= initialBalance;
  const chartColor = chartMode === "pnl" ? (isProfitable ? "#22c55e" : "#ef4444") : "#38bdf8";

  const chartData = useMemo(() => {
    const pointCountMap = { "1D": 24, "1W": 7, "1M": 30, "3M": 90, "1Y": 52, "ALL": 120, "YTD": 52, "5Y": 60, "MAX": 120 };
    const points = pointCountMap[chartInterval] || 24;
    const now = Date.now();
    const start = (() => {
      if (chartInterval === "1D") return now - 24 * 60 * 60 * 1000;
      if (chartInterval === "1W") return now - 7 * 24 * 60 * 60 * 1000;
      if (chartInterval === "1M") return now - 30 * 24 * 60 * 60 * 1000;
      if (chartInterval === "3M") return now - 90 * 24 * 60 * 60 * 1000;
      if (chartInterval === "1Y") return now - 365 * 24 * 60 * 60 * 1000;
      if (chartInterval === "ALL") {
        const firstTradeTs = tradeTimeline[0]?.t;
        return Number.isFinite(firstTradeTs) ? firstTradeTs : now - 365 * 24 * 60 * 60 * 1000;
      }
      if (chartInterval === "YTD") {
        const d = new Date(now);
        return new Date(d.getFullYear(), 0, 1).getTime();
      }
      if (chartInterval === "5Y") return now - 5 * 365 * 24 * 60 * 60 * 1000;
      const firstTradeTs = tradeTimeline[0]?.t;
      return Number.isFinite(firstTradeTs) ? firstTradeTs : now - 30 * 24 * 60 * 60 * 1000;
    })();

    const inRangeTrades = tradeTimeline.filter((trade) => trade.t >= start && trade.t <= now && Number.isFinite(trade.equity));
    const beforeRangeTrade = [...tradeTimeline]
      .reverse()
      .find((trade) => trade.t < start && Number.isFinite(trade.equity));
    const startEquity = Number.isFinite(beforeRangeTrade?.equity) ? beforeRangeTrade.equity : initialBalance;

    const optionOpenAnchors = optionTimelineAdjustments.map((entry, idx) => ({
      t: entry.openedAt,
      equity: Number.isFinite(beforeRangeTrade?.equity) ? beforeRangeTrade.equity : startEquity,
      id: `opt-open-${idx}`
    }));

    const anchors = [
      { t: start, equity: startEquity },
      ...inRangeTrades.map((trade) => ({ t: trade.t, equity: trade.equity })),
      ...optionOpenAnchors.filter((entry) => entry.t >= start && entry.t <= now),
      { t: now, equity: currentAccountEquity }
    ].sort((a, b) => a.t - b.t);

    let anchorIdx = 0;
    const step = points > 1 ? (now - start) / (points - 1) : 0;

    const getOptionAdjustmentAt = (timestamp) => {
      return optionTimelineAdjustments.reduce((sum, entry) => {
        if (timestamp <= entry.openedAt) return sum;
        const horizon = Math.max(1, now - entry.openedAt);
        const progress = Math.max(0, Math.min(1, (timestamp - entry.openedAt) / horizon));
        return sum + (entry.currentPnl * progress);
      }, 0);
    };

    const toSeriesValue = (equity) => {
      // Convert equity from USD to displayCurrency
      const convertedEquity = displayCurrency === "USD" ? equity : convertFromUSD(equity, displayCurrency, spotPrices);
      const convertedInitial = displayCurrency === "USD" ? initialBalance : convertFromUSD(initialBalance, displayCurrency, spotPrices);

      if (chartMode === "percentage") return ((equity - initialBalance) / initialBalance) * 100;
      if (chartMode === "equity") return convertedEquity;
      return convertedEquity - convertedInitial;
    };

    return Array.from({ length: points }, (_, i) => {
      const t = start + step * i;
      while (anchorIdx + 1 < anchors.length && anchors[anchorIdx + 1].t <= t) {
        anchorIdx += 1;
      }
      const baseEquity = Number(anchors[anchorIdx]?.equity ?? initialBalance);
      const equity = baseEquity + getOptionAdjustmentAt(t);
      return [
        t,
        Number(toSeriesValue(equity).toFixed(2))
      ];
    });
  }, [chartInterval, chartMode, tradeTimeline, currentAccountEquity, optionTimelineAdjustments, initialBalance, displayCurrency, spotPrices]);
  const cashBalances = useMemo(() => {
    const balances = { USD: liveAvailableBalance };
    (Array.isArray(trades) ? trades : []).forEach(t => {
      const curr = t.currency || t.quotedCurrency || "USD";
      if (curr === "USD") return;
      const amount = (Number(t.price) || 0) * (Number(t.quantity) || 0);
      if (String(t.orderType || t.side).toLowerCase() === "sell") {
        balances[curr] = (balances[curr] || 0) + amount;
      } else {
        balances[curr] = (balances[curr] || 0) - amount;
      }
    });
    return balances;
  }, [trades, liveAvailableBalance]);

  const yFormatter = (val) => {
    if (chartMode === "percentage") return `${val.toFixed(2)}%`;
    return formatCurrency(val, displayCurrency, { sign: chartMode === "pnl" });
  };

  const diversificationRows = useMemo(() => {
    const stockLikeHoldings = (Array.isArray(portfolio) ? portfolio : []).filter((item) => {
      const type = String(item?.type || "").trim().toLowerCase();
      return ["stock", "stocks", "equity", "etf", "etfs"].includes(type) || !!item?.theme;
    });
    const source = stockLikeHoldings.length > 0 ? stockLikeHoldings : (Array.isArray(portfolio) ? portfolio : []);
    const totalExposure = source.reduce(
      (sum, item) => sum + ((Number(item?.price) || 0) * (Number(item?.quantity) || 0)),
      0
    );
    const grouped = new Map();

    source.forEach((item) => {
      const theme = String(item?.theme || item?.type || "Unassigned").trim() || "Unassigned";
      const value = (Number(item?.price) || 0) * (Number(item?.quantity) || 0);
      const row = grouped.get(theme) || {
        theme,
        positions: 0,
        value: 0,
        symbols: []
      };
      row.positions += 1;
      row.value += value;
      const symbol = String(item?.symbol || "").trim().toUpperCase();
      if (symbol && !row.symbols.includes(symbol)) row.symbols.push(symbol);
      grouped.set(theme, row);
    });

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        weight: totalExposure > 0 ? (row.value / totalExposure) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);
  }, [portfolio]);

  const attributionRows = useMemo(() => {
    const bySector = new Map();
    const byRegion = new Map();
    const byFactor = new Map();
    (Array.isArray(filteredPortfolio) ? filteredPortfolio : []).forEach((item) => {
      const qty = Number(item?.quantity || 0);
      const px = Number(item?.price || 0);
      const value = qty * px;
      const entry = Number(item?.entryPrice || px || 0);
      const pnl = value - (entry * qty);
      const sector = String(item?.theme || item?.sector || "Unclassified");
      const region = String(item?.region || item?.country || "Global");
      const factor = String(item?.factor || item?.style || (Number(item?.beta || 1) > 1.1 ? "High Beta" : "Core"));
      bySector.set(sector, (bySector.get(sector) || 0) + pnl);
      byRegion.set(region, (byRegion.get(region) || 0) + pnl);
      byFactor.set(factor, (byFactor.get(factor) || 0) + pnl);
    });
    const toRows = (map, group) => [...map.entries()].map(([name, pnl]) => ({ group, name, pnl })).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    return {
      sector: toRows(bySector, "Sector"),
      region: toRows(byRegion, "Region"),
      factor: toRows(byFactor, "Factor")
    };
  }, [portfolio]);

  const exposureRows = useMemo(() => {
    const groups = {
      sector: new Map(),
      country: new Map(),
      currency: new Map()
    };
    let total = 0;
    (Array.isArray(portfolio) ? portfolio : []).forEach((item) => {
      const value = (Number(item?.price || 0) * Number(item?.quantity || 0));
      total += value;
      const sector = String(item?.theme || item?.sector || "Unclassified");
      const country = String(item?.country || item?.region || "Global");
      const currency = String(item?.currency || "USD");
      groups.sector.set(sector, (groups.sector.get(sector) || 0) + value);
      groups.country.set(country, (groups.country.get(country) || 0) + value);
      groups.currency.set(currency, (groups.currency.get(currency) || 0) + value);
    });
    const normalize = (map, bucket) =>
      [...map.entries()]
        .map(([name, value]) => ({
          bucket,
          name,
          value,
          weight: total > 0 ? (value / total) * 100 : 0
        }))
        .sort((a, b) => b.weight - a.weight);
    return [...normalize(groups.sector, "Sector"), ...normalize(groups.country, "Country"), ...normalize(groups.currency, "Currency")];
  }, [portfolio]);

  const attributionSummary = useMemo(() => {
    const sectorTop = attributionRows?.sector?.[0] || null;
    const regionTop = attributionRows?.region?.[0] || null;
    return {
      sectorTop,
      regionTop
    };
  }, [attributionRows]);

  const attributionFlowData = useMemo(() => {
    const allRows = [
      ...(Array.isArray(attributionRows?.sector) ? attributionRows.sector : []),
      ...(Array.isArray(attributionRows?.region) ? attributionRows.region : []),
      ...(Array.isArray(attributionRows?.factor) ? attributionRows.factor : [])
    ].filter((row) => Number.isFinite(Number(row?.pnl)));
    const positive = [...allRows].filter((row) => Number(row.pnl) >= 0).sort((a, b) => Number(b.pnl) - Number(a.pnl));
    const negative = [...allRows].filter((row) => Number(row.pnl) < 0).sort((a, b) => Number(a.pnl) - Number(b.pnl));
    const top = (positive[0] || negative[0] || null);
    return {
      positive: positive.slice(0, 4),
      negative: negative.slice(0, 4),
      top
    };
  }, [attributionRows]);

  const exposureFlowData = useMemo(() => {
    const sectors = exposureRows
      .filter((row) => String(row?.bucket || "").toLowerCase() === "sector")
      .sort((a, b) => Number(b.weight || 0) - Number(a.weight || 0));
    const classify = (weight) => {
      if (weight >= 50) return "very-high";
      if (weight >= 25) return "high";
      if (weight >= 10) return "moderate";
      return "low";
    };
    const byRisk = sectors.map((row) => ({
      ...row,
      risk: classify(Number(row.weight || 0))
    }));
    return {
      sectors: byRisk,
      top: byRisk[0] || null
    };
  }, [exposureRows]);

  // Performance Metrics
  const metrics = useMemo(() => {
    const EPS = 1e-8;
    const annualization = Math.sqrt(252);
    const riskFreeDaily = 0.0425 / 252;
    const formatMetric = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "N/A");

    const equityPoints = [
      { t: Date.now(), equity: currentAccountEquity },
      ...tradeTimeline
        .filter((point) => Number.isFinite(point?.equity))
        .map((point) => ({ t: Number(point.t) || 0, equity: Number(point.equity) }))
    ]
      .filter((point) => Number.isFinite(point.equity) && point.equity > 0)
      .sort((a, b) => a.t - b.t);

    if (equityPoints.length < 2) {
      return {
        sharpe: "N/A",
        sortino: "N/A",
        maxDrawdown: "0.00",
        alpha: "N/A",
        beta: "N/A"
      };
    }

    const returns = [];
    for (let i = 1; i < equityPoints.length; i += 1) {
      const prev = equityPoints[i - 1].equity;
      const next = equityPoints[i].equity;
      if (prev <= EPS || !Number.isFinite(prev) || !Number.isFinite(next)) continue;
      const r = (next / prev) - 1;
      if (Number.isFinite(r)) returns.push(r);
    }

    const meanReturn = returns.length
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length
      : NaN;
    const variance = returns.length > 1
      ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1)
      : NaN;
    const stdDev = Number.isFinite(variance) && variance > EPS ? Math.sqrt(variance) : NaN;

    const downsideSquares = returns.map((r) => Math.min(0, r - riskFreeDaily) ** 2);
    const downsideVariance = downsideSquares.length
      ? downsideSquares.reduce((sum, v) => sum + v, 0) / downsideSquares.length
      : NaN;
    const downsideDeviation = Number.isFinite(downsideVariance) && downsideVariance > EPS ? Math.sqrt(downsideVariance) : NaN;

    const sharpe = Number.isFinite(stdDev) ? ((meanReturn - riskFreeDaily) / stdDev) * annualization : NaN;
    const sortino = Number.isFinite(downsideDeviation) ? ((meanReturn - riskFreeDaily) / downsideDeviation) * annualization : NaN;

    let peak = equityPoints[0].equity;
    let maxDrawdown = 0;
    equityPoints.forEach((point) => {
      peak = Math.max(peak, point.equity);
      const drawdown = peak > EPS ? ((peak - point.equity) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    return {
      sharpe: formatMetric(sharpe),
      sortino: formatMetric(sortino),
      maxDrawdown: formatMetric(maxDrawdown),
      alpha: "N/A",
      beta: "N/A"
    };
  }, [tradeTimeline, currentAccountEquity]);

  const predictionMarketRows = useMemo(() => {
    const source = Array.isArray(trades) ? trades : [];
    const predictionTrades = source
      .filter((trade) => {
        const mt = String(trade?.marketType || "").toLowerCase();
        return ["prediction", "polymarket", "yesno"].includes(mt);
      })
      .map((trade) => {
        const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
        const qty = Math.abs(Number(trade?.quantity) || 0);
        const price = Number(trade?.price) || 0;
        const ts = new Date(trade?.executedAt || trade?.date || 0).getTime() || 0;
        const market = String(trade?.name || trade?.asset || "Unknown Market").trim();
        return { market, side, qty, price, ts };
      })
      .filter((trade) => trade.qty > 0 && trade.price >= 0 && trade.market)
      .sort((a, b) => a.ts - b.ts);

    if (!predictionTrades.length) return [];

    const byMarket = new Map();
    predictionTrades.forEach((trade) => {
      const row = byMarket.get(trade.market) || {
        market: trade.market,
        netQty: 0,
        netCost: 0,
        realizedPnl: 0,
        lastPrice: 0,
        lastTs: 0
      };
      if (trade.side === "buy") {
        row.netQty += trade.qty;
        row.netCost += trade.qty * trade.price;
      } else {
        const qtyToClose = Math.min(row.netQty, trade.qty);
        const avgCost = row.netQty > 0 ? row.netCost / row.netQty : 0;
        row.realizedPnl += qtyToClose * (trade.price - avgCost);
        row.netQty -= qtyToClose;
        row.netCost -= qtyToClose * avgCost;
      }
      row.lastPrice = trade.price;
      row.lastTs = trade.ts;
      byMarket.set(trade.market, row);
    });

    return [...byMarket.values()]
      .map((row) => {
        const avgOpenCost = row.netQty > 0 ? row.netCost / row.netQty : 0;
        const unrealizedPnl = row.netQty > 0 ? row.netQty * (row.lastPrice - avgOpenCost) : 0;
        const pnl = row.realizedPnl + unrealizedPnl;
        return { market: row.market, pnl, netQty: row.netQty, updatedAt: row.lastTs };
      })
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }, [trades]);

  const combinedHoldings = useMemo(() => {
    const spotRows = (Array.isArray(filteredPortfolio) ? filteredPortfolio : []).map((item, index) => {
      const currency = item?.currency || item?.quotedCurrency || "USD";
      const rawValue = (Number(item?.price) || 0) * (Number(item?.quantity) || 0);
      const positionValue = convertToUSD(rawValue, currency, spotPrices);
      const symbolKey = String(item?.symbol || item?.name || "unknown").trim().toUpperCase();
      const marketKey = String(item?.marketType || item?.type || "spot").trim().toLowerCase();
      const fallbackKey = `${symbolKey}-${marketKey}-${Number(item?.quantity) || 0}-${index}`;

      const entryPrice = Number(item?.entryPrice);
      const basisPrice = Number.isFinite(entryPrice) ? entryPrice : Number(item?.price) || 0;
      const rawGain = rawValue - (basisPrice * (Number(item?.quantity) || 0));
      const positionGain = convertToUSD(rawGain, currency, spotPrices);

      return {
        kind: "spot",
        key: `spot-${item?.id ?? item?.clientId ?? fallbackKey}`,
        positionValue,
        positionGain,
        rawValue,
        currency,
        row: item
      };
    });

    const optionRows = (Array.isArray(filteredOptionsTrades) ? filteredOptionsTrades : []).map((trade) => {
      const chain = multiChainCache[trade.asset];
      const spot = spotPrices[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      const currentMark = Number(metrics?.currentMark || 0);
      const qty = Number(trade?.qty || trade?.quantity || 1);
      const pnl = Number(metrics?.pnl || 0);

      // Options are usually quoted in the underlying's currency or USD.
      // For now assuming USD for options unless they are crypto options where PnL might be in coins.
      // But calculateOptionPnL already returns USD values usually.

      return {
        kind: "options",
        key: `opt-${trade.id}`,
        positionValue: Math.abs(currentMark * qty),
        positionGain: pnl,
        row: trade,
        metrics
      };
    });

    return [...spotRows, ...optionRows].sort((a, b) => (b.positionValue || 0) - (a.positionValue || 0));
  }, [filteredPortfolio, filteredOptionsTrades, multiChainCache, spotPrices]);

  const sortedHoldings = useMemo(() => {
    const score = (row) => {
      if (holdingsSortBy === "value") return Number(row.positionValue || 0);
      if (holdingsSortBy === "pnl") return Number(row.positionGain || 0);
      if (holdingsSortBy === "return") {
        const base = row.kind === "spot"
          ? (Number(row.row?.entryPrice || row.row?.price || 0) * Number(row.row?.quantity || 0))
          : Math.abs(Number(row.row?.netPremiumAtEntry || 0) * Number(row.row?.qty || row.row?.quantity || 1));
        return base > 0 ? (Number(row.positionGain || 0) / base) * 100 : 0;
      }
      if (holdingsSortBy === "risk") return Math.abs(Number(row.positionGain || 0));
      return Number(row.positionValue || 0);
    };
    return [...combinedHoldings].sort((a, b) => score(b) - score(a));
  }, [combinedHoldings, holdingsSortBy]);

  const benchmarkSeries = useMemo(() => {
    const drift = benchmarkSymbol === "SPY" ? 0.0008 : benchmarkSymbol === "ACWI" ? 0.0006 : 0.0005;
    if (!Array.isArray(chartData) || chartData.length === 0) return [];

    return chartData.map((point, idx) => {
      const t = point[0];
      const multiplier = Math.pow(1 + drift, idx);
      let value = 0;

      if (chartMode === "equity") {
        const startValue = displayCurrency === "USD" ? initialBalance : convertFromUSD(initialBalance, displayCurrency, spotPrices);
        value = startValue * multiplier;
      } else if (chartMode === "percentage") {
        value = (multiplier - 1) * 100;
      } else {
        // Cash PnL mode
        const benchmarkPnL = initialBalance * (multiplier - 1);
        value = displayCurrency === "USD" ? benchmarkPnL : convertFromUSD(benchmarkPnL, displayCurrency, spotPrices);
      }
      return [t, Number(value.toFixed(2))];
    });
  }, [chartData, benchmarkSymbol, chartMode, displayCurrency, initialBalance, spotPrices]);

  const portfolioPerformanceSeries = useMemo(() => {
    const toData = (points) => points
      .map(([time, value]) => ({
        time: Math.floor(Number(time) / 1000),
        value: Number(value)
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value));
    const priceFormat = {
      type: "custom",
      minMove: 0.01,
      formatter: yFormatter
    };
    return [
      {
        name: chartMode === "percentage" ? "% Gain" : chartMode === "pnl" ? "Cash PnL" : "Equity Curve",
        type: "area",
        color: chartColor,
        data: toData(chartData),
        options: { priceFormat }
      },
      {
        name: benchmarkSymbol,
        type: "line",
        color: "#f59e0b",
        data: toData(benchmarkSeries),
        includeInReadout: false,
        options: { lineWidth: 1, priceFormat }
      }
    ];
  }, [benchmarkSeries, benchmarkSymbol, chartColor, chartData, chartMode]);

  const portfolioPerformanceLines = useMemo(() => [{
    id: "portfolio-baseline",
    price: chartMode === "equity" ? initialBalance : 0,
    title: chartMode === "equity" ? "Start" : "Break-even",
    color: "rgba(148,163,184,0.72)"
  }], [chartMode, initialBalance]);

  const portfolioChartOptions = useMemo(() => ({
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.12, bottom: 0.12 }
    }
  }), []);

  const formatPortfolioChartTime = (time) => new Date(Number(time) * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  const rebalanceSuggestions = useMemo(() => {
    const holdings = sortedHoldings.filter((row) => row.kind === "spot");
    const total = holdings.reduce((sum, row) => sum + Number(row.positionValue || 0), 0);
    if (!holdings.length || total <= 0) return [];

    // Equal weight target for simplicity in this example
    const targetBase = 100 / holdings.length;

    return holdings.map((row) => {
      const assetPrice = Number(row?.row?.price || 0);
      const ownedQuantity = Number(row?.row?.quantity || 0);
      const current = (Number(row.positionValue || 0) / total) * 100;
      const drift = current - targetBase;
      const action = drift > 2 ? "Trim" : drift < -2 ? "Add" : "Hold";
      const tradeValue = Math.abs(drift / 100) * total;
      const rawTradeQuantity = assetPrice > 0 ? tradeValue / assetPrice : 0;
      const tradeQuantity = action === "Trim"
        ? Math.min(ownedQuantity, rawTradeQuantity)
        : rawTradeQuantity;

      return {
        symbol: row.row?.symbol || row.row?.asset || "—",
        name: row.row?.name || row.row?.symbol || row.row?.asset || "—",
        type: String(row.row?.type || "stock").toLowerCase(),
        marketType: String(row.row?.marketType || row.row?.type || "equity").toLowerCase(),
        quantity: ownedQuantity,
        price: assetPrice,
        current,
        target: targetBase,
        drift,
        action,
        tradeValue,
        tradeQuantity: Number.isFinite(tradeQuantity) ? Number(tradeQuantity.toFixed(8)) : 0
      };
    }).sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  }, [sortedHoldings]);

  const rebalanceMetrics = useMemo(() => {
    const trades = rebalanceSuggestions.filter((s) => s.action !== "Hold" && Number(s.tradeQuantity) > 0 && Number(s.price) > 0);
    const totalDrift = rebalanceSuggestions.reduce((sum, s) => sum + Math.abs(s.drift), 0) / 2;
    const tradeVolume = trades.reduce((sum, s) => sum + s.tradeValue, 0);

    return {
      tradesRequired: trades.length,
      totalDrift,
      tradeVolume,
      estimatedFees: Number(rebalanceEstimate?.summary?.fees || 0),
      estimatedSlippage: Number(rebalanceEstimate?.summary?.slippage || 0),
      estimatedCostImpact: Number(rebalanceEstimate?.summary?.totalCostImpact || 0)
    };
  }, [rebalanceEstimate, rebalanceSuggestions]);

  const actionableRebalanceRows = useMemo(
    () => rebalanceSuggestions.filter((row) => row.action !== "Hold" && Number(row.tradeQuantity) > 0 && Number(row.price) > 0),
    [rebalanceSuggestions]
  );

  useEffect(() => {
    if (activeInsightFlow !== "rebalancing") return;
    if (!actionableRebalanceRows.length) {
      setRebalanceEstimate(null);
      setRebalanceEstimateStatus("empty");
      return;
    }
    if (!isSignedIn || typeof onEstimateRebalance !== "function") {
      setRebalanceEstimate(null);
      setRebalanceEstimateStatus(isSignedIn ? "idle" : "guest");
      return;
    }

    let cancelled = false;
    setRebalanceEstimateStatus("loading");

    onEstimateRebalance(actionableRebalanceRows)
      .then((result) => {
        if (cancelled) return;
        setRebalanceEstimate(result);
        setRebalanceEstimateStatus("ready");
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn("Rebalance estimate unavailable.", error);
        setRebalanceEstimate(null);
        setRebalanceEstimateStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [activeInsightFlow, actionableRebalanceRows, isSignedIn, onEstimateRebalance]);

  const formatMoney = (value, currency = "USD") => {
    return formatCurrency(value, currency);
  };

  const formatSignedMoney = (value, currency = "USD") => {
    return formatCurrency(value, currency, { sign: true });
  };

  const stablecoinSymbols = useMemo(
    () => new Set(["USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USDE", "USDD"]),
    []
  );

  const exposureSummary = useMemo(() => {
    const pickTop = (bucket) => exposureRows.find((row) => String(row.bucket || "").toLowerCase() === bucket) || null;
    return {
      sector: pickTop("sector"),
      country: pickTop("country"),
      currency: pickTop("currency")
    };
  }, [exposureRows]);

  const bestPerformer = useMemo(() => {
    const rows = Array.isArray(filteredPortfolio) ? filteredPortfolio : [];
    if (!rows.length) return null;
    return [...rows].sort((a, b) => Number(b?.priceChangePercent || 0) - Number(a?.priceChangePercent || 0))[0];
  }, [filteredPortfolio]);

  const holdingsTableRows = useMemo(() => {
    const total = sortedHoldings.reduce((sum, row) => sum + Number(row?.positionValue || 0), 0);
    return sortedHoldings.map((holding) => {
      if (holding.kind === "spot") {
        const item = holding.row;
        const symbol = String(item?.symbol || "N/A").toUpperCase();
        const quantity = Number(item?.quantity || 0);
        const allocation = total > 0 ? (Number(holding.positionValue || 0) / total) * 100 : 0;
        const isStable = stablecoinSymbols.has(symbol) || String(item?.type || "").toLowerCase() === "stablecoin";
        const status = isStable ? "Cash" : "Hold";
        return {
          key: holding.key,
          kind: "spot",
          symbol,
          name: item?.name || symbol,
          allocation,
          positionValue: Number(holding.positionValue || 0),
          positionGain: Number(holding.positionGain || 0),
          markValueMain: holding.kind === "spot" ? formatCurrency(holding.rawValue, holding.currency) : formatCurrency(holding.positionValue, "USD"),
          markValueSub: `${quantity.toFixed(4)} ${symbol}`,
          pnlMain: formatSignedMoney(holding.positionGain),
          pnlSub: `${Number(item?.priceChangePercent || 0) >= 0 ? "+" : ""}${Number(item?.priceChangePercent || 0).toFixed(2)}%`,
          pnlPositive: Number(holding.positionGain || 0) >= 0,
          status,
          statusClass: status.toLowerCase(),
          fundingRate: item?.fundingRate,
          openInterest: item?.openInterest,
          marketType: item?.marketType,
          raw: item
        };
      }

      const trade = holding.row;
      const symbol = String(trade?.asset || "OPT").toUpperCase();
      const qty = Number(trade?.qty || trade?.quantity || 0);
      const allocation = total > 0 ? (Number(holding.positionValue || 0) / total) * 100 : 0;
      const pnl = Number(holding.positionGain || 0);
      const base = Math.abs(Number(trade?.netPremiumAtEntry || 0) * Math.max(1, qty));
      const pct = base > 0 ? (pnl / base) * 100 : 0;
      return {
        key: holding.key,
        kind: "options",
        symbol,
        name: trade?.strategy || "Options",
        allocation,
        positionValue: Number(holding.positionValue || 0),
        positionGain: pnl,
        markValueMain: formatMoney(holding.positionValue),
        markValueSub: `${qty.toFixed(5)} Units`,
        pnlMain: formatSignedMoney(pnl),
        pnlSub: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        pnlPositive: pnl >= 0,
        status: "Options",
        statusClass: "options",
        raw: trade
      };
    });
  }, [sortedHoldings, stablecoinSymbols]);

  const recentActivityRows = useMemo(() => {
    const rows = (Array.isArray(trades) ? trades : [])
      .map((trade) => {
        const ts = new Date(trade?.executedAt || trade?.date || 0).getTime();
        const qty = Number(trade?.quantity || 0);
        const notional = Number(trade?.notional || (Number(trade?.price || 0) * qty));
        const symbol = String(trade?.asset || "Asset").toUpperCase();
        const isSell = String(trade?.side || trade?.type || "").toLowerCase() === "sell";
        return {
          id: trade?.id || `${symbol}-${ts}`,
          symbol,
          side: isSell ? "Sell" : "Buy",
          tone: isSell ? "sell" : "buy",
          ts,
          qty: Math.abs(qty),
          notional: Number.isFinite(notional) ? Math.abs(notional) : 0
        };
      })
      .filter((row) => Number.isFinite(row.ts) && row.ts > 0)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 4);

    const now = Date.now();
    return rows.map((row) => {
      const hours = Math.floor((now - row.ts) / (60 * 60 * 1000));
      const when = hours >= 24 ? `${Math.floor(hours / 24)}d ago` : hours >= 1 ? `${hours}h ago` : "just now";
      return { ...row, when };
    });
  }, [trades]);

  const feeDashboard = useMemo(() => {
    const normalizeSummary = (summary) => {
      if (!summary || typeof summary !== "object") return null;
      return {
        tradeCount: Number(summary.tradeCount || 0),
        fillCount: Number(summary.fillCount || 0),
        totalFeesByCurrency: Array.isArray(summary.totalFeesByCurrency) ? summary.totalFeesByCurrency : [],
        platforms: Array.isArray(summary.platforms)
          ? summary.platforms.map((row) => ({
            ...row,
            feeSources: Array.isArray(row?.feeSources) ? row.feeSources.map((source) => normalizeFeeSourceValue(source)) : [],
            feesByCurrency: Array.isArray(row?.feesByCurrency) ? row.feesByCurrency : []
          }))
          : [],
        sources: Array.isArray(summary.sources)
          ? summary.sources.map((row) => ({
            ...row,
            source: normalizeFeeSourceValue(row?.source),
            feesByCurrency: Array.isArray(row?.feesByCurrency) ? row.feesByCurrency : []
          }))
          : [],
        comparison: summary.comparison && typeof summary.comparison === "object"
          ? {
            benchmarkEligibleFillCount: Number(summary.comparison.benchmarkEligibleFillCount || 0),
            exchangeReported: summary.comparison.exchangeReported || null,
            cheapestAvenueObserved: summary.comparison.cheapestAvenueObserved || null,
            cheapestAvenueBenchmark: summary.comparison.cheapestAvenueBenchmark || null
          }
          : null,
        updatedAt: summary.updatedAt || null
      };
    };

    const fallbackSummary = (() => {
      const feeTrades = (Array.isArray(trades) ? trades : []).filter((trade) => Number(trade?.fee || 0) > 0);
      const currencyMap = new Map();
      const platformMap = new Map();
      const sourceMap = new Map();
      feeTrades.forEach((trade) => {
        const platform = String(trade?.platform || trade?.exchange || "zenin").toLowerCase();
        const currency = String(trade?.feeCurrency || trade?.currency || "USD").toUpperCase();
        const source = normalizeFeeSourceValue(
          trade?.feeSource,
          platform === "zenin" ? FEE_SOURCE_CHEAPEST_AVENUE : FEE_SOURCE_EXCHANGE_REPORTED
        );
        const amount = Math.abs(Number(trade?.fee || 0));
        currencyMap.set(currency, (currencyMap.get(currency) || 0) + amount);
        const platformRow = platformMap.get(platform) || { platform, tradeCount: 0, fillCount: 0, feesByCurrency: new Map(), feeSources: new Set(), lastExecutedAt: null };
        platformRow.tradeCount += 1;
        platformRow.fillCount += 1;
        platformRow.feesByCurrency.set(currency, (platformRow.feesByCurrency.get(currency) || 0) + amount);
        platformRow.feeSources.add(source);
        const executedAt = trade?.executedAt || trade?.date || null;
        if (!platformRow.lastExecutedAt || (executedAt && executedAt > platformRow.lastExecutedAt)) {
          platformRow.lastExecutedAt = executedAt;
        }
        platformMap.set(platform, platformRow);
        const sourceRow = sourceMap.get(source) || { source, tradeCount: 0, fillCount: 0, feesByCurrency: new Map(), lastExecutedAt: null };
        sourceRow.tradeCount += 1;
        sourceRow.fillCount += 1;
        sourceRow.feesByCurrency.set(currency, (sourceRow.feesByCurrency.get(currency) || 0) + amount);
        if (!sourceRow.lastExecutedAt || (executedAt && executedAt > sourceRow.lastExecutedAt)) {
          sourceRow.lastExecutedAt = executedAt;
        }
        sourceMap.set(source, sourceRow);
      });
      return {
        tradeCount: feeTrades.length,
        fillCount: feeTrades.length,
        totalFeesByCurrency: [...currencyMap.entries()].map(([currency, amount]) => ({ currency, amount })),
        platforms: [...platformMap.values()].map((row) => ({
          platform: row.platform,
          tradeCount: row.tradeCount,
          fillCount: row.fillCount,
          feeSources: [...row.feeSources],
          feesByCurrency: [...row.feesByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
          lastExecutedAt: row.lastExecutedAt
        })),
        sources: [...sourceMap.values()].map((row) => ({
          source: row.source,
          tradeCount: row.tradeCount,
          fillCount: row.fillCount,
          feesByCurrency: [...row.feesByCurrency.entries()].map(([currency, amount]) => ({ currency, amount })),
          lastExecutedAt: row.lastExecutedAt
        })),
        comparison: null,
        updatedAt: null
      };
    })();

    const remoteSummary = normalizeSummary(tradeFeeSummary);
    const summary = remoteSummary && (
      remoteSummary.tradeCount > 0 ||
      remoteSummary.fillCount > 0 ||
      remoteSummary.totalFeesByCurrency.length > 0
    )
      ? remoteSummary
      : fallbackSummary;
    const estimateCurrencyUsd = (amount, currency) => {
      const normalizedCurrency = String(currency || "USD").toUpperCase();
      const numericAmount = Math.abs(Number(amount || 0));
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) return { value: 0, convertible: true };
      if (["USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USDE", "USDD"].includes(normalizedCurrency)) {
        return { value: numericAmount, convertible: true };
      }
      if (Number.isFinite(Number(spotPrices?.[normalizedCurrency])) && Number(spotPrices[normalizedCurrency]) > 0) {
        return { value: numericAmount * Number(spotPrices[normalizedCurrency]), convertible: true };
      }
      if (Number.isFinite(Number(DEFAULT_FX_RATES?.[normalizedCurrency])) && Number(DEFAULT_FX_RATES[normalizedCurrency]) > 0) {
        return { value: numericAmount * Number(DEFAULT_FX_RATES[normalizedCurrency]), convertible: true };
      }
      return { value: 0, convertible: false };
    };

    const decorateBreakdown = (rows) => {
      const unknown = [];
      const totalUsd = (Array.isArray(rows) ? rows : []).reduce((sum, row) => {
        const estimate = estimateCurrencyUsd(row?.amount, row?.currency);
        if (!estimate.convertible) unknown.push(String(row?.currency || "UNK").toUpperCase());
        return sum + estimate.value;
      }, 0);
      const breakdown = (Array.isArray(rows) ? rows : [])
        .map((row) => `${formatCurrency(row?.amount || 0, row?.currency || "USD")} ${String(row?.currency || "USD").toUpperCase()}`)
        .join(" · ");
      return {
        estimatedUsd: totalUsd,
        unknownCurrencies: unknown,
        breakdown: breakdown || "No fees recorded"
      };
    };

    const decorateSummaryBucket = (bucket, fallbackSource = null) => {
      const normalizedBucket = bucket && typeof bucket === "object" ? bucket : {};
      const decorated = decorateBreakdown(normalizedBucket.feesByCurrency || []);
      return {
        source: fallbackSource ? normalizeFeeSourceValue(fallbackSource) : normalizeFeeSourceValue(normalizedBucket.source),
        tradeCount: Number(normalizedBucket.tradeCount || 0),
        fillCount: Number(normalizedBucket.fillCount || 0),
        lastExecutedAt: normalizedBucket.lastExecutedAt || null,
        ...decorated
      };
    };

    const total = decorateBreakdown(summary.totalFeesByCurrency);
    const platforms = (summary.platforms || []).map((row) => ({
      ...row,
      label: String(row?.platform || "zenin")
        .split(/[_\s-]+/)
        .filter(Boolean)
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join(" "),
      ...decorateBreakdown(row?.feesByCurrency || [])
    })).sort((a, b) => b.estimatedUsd - a.estimatedUsd);

    const sources = (summary.sources || []).map((row) => ({
      ...row,
      label: formatFeeSourceLabel(row?.source),
      ...decorateBreakdown(row?.feesByCurrency || [])
    })).sort((a, b) => b.estimatedUsd - a.estimatedUsd);

    const comparison = summary.comparison
      ? {
        benchmarkEligibleFillCount: Number(summary.comparison.benchmarkEligibleFillCount || 0),
        exchangeReported: decorateSummaryBucket(summary.comparison.exchangeReported, FEE_SOURCE_EXCHANGE_REPORTED),
        cheapestAvenueObserved: decorateSummaryBucket(summary.comparison.cheapestAvenueObserved, FEE_SOURCE_CHEAPEST_AVENUE),
        cheapestAvenueBenchmark: decorateSummaryBucket(summary.comparison.cheapestAvenueBenchmark, FEE_SOURCE_CHEAPEST_AVENUE)
      }
      : null;

    const comparisonDeltaUsd = comparison
      ? comparison.exchangeReported.estimatedUsd - comparison.cheapestAvenueBenchmark.estimatedUsd
      : 0;

    return {
      ...summary,
      estimatedUsd: total.estimatedUsd,
      breakdown: total.breakdown,
      unknownCurrencies: total.unknownCurrencies,
      platforms,
      sources,
      comparison,
      comparisonDeltaUsd
    };
  }, [tradeFeeSummary, trades, spotPrices]);

  const totalGainLoss = Number(calculatePortfolioGain?.() || 0);
  const totalReturnPct = initialBalance > 0 ? (totalGainLoss / initialBalance) * 100 : 0;
  const cashWeight = currentAccountEquity > 0 ? (liveAvailableBalance / currentAccountEquity) * 100 : 0;

  const performanceSnapshot = useMemo(() => {
    const values = Array.isArray(chartData)
      ? chartData.map((point) => Number(point?.[1])).filter((value) => Number.isFinite(value))
      : [];
    if (!values.length) {
      return {
        bestPeriod: "0.00%",
        worstPeriod: "0.00%",
        maxDrawdown: `${metrics.maxDrawdown}%`,
        currentDrawdown: "0.00%"
      };
    }
    const returns = [];
    values.forEach((value, index) => {
      if (index === 0) return;
      const prev = values[index - 1];
      if (!Number.isFinite(prev) || Math.abs(prev) < 1e-8) return;
      const delta = chartMode === "percentage" ? value - prev : ((value - prev) / Math.abs(prev)) * 100;
      if (Number.isFinite(delta)) returns.push(delta);
    });
    let peak = values[0];
    let maxDrawdown = 0;
    values.forEach((value) => {
      peak = Math.max(peak, value);
      const drawdown = peak > 0 ? ((peak - value) / peak) * 100 : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
    });
    const currentPeak = Math.max(...values);
    const latest = values[values.length - 1];
    const currentDrawdown = currentPeak > 0 ? ((currentPeak - latest) / currentPeak) * 100 : 0;
    const best = returns.length ? Math.max(...returns) : 0;
    const worst = returns.length ? Math.min(...returns) : 0;
    return {
      bestPeriod: `${best >= 0 ? "+" : ""}${best.toFixed(2)}%`,
      worstPeriod: `${worst >= 0 ? "+" : ""}${worst.toFixed(2)}%`,
      maxDrawdown: `${Number(metrics.maxDrawdown || maxDrawdown || 0).toFixed(2)}%`,
      currentDrawdown: `${Number(currentDrawdown || 0).toFixed(2)}%`
    };
  }, [chartData, chartMode, metrics.maxDrawdown]);

  const optionsGreekSummary = useMemo(() => {
    return (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []).reduce((summary, trade) => {
      const chain = multiChainCache?.[trade.asset];
      const spot = spotPrices?.[trade.asset];
      const pnl = calculateOptionPnL(trade, chain, spot);
      const qty = Math.max(1, Math.abs(Number(trade?.qty || trade?.quantity || 1)));
      const theta = Number(trade?.theta ?? trade?.greeks?.theta ?? pnl?.theta);
      const iv = Number(trade?.iv ?? trade?.impliedVolatility ?? trade?.greeks?.iv ?? pnl?.iv);
      return {
        theta: summary.theta + (Number.isFinite(theta) ? theta * qty : 0),
        ivTotal: summary.ivTotal + (Number.isFinite(iv) ? iv : 0),
        ivCount: summary.ivCount + (Number.isFinite(iv) ? 1 : 0)
      };
    }, { theta: 0, ivTotal: 0, ivCount: 0 });
  }, [activeOptionsTrades, multiChainCache, spotPrices]);

  const healthStatus = useMemo(() => {
    const topExposure = Math.max(
      Number(exposureSummary.sector?.weight || 0),
      Number(exposureSummary.country?.weight || 0),
      Number(exposureSummary.currency?.weight || 0)
    );
    const drift = Number(rebalanceMetrics.totalDrift || 0);
    const drawdown = Number(metrics.maxDrawdown || 0);
    if (topExposure >= 45 || drift >= 18 || drawdown >= 20) return { label: "WATCH", tone: "warning" };
    if (topExposure >= 30 || drift >= 10 || drawdown >= 10) return { label: "BALANCED", tone: "neutral" };
    return { label: "OPTIMAL", tone: "positive" };
  }, [exposureSummary, metrics.maxDrawdown, rebalanceMetrics.totalDrift]);

  const executiveStatRail = useMemo(() => {
    const averageIv = optionsGreekSummary.ivCount > 0 ? optionsGreekSummary.ivTotal / optionsGreekSummary.ivCount : null;
    return [
      { label: "Beta Weight", value: metrics.beta && metrics.beta !== "N/A" ? metrics.beta : "N/A", tone: "neutral" },
      { label: "Theta", value: optionsGreekSummary.theta ? formatSignedMoney(optionsGreekSummary.theta) : "N/A", tone: optionsGreekSummary.theta >= 0 ? "positive" : "negative" },
      { label: "B/P %", value: `${cashWeight.toFixed(1)}%`, tone: cashWeight >= 12 ? "positive" : "neutral" },
      { label: "Imp Vol", value: averageIv == null ? "N/A" : `${(averageIv * (averageIv > 1 ? 1 : 100)).toFixed(1)}%`, tone: "neutral" },
      { label: "Health", value: healthStatus.label, tone: healthStatus.tone }
    ];
  }, [cashWeight, healthStatus, metrics.beta, optionsGreekSummary, formatSignedMoney]);

  const operationalTriageRows = useMemo(() => {
    const topExposure = exposureSummary.sector || exposureSummary.country || exposureSummary.currency;
    const topRebalance = rebalanceSuggestions.find((row) => row.action !== "Hold") || rebalanceSuggestions[0] || null;
    const feeTone = feeDashboard.estimatedUsd > 0 ? "Alpha" : "Model";
    return [
      {
        kind: "Risk",
        title: topExposure ? `${topExposure.name} concentration` : "Exposure coverage",
        detail: topExposure ? `${topExposure.weight.toFixed(1)}% ${topExposure.bucket.toLowerCase()} allocation is leading the book.` : "Add positions to unlock concentration monitoring.",
        action: "Inspect",
        onClick: () => openInsightFlow("exposure", topExposure || null)
      },
      {
        kind: "Alpha",
        title: bestPerformer ? `${bestPerformer.symbol || bestPerformer.name} contribution` : "Wash sale potential",
        detail: bestPerformer ? `${Number(bestPerformer.priceChangePercent || 0) >= 0 ? "+" : ""}${Number(bestPerformer.priceChangePercent || 0).toFixed(2)}% leads current marked performance.` : "Tax-lot signals appear when realized loss candidates exist.",
        action: "Review",
        onClick: () => bestPerformer ? onSelectAsset?.(bestPerformer) : setShowDiversificationModal(true)
      },
      {
        kind: feeTone,
        title: topRebalance ? `${topRebalance.symbol} drift update` : "Theta update",
        detail: topRebalance ? `${topRebalance.action} ${Math.abs(topRebalance.drift).toFixed(2)}% drift against equal-weight target.` : "Options greek and rebalance alerts update with connected holdings.",
        action: "Open",
        onClick: () => openInsightFlow("rebalancing", topRebalance)
      }
    ];
  }, [bestPerformer, exposureSummary, feeDashboard.estimatedUsd, onSelectAsset, rebalanceSuggestions]);

  useEffect(() => {
    let cancelled = false;

    const applySavedView = (saved) => {
      if (saved && typeof saved === "object") {
        if (saved.chartMode) setChartMode(saved.chartMode);
        if (saved.chartInterval) setChartInterval(saved.chartInterval);
        if (saved.displayCurrency) setDisplayCurrency(saved.displayCurrency);
        if (saved.assetClassFilter) setAssetClassFilter(saved.assetClassFilter);
        if (saved.benchmarkSymbol) setBenchmarkSymbol(saved.benchmarkSymbol);
        if (saved.selectedTaxLotMethod) setSelectedTaxLotMethod(saved.selectedTaxLotMethod);
      }
    };

    const hydrateViewState = async () => {
      const localSaved = readStoredJson(PORTFOLIO_VIEW_STORAGE_KEY, null);
      applySavedView(localSaved);
      try {
        const remote = await loadWorkspaceDoc("portfolio:view_state", localSaved);
        if (cancelled) return;
        applySavedView(remote?.document);
      } catch (error) {
        if (!cancelled) {
          console.warn("Portfolio view sync unavailable.", error);
        }
      } finally {
        if (!cancelled) {
          prefsHydratedRef.current = true;
        }
      }
    };

    hydrateViewState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!prefsHydratedRef.current) return;
    const nextViewState = {
      chartMode,
      chartInterval,
      displayCurrency,
      assetClassFilter,
      benchmarkSymbol,
      selectedTaxLotMethod,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(PORTFOLIO_VIEW_STORAGE_KEY, JSON.stringify(nextViewState));
    saveWorkspaceDoc("portfolio:view_state", nextViewState).catch((error) => {
      console.warn("Portfolio view sync skipped.", error);
    });
  }, [chartMode, chartInterval, displayCurrency, assetClassFilter, benchmarkSymbol, selectedTaxLotMethod]);

  const insightFlowSteps = {
    attribution: ["Dashboard", "Overview", "Drilldown", "Insight Detail", "Action / Export"],
    exposure: ["Dashboard", "Overview", "Detailed Exposure", "Insights & Risk", "Portfolio Response"],
    rebalancing: ["Dashboard", "Overview", "Rebalance Plan", "Confirm Trades", "Success"]
  };

  const openInsightFlow = (flow, selection = null) => {
    setActiveInsightFlow(flow);
    setInsightFlowStep(selection ? 2 : 1);
    setFlowSelection(selection);
    setFlowBusy(false);
    setFlowActionLabel("");
    setFlowOutcome({ title: "", message: "", tone: "success" });
    if (flow !== "rebalancing") {
      setRebalanceEstimate(null);
      setRebalanceEstimateStatus("idle");
    }
  };

  const closeInsightFlow = () => {
    setActiveInsightFlow(null);
    setInsightFlowStep(1);
    setFlowSelection(null);
    setFlowBusy(false);
    setFlowActionLabel("");
    setFlowOutcome({ title: "", message: "", tone: "success" });
    setRebalanceEstimate(null);
    setRebalanceEstimateStatus("idle");
  };

  const openRelatedHoldingFromInsight = (selection = null) => {
    const target = selection || flowSelection;
    const targetName = String(target?.name || "").trim().toLowerCase();
    const targetSymbol = String(target?.symbol || target?.name || "").trim().toLowerCase();
    const match = combinedHoldings.find((holding) => {
      const row = holding?.row || {};
      const symbol = String(row?.symbol || row?.asset || "").trim().toLowerCase();
      const name = String(row?.name || row?.strategy || "").trim().toLowerCase();
      return (targetSymbol && symbol === targetSymbol) || (targetName && name === targetName);
    });

    if (!match) {
      setFlowOutcome({
        title: "No related holding found",
        message: "This insight is not tied to an active holding in your portfolio right now.",
        tone: "warning"
      });
      return;
    }

    const row = match.row || {};
    setSelectedHolding({
      symbol: String(row?.symbol || row?.asset || "N/A").toUpperCase(),
      quantity: Number(row?.quantity || row?.qty || 0),
      price: Number(row?.price || row?.currentMark || 0),
      positionValue: Number(match.positionValue || 0),
      positionGain: Number(match.positionGain || 0)
    });
    closeInsightFlow();
  };

  const runFlowProcessing = (doneStep, label, fromStep = insightFlowStep, onComplete = null) => {
    setFlowBusy(true);
    setFlowActionLabel(label);
    setInsightFlowStep(fromStep);
    window.setTimeout(async () => {
      try {
        await onComplete?.();
      } catch (error) {
        console.warn("Portfolio workflow action failed.", error);
        setFlowOutcome({
          title: "Action not completed",
          message: error?.message || "Zenin could not complete this workspace action.",
          tone: "error"
        });
      }
      setFlowBusy(false);
      setInsightFlowStep(doneStep);
    }, 0);
  };

  const downloadTextFile = (text, fileName, mimeType = "text/plain;charset=utf-8") => {
    const blob = new Blob([text], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  const saveJournalInsight = async (title, body, extra = {}) => {
    const existing = readStoredJson(JOURNAL_STORAGE_KEY, []);
    const rows = Array.isArray(existing) ? existing : [];
    const createdAt = new Date().toISOString();
    const symbol = String(extra.symbol || "").toUpperCase();
    const entry = {
      id: `jrnl-portfolio-${Date.now()}`,
      createdAt,
      symbol,
      tradeDate: createdAt,
      side: "NOTE",
      quantity: 0,
      price: 0,
      notional: 0,
      marketType: extra.marketType || "Insight",
      status: "Saved",
      strategy: title,
      setupTag: title,
      marketRegime: extra.marketRegime || "",
      timeframe: "swing",
      emotion: "neutral",
      confidence: 4,
      preThesis: body,
      postReview: "",
      mistakeCategory: "",
      learned: extra.learned || "",
      chartLink: ""
    };
    const nextEntries = [entry, ...rows].slice(0, 300);
    localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(nextEntries));
    await syncPortfolioCollection("journal:entries", nextEntries, 500);
    return entry;
  };

  const exportAttributionReport = async () => {
    const sections = Object.entries(attributionRows || {}).flatMap(([group, rows]) =>
      (Array.isArray(rows) ? rows : []).map((row) => [
        group,
        row?.name || "Unclassified",
        Number(row?.pnl || 0).toFixed(2)
      ])
    );
    const csv = [
      ["group", "name", "pnl_usd"].join(","),
      ...sections.map((row) => row.join(","))
    ].join("\n");
    const nextExports = appendStoredRecord(PORTFOLIO_EXPORTS_KEY, {
      id: `portfolio-export-${Date.now()}`,
      type: "attribution",
      createdAt: new Date().toISOString()
    }, 40);
    setSavedPortfolioExports(nextExports);
    await syncPortfolioCollection("portfolio:exports", nextExports, 40);
    downloadTextFile(csv, `portfolio-attribution-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    return nextExports[0];
  };

  const exportExposureReport = async () => {
    const csv = [
      ["bucket", "name", "weight_pct", "risk"].join(","),
      ...exposureRows.map((row) => [
        row.bucket,
        row.name,
        Number(row.weight || 0).toFixed(2),
        row.risk
      ].join(","))
    ].join("\n");
    const nextExports = appendStoredRecord(PORTFOLIO_EXPORTS_KEY, {
      id: `portfolio-export-${Date.now()}`,
      type: "exposure",
      createdAt: new Date().toISOString()
    }, 40);
    setSavedPortfolioExports(nextExports);
    await syncPortfolioCollection("portfolio:exports", nextExports, 40);
    downloadTextFile(csv, `portfolio-exposure-${new Date().toISOString().slice(0, 10)}.csv`, "text/csv;charset=utf-8");
    return nextExports[0];
  };

  const savePortfolioView = async (context = "portfolio") => {
    const nextViews = appendStoredRecord(PORTFOLIO_SAVED_VIEWS_KEY, {
      id: `portfolio-view-${Date.now()}`,
      createdAt: new Date().toISOString(),
      context,
      chartMode,
      chartInterval,
      displayCurrency,
      assetClassFilter,
      benchmarkSymbol,
      selectedTaxLotMethod
    }, 25);
    setSavedPortfolioViews(nextViews);
    await syncPortfolioCollection("portfolio:saved_views", nextViews, 25);
    return nextViews[0];
  };

  const saveExposureAlert = async (row) => {
    const nextAlerts = appendStoredRecord(PORTFOLIO_ALERTS_KEY, {
      id: `portfolio-alert-${Date.now()}`,
      createdAt: new Date().toISOString(),
      type: "exposure",
      bucket: row?.bucket || "Exposure",
      name: row?.name || "Portfolio",
      weight: Number(row?.weight || 0)
    }, 40);
    setSavedPortfolioAlerts(nextAlerts);
    await syncPortfolioCollection("portfolio:alerts", nextAlerts, 40);
    return nextAlerts[0];
  };

  const queuePortfolioRebalance = async (context = "portfolio-response") => {
    const nextQueue = appendStoredRecord(PORTFOLIO_REBALANCE_QUEUE_KEY, {
      id: `portfolio-rebalance-${Date.now()}`,
      createdAt: new Date().toISOString(),
      context,
      executionStatus: "preview_only",
      tradesRequired: rebalanceMetrics.tradesRequired,
      totalDrift: Number(rebalanceMetrics.totalDrift || 0),
      fees: Number(rebalanceMetrics.estimatedFees || 0),
      slippage: Number(rebalanceMetrics.estimatedSlippage || 0),
      totalCostImpact: Number(rebalanceMetrics.estimatedCostImpact || 0),
      suggestions: actionableRebalanceRows
    }, 20);
    setSavedPortfolioQueue(nextQueue);
    await syncPortfolioCollection("portfolio:rebalance_queue", nextQueue, 20);
    return nextQueue[0];
  };

  const recordRebalanceExecution = async (result) => {
    const nextHistory = appendStoredRecord(PORTFOLIO_REBALANCE_HISTORY_KEY, {
      id: `portfolio-rebalance-history-${Date.now()}`,
      createdAt: new Date().toISOString(),
      status: result?.mode || (result?.ok ? "executed" : "error"),
      summary: result?.summary || null,
      trades: Array.isArray(result?.trades) ? result.trades : []
    }, 30);
    setSavedPortfolioHistory(nextHistory);
    await syncPortfolioCollection("portfolio:rebalance_history", nextHistory, 30);
    return nextHistory[0];
  };

  const handleConfirmRebalance = async () => {
    if (!actionableRebalanceRows.length) {
      setFlowOutcome({
        title: "No rebalance needed",
        message: "There are no actionable trades to submit right now.",
        tone: "warning"
      });
      setInsightFlowStep(5);
      return;
    }

    if (!isSignedIn || typeof onExecuteRebalance !== "function") {
      setFlowBusy(true);
      setFlowActionLabel(`Saving rebalance preview to ${getSaveTargetLabel()}...`);
      try {
        await queuePortfolioRebalance("guest-preview");
      } finally {
        setFlowBusy(false);
      }
      setFlowOutcome({
        title: "Guest preview only",
        message: `No trades were executed. The preview was saved in ${getSaveTargetLabel()}; sign in to submit this rebalance through Zenin.`,
        tone: "warning"
      });
      setInsightFlowStep(5);
      return;
    }

    setFlowBusy(true);
    setFlowActionLabel("Submitting authenticated rebalance orders...");

    try {
      const result = await onExecuteRebalance(actionableRebalanceRows);
      await recordRebalanceExecution(result);

      if (result?.ok) {
        setFlowOutcome({
          title: "Rebalance executed",
          message: `Submitted ${result?.summary?.tradeCount || actionableRebalanceRows.length} trades. Platform fees ${formatMoney(result?.summary?.fees || 0)} and slippage ${formatMoney(result?.summary?.slippage || 0)} were recorded in trade history.`,
          tone: "success"
        });
      } else if (result?.mode === "partial") {
        setFlowOutcome({
          title: "Rebalance partially completed",
          message: `${result?.trades?.length || 0} trades were filled before execution stopped. Your portfolio and trade history were refreshed from the latest saved state.`,
          tone: "warning"
        });
      } else {
        setFlowOutcome({
          title: "Rebalance not completed",
          message: result?.message || "Zenin could not complete the rebalance.",
          tone: "warning"
        });
      }
    } catch (error) {
      setFlowOutcome({
        title: "Rebalance failed",
        message: error?.message || "Zenin could not submit the rebalance.",
        tone: "error"
      });
    } finally {
      setFlowBusy(false);
      setInsightFlowStep(5);
    }
  };

  const savedWorkspaceCount =
    savedPortfolioViews.length +
    savedPortfolioAlerts.length +
    savedPortfolioQueue.length +
    savedPortfolioHistory.length +
    savedPortfolioExports.length;

  const formatSignedPercent = (value, digits = 1) => {
    const numeric = Number(value || 0);
    return `${numeric >= 0 ? "+" : ""}${numeric.toFixed(digits)}%`;
  };

  const benchmarkSnapshot = useMemo(() => {
    const values = Array.isArray(benchmarkSeries)
      ? benchmarkSeries.map((point) => Number(point?.[1])).filter((value) => Number.isFinite(value))
      : [];
    if (values.length < 2) {
      return {
        returnPct: 0,
        relativePct: totalReturnPct,
      };
    }
    const start = values[0];
    const latest = values[values.length - 1];
    const returnPct = Math.abs(start) > 1e-8 ? ((latest - start) / Math.abs(start)) * 100 : 0;
    return {
      returnPct,
      relativePct: totalReturnPct - returnPct,
    };
  }, [benchmarkSeries, totalReturnPct]);

  const lossHarvestSnapshot = useMemo(() => {
    const candidates = combinedHoldings
      .filter((holding) => Number(holding?.positionGain || 0) < 0)
      .sort((a, b) => Number(a?.positionGain || 0) - Number(b?.positionGain || 0));
    const totalLoss = Math.abs(candidates.reduce((sum, row) => sum + Number(row?.positionGain || 0), 0));
    return {
      count: candidates.length,
      totalLoss,
      estimatedSavings: totalLoss * 0.2,
      top: candidates[0] || null,
    };
  }, [combinedHoldings]);

  const rebalanceActionMap = useMemo(() => {
    return new Map(
      (Array.isArray(rebalanceSuggestions) ? rebalanceSuggestions : []).map((row) => [
        String(row?.symbol || "").toUpperCase(),
        row,
      ])
    );
  }, [rebalanceSuggestions]);

  const topDriftRow = actionableRebalanceRows[0] || rebalanceSuggestions[0] || null;

  const projectedAlignment = useMemo(() => {
    const before = Math.max(18, 100 - (Number(rebalanceMetrics.totalDrift || 0) * 3.8));
    const after = Math.min(96, before + Math.max(6, Number(rebalanceMetrics.tradesRequired || 0) * 3.4));
    return {
      before,
      after,
    };
  }, [rebalanceMetrics.totalDrift, rebalanceMetrics.tradesRequired]);

  const driftDistribution = useMemo(() => {
    const rows = Array.isArray(rebalanceSuggestions) ? rebalanceSuggestions : [];
    if (!rows.length) return [0, 0, 100];
    const overweight = rows.filter((row) => Number(row?.drift || 0) > 2).length;
    const underweight = rows.filter((row) => Number(row?.drift || 0) < -2).length;
    const inRange = Math.max(0, rows.length - overweight - underweight);
    const total = overweight + underweight + inRange || 1;
    return [
      Number(((overweight / total) * 100).toFixed(2)),
      Number(((underweight / total) * 100).toFixed(2)),
      Number(((inRange / total) * 100).toFixed(2)),
    ];
  }, [rebalanceSuggestions]);

  const rebalanceDonutOptions = useMemo(() => ({
    chart: { type: "donut", background: "transparent", sparkline: { enabled: true } },
    labels: ["Overweight", "Underweight", "In Range"],
    colors: ["#f87171", "#67e8f9", "#1f2937"],
    stroke: { show: false },
    legend: { show: false },
    dataLabels: { enabled: false },
    tooltip: {
      theme: "dark",
      y: {
        formatter: (value) => `${Number(value || 0).toFixed(1)}% of positions`,
      },
    },
    plotOptions: {
      pie: {
        donut: {
          size: "74%",
          labels: {
            show: true,
            name: {
              show: true,
              color: "#94a3b8",
              fontSize: "12px",
              offsetY: -6,
            },
            value: {
              show: true,
              color: "#f8fafc",
              fontSize: "24px",
              fontWeight: 700,
              offsetY: 10,
              formatter: () => `${projectedAlignment.after.toFixed(0)}%`,
            },
            total: {
              show: true,
              label: "Alignment",
              color: "#94a3b8",
              fontSize: "12px",
              formatter: () => "Projected",
            },
          },
        },
      },
    },
  }), [projectedAlignment.after]);

  const portfolioSummaryCards = useMemo(() => {
    const optionsWeight = currentAccountEquity > 0 ? (totalOptionsValue / currentAccountEquity) * 100 : 0;
    return [
      {
        label: "Total Value",
        value: formatMoney(currentAccountEquity),
        detail: `${formatSignedMoney(totalGainLoss)} (${formatSignedPercent(totalReturnPct, 2)})`,
        tone: totalGainLoss >= 0 ? "positive" : "negative",
      },
      {
        label: "Day Change",
        value: formatSignedMoney(totalGainLoss),
        detail: formatSignedPercent(totalReturnPct, 2),
        tone: totalGainLoss >= 0 ? "positive" : "negative",
      },
      {
        label: "Cash",
        value: formatMoney(liveAvailableBalance),
        detail: `${cashWeight.toFixed(1)}% of NAV`,
        tone: cashWeight >= 10 ? "positive" : "neutral",
      },
      {
        label: "Options Exposure",
        value: formatMoney(totalOptionsValue),
        detail: `${optionsWeight.toFixed(1)}% of NAV`,
        tone: optionsWeight > 0 ? "neutral" : "muted",
      },
      {
        label: `Benchmark (${benchmarkSymbol})`,
        value: formatSignedPercent(benchmarkSnapshot.returnPct, 2),
        detail: `Relative ${formatSignedPercent(benchmarkSnapshot.relativePct, 2)}`,
        tone: benchmarkSnapshot.relativePct >= 0 ? "positive" : "negative",
      },
      {
        label: "YTD Return",
        value: formatSignedPercent(totalReturnPct, 2),
        detail: "Portfolio return",
        tone: totalReturnPct >= 0 ? "positive" : "negative",
      },
      {
        label: "Beta / Sharpe",
        value: `${metrics.beta || "N/A"} / ${metrics.sharpe || "N/A"}`,
        detail: healthStatus.label,
        tone: healthStatus.tone,
      },
    ];
  }, [
    benchmarkSnapshot.relativePct,
    benchmarkSnapshot.returnPct,
    benchmarkSymbol,
    cashWeight,
    currentAccountEquity,
    healthStatus.label,
    healthStatus.tone,
    liveAvailableBalance,
    metrics.beta,
    metrics.sharpe,
    totalGainLoss,
    totalOptionsValue,
    totalReturnPct,
  ]);

  const attentionCards = useMemo(() => {
    const topExposure = exposureSummary.sector || exposureSummary.country || exposureSummary.currency;
    return [
      {
        id: "concentration",
        title: "Concentration Risk",
        metric: topExposure ? `${Number(topExposure.weight || 0).toFixed(1)}%` : "No signal",
        detail: topExposure ? `${topExposure.name} leads current portfolio concentration.` : "Add diversified holdings to unlock concentration monitoring.",
        action: "Review Concentration",
        tone: Number(topExposure?.weight || 0) >= 25 ? "warning" : "neutral",
        onClick: () => {
          setActivePortfolioTab("exposure");
          if (topExposure) {
            setFlowSelection(topExposure);
          }
        },
      },
      {
        id: "drift",
        title: "Biggest Drift",
        metric: topDriftRow ? `${topDriftRow.symbol} ${formatSignedPercent(topDriftRow.drift, 1)}` : "In range",
        detail: topDriftRow ? `${topDriftRow.action} vs. target allocation.` : "Holdings are within drift bands right now.",
        action: "Review Drift",
        tone: topDriftRow && Math.abs(Number(topDriftRow.drift || 0)) >= 5 ? "accent" : "neutral",
        onClick: () => {
          if (topDriftRow) {
            openInsightFlow("rebalancing", topDriftRow);
          }
        },
      },
      {
        id: "tax",
        title: "Tax Impact Opportunity",
        metric: lossHarvestSnapshot.count ? `${lossHarvestSnapshot.count} positions` : "No immediate harvest",
        detail: lossHarvestSnapshot.count
          ? `Estimated tax offset ${formatMoney(lossHarvestSnapshot.estimatedSavings)} from unrealized losses.`
          : "Loss-harvest ideas appear here in drawdowns.",
        action: "Review Tax Impact",
        tone: lossHarvestSnapshot.count ? "risk" : "neutral",
        onClick: () => {
          openPortfolioTab("holdings");
          if (lossHarvestSnapshot.top) {
            const row = lossHarvestSnapshot.top;
            const raw = row.row || {};
            setSelectedHolding({
              symbol: String(raw?.symbol || raw?.asset || "N/A").toUpperCase(),
              quantity: Number(raw?.quantity || raw?.qty || 0),
              price: Number(raw?.price || raw?.currentMark || 0),
              positionValue: Number(row.positionValue || 0),
              positionGain: Number(row.positionGain || 0),
            });
          }
        },
      },
    ];
  }, [exposureSummary, formatMoney, lossHarvestSnapshot, topDriftRow]);

  const benchmarkRiskRows = useMemo(() => ([
    { label: "Benchmark", value: benchmarkSymbol },
    { label: "Portfolio YTD", value: formatSignedPercent(totalReturnPct, 2), tone: totalReturnPct >= 0 ? "positive" : "negative" },
    { label: "Benchmark YTD", value: formatSignedPercent(benchmarkSnapshot.returnPct, 2), tone: benchmarkSnapshot.returnPct >= 0 ? "positive" : "negative" },
    { label: "YTD Relative", value: formatSignedPercent(benchmarkSnapshot.relativePct, 2), tone: benchmarkSnapshot.relativePct >= 0 ? "positive" : "negative" },
    { label: "Beta", value: String(metrics.beta || "N/A") },
    { label: "Tracking Error", value: `${Math.abs(Number(benchmarkSnapshot.relativePct || 0)).toFixed(2)}%` },
    { label: "Sharpe Ratio", value: String(metrics.sharpe || "N/A") },
  ]), [benchmarkSnapshot.relativePct, benchmarkSnapshot.returnPct, benchmarkSymbol, metrics.beta, metrics.sharpe, totalReturnPct]);

  const demotedPredictionRows = useMemo(() => predictionMarketRows.slice(0, 4), [predictionMarketRows]);

  const openHoldingSnapshot = (row) => {
    if (!row) return;
    const raw = row.raw || {};
    setSelectedHolding({
      symbol: String(row.symbol || raw?.symbol || raw?.asset || "N/A").toUpperCase(),
      quantity: Number(raw?.quantity || raw?.qty || 0),
      price: Number(raw?.price || raw?.currentMark || 0),
      positionValue: Number(row.positionValue || 0),
      positionGain: Number(row.positionGain || 0),
    });
  };

  const applySavedPortfolioView = (view) => {
    if (!view || typeof view !== "object") return;
    setChartMode(view.chartMode || "equity");
    setChartInterval(view.chartInterval || "1D");
    setDisplayCurrency(view.displayCurrency || "USD");
    setAssetClassFilter(view.assetClassFilter || "all");
    setBenchmarkSymbol(view.benchmarkSymbol || "SPY");
    setSelectedTaxLotMethod(view.selectedTaxLotMethod || "hifo");
    setShowSavedWorkspaceDrawer(false);
  };

  const reviewSavedPortfolioItem = async (kind, payload) => {
    setShowSavedWorkspaceDrawer(false);
    if (kind === "alert") {
      openInsightFlow("exposure", payload || null);
      return;
    }
    if (kind === "rebalance") {
      openInsightFlow("rebalancing", payload?.suggestions?.[0] || actionableRebalanceRows[0] || null);
      return;
    }
    if (kind === "history") {
      openInsightFlow("rebalancing", payload?.trades?.[0] || actionableRebalanceRows[0] || null);
      setFlowOutcome({
        title: "Execution history loaded",
        message: `${Number(payload?.summary?.tradeCount || payload?.trades?.length || 0)} trade${Number(payload?.summary?.tradeCount || payload?.trades?.length || 0) === 1 ? "" : "s"} were recorded with status ${String(payload?.status || "saved").toUpperCase()}.`,
        tone: "success"
      });
      setInsightFlowStep(5);
      return;
    }
    if (kind === "export") {
      if (payload?.type === "exposure") {
        await exportExposureReport();
        openInsightFlow("exposure", payload || null);
        setFlowOutcome({
          title: "Exposure CSV downloaded",
          message: "The saved exposure export was regenerated from the current portfolio state.",
          tone: "success"
        });
        setInsightFlowStep(5);
        return;
      }
      await exportAttributionReport();
      openInsightFlow("attribution", payload || null);
      setFlowOutcome({
        title: "Attribution CSV downloaded",
        message: "The saved attribution export was regenerated from the current portfolio state.",
        tone: "success"
      });
      setInsightFlowStep(5);
    }
  };

  const renderPortfolioTabContent = () => {
    if (activePortfolioTab === "attribution") {
      const groups = [
        { key: "sector", label: "Sectors" },
        { key: "region", label: "Regions" },
        { key: "factor", label: "Factors" },
      ];
      return (
        <div className="portfolio-command-tab-panel">
          <div className="portfolio-command-panel-head">
            <div>
              <h3>What Drove Performance</h3>
              <p>Contribution by sector, region, and factor so you can see what really moved the book.</p>
            </div>
            <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("attribution")}>Open Attribution Flow</button>
          </div>
          <div className="portfolio-command-card-grid three">
            {groups.map((group) => {
              const row = attributionRows?.[group.key]?.[0] || null;
              return (
                <button
                  key={group.key}
                  type="button"
                  className="portfolio-command-mini-card"
                  onClick={() => {
                    if (row) {
                      setFlowSelection(row);
                    }
                    openInsightFlow("attribution", row);
                  }}
                >
                  <span>{group.label}</span>
                  <strong>{row?.name || "No lead contributor"}</strong>
                  <em className={Number(row?.pnl || 0) >= 0 ? "positive" : "negative"}>
                    {row ? formatSignedMoney(row.pnl) : "$0.00"}
                  </em>
                </button>
              );
            })}
          </div>
          <div className="portfolio-command-table-wrap">
            <table className="portfolio-command-table compact">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Leader</th>
                  <th>Contribution</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((group) => (attributionRows?.[group.key] || []).slice(0, 3).map((row) => (
                  <tr key={`${group.key}-${row.name}`}>
                    <td>{group.label}</td>
                    <td>{row.name}</td>
                    <td className={Number(row?.pnl || 0) >= 0 ? "positive" : "negative"}>{formatSignedMoney(row.pnl)}</td>
                    <td>
                      <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("attribution", row)}>Review</button>
                    </td>
                  </tr>
                )))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePortfolioTab === "exposure") {
      return (
        <div className="portfolio-command-tab-panel">
          <div className="portfolio-command-panel-head">
            <div>
              <h3>Where You&apos;re Overweight</h3>
              <p>Find concentration risk across sectors, countries, and currencies, then send it to a rebalance response.</p>
            </div>
            <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("exposure")}>Open Exposure Flow</button>
          </div>
          <div className="portfolio-command-card-grid three">
            {(exposureRows || []).slice(0, 6).map((row) => (
              <button
                key={`${row.bucket}-${row.name}`}
                type="button"
                className={`portfolio-command-mini-card risk-${String(row.risk || "low").toLowerCase().replace(/\s+/g, "-")}`}
                onClick={() => openInsightFlow("exposure", row)}
              >
                <span>{row.bucket}</span>
                <strong>{row.name}</strong>
                <em>{row.weight.toFixed(1)}%</em>
              </button>
            ))}
          </div>
          <div className="portfolio-command-table-wrap">
            <table className="portfolio-command-table compact">
              <thead>
                <tr>
                  <th>Bucket</th>
                  <th>Name</th>
                  <th>Weight</th>
                  <th>Risk</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {(exposureRows || []).slice(0, 10).map((row) => (
                  <tr key={`exp-${row.bucket}-${row.name}`}>
                    <td>{row.bucket}</td>
                    <td>{row.name}</td>
                    <td>{row.weight.toFixed(1)}%</td>
                    <td>{formatRiskLabel(row.risk)}</td>
                    <td>
                      <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("exposure", row)}>Inspect</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      );
    }

    if (activePortfolioTab === "fees") {
      return (
        <div className="portfolio-command-tab-panel">
          <div className="portfolio-command-panel-head">
            <div>
              <h3>Fees</h3>
              <p>Execution costs across venues, benchmark comparison, and savings opportunities versus the cheapest avenue.</p>
            </div>
          </div>
          <div className="portfolio-command-card-grid three">
            <div className="portfolio-command-mini-card static">
              <span>Gross Fees Paid</span>
              <strong>{formatMoney(feeDashboard.estimatedUsd)}</strong>
              <em>{feeDashboard.tradeCount} charged trades</em>
            </div>
            <div className="portfolio-command-mini-card static">
              <span>Recorded Fills</span>
              <strong>{feeDashboard.fillCount}</strong>
              <em>{feeDashboard.platforms.length} venue buckets</em>
            </div>
            <div className="portfolio-command-mini-card static">
              <span>vs Cheapest Avenue</span>
              <strong className={feeDashboard.comparisonDeltaUsd <= 0 ? "positive" : "negative"}>
                {feeDashboard.comparison ? formatSignedMoney(-feeDashboard.comparisonDeltaUsd) : "N/A"}
              </strong>
              <em>{feeDashboard.comparison ? "Benchmark delta" : "No benchmark comparison yet"}</em>
            </div>
          </div>
          <div className="portfolio-command-activity-list">
            {(feeDashboard.platforms || []).slice(0, 8).map((row) => (
              <div key={`fee-${row.platform}`} className="portfolio-command-activity-row">
                <div className="portfolio-command-activity-copy">
                  <strong>{row.label}</strong>
                  <span>{row.breakdown}</span>
                </div>
                <div className="portfolio-command-activity-values">
                  <strong>{formatMoney(row.estimatedUsd)}</strong>
                  <span>{row.tradeCount} trades</span>
                </div>
              </div>
            ))}
            {!feeDashboard.platforms.length ? (
              <div className="portfolio-command-empty">
                <h3>No recorded fees yet</h3>
                <p>Connect venues or execute trades through Zenin to populate cost history.</p>
              </div>
            ) : null}
          </div>
        </div>
      );
    }

    if (activePortfolioTab === "prediction") {
      return (
        <div className="portfolio-command-tab-panel">
          <div className="portfolio-command-panel-head">
            <div>
              <h3>Prediction Markets</h3>
              <p>Event-driven positioning stays visible, but it remains an optional extension to the core portfolio workflow.</p>
            </div>
            <div className="portfolio-command-inline-actions">
              <span className="portfolio-command-beta-pill">Beta</span>
              <button type="button" className="portfolio-v2-link" onClick={() => onOpenPredictions?.()}>Open Predictions</button>
            </div>
          </div>
          {predictionMarketRows.length ? (
            <div className="portfolio-command-card-grid four">
              {predictionMarketRows.slice(0, 8).map((row) => (
                <div key={row.market} className="portfolio-command-market-card">
                  <span>{row.market}</span>
                  <strong>{formatSignedMoney(row.pnl)}</strong>
                  <em>{row.netQty.toFixed(2)} qty</em>
                </div>
              ))}
            </div>
          ) : (
            <div className="portfolio-command-empty">
              <h3>No prediction market positions yet</h3>
              <p>Use the Predictions workspace to track macro and event-driven exposures beside the main book.</p>
              <div className="portfolio-command-inline-actions">
                <button type="button" className="portfolio-v2-link" onClick={() => onOpenPredictions?.()}>Explore Markets</button>
                <button type="button" className="portfolio-v2-link secondary" onClick={() => setShowPredictionGuide(true)}>Learn how it works</button>
              </div>
            </div>
          )}
        </div>
      );
    }

    return (
      <div className="portfolio-command-tab-panel">
        <div className="portfolio-command-panel-head">
          <div>
            <h3>Holdings</h3>
            <p>Default portfolio view with readable allocation, benchmark-relative context, and direct drill-in affordances.</p>
          </div>
          <div className="portfolio-command-inline-actions">
            <label className="portfolio-command-inline-select">
              <span>Scope</span>
              <select value={assetClassFilter} onChange={(event) => setAssetClassFilter(event.target.value)} className="portfolio-v2-select">
                <option value="all">All Assets</option>
                <option value="equities">Equities</option>
                <option value="crypto">Crypto</option>
                <option value="options">Options</option>
                <option value="commodities">Commodities</option>
              </select>
            </label>
            <label className="portfolio-command-inline-select">
              <span>Sort</span>
              <select value={holdingsSortBy} onChange={(event) => setHoldingsSortBy(event.target.value)} className="portfolio-v2-select">
                <option value="value">Value</option>
                <option value="pnl">PnL</option>
                <option value="return">Return</option>
                <option value="risk">Risk</option>
              </select>
            </label>
            <button type="button" className="portfolio-v2-link" onClick={() => exportExposureReport()}>Export</button>
          </div>
        </div>
        <div className="portfolio-command-table-wrap">
          <table className="portfolio-command-table">
            <thead>
              <tr>
                <th>Symbol</th>
                <th>Name</th>
                <th>Asset Class</th>
                <th>Allocation</th>
                <th>Unrealized PnL</th>
                <th>vs Benchmark</th>
                <th>Weight vs Bench</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {holdingsTableRows.length ? holdingsTableRows.map((row) => {
                const benchDelta = row.kind === "spot"
                  ? Number(row?.raw?.priceChangePercent || 0) - Number(benchmarkSnapshot.returnPct || 0)
                  : null;
                const driftRow = rebalanceActionMap.get(String(row.symbol || "").toUpperCase());
                return (
                  <tr key={row.key}>
                    <td>{row.symbol}</td>
                    <td>{row.name}</td>
                    <td>{row.kind === "options" ? "Options" : String(row?.raw?.marketType || row?.raw?.type || "Asset").replace(/_/g, " ")}</td>
                    <td>
                      <div className="portfolio-command-allocation-cell">
                        <strong>{row.allocation.toFixed(1)}%</strong>
                        <div className="portfolio-command-allocation-bar"><i style={{ width: `${Math.min(100, Math.max(4, row.allocation))}%` }} /></div>
                      </div>
                    </td>
                    <td className={row.pnlPositive ? "positive" : "negative"}>{row.pnlMain}</td>
                    <td className={benchDelta == null ? "" : benchDelta >= 0 ? "positive" : "negative"}>
                      {benchDelta == null ? "—" : formatSignedPercent(benchDelta, 1)}
                    </td>
                    <td className={Number(driftRow?.drift || 0) <= 0 ? "positive" : "negative"}>
                      {driftRow ? formatSignedPercent(driftRow.drift, 1) : "—"}
                    </td>
                    <td>
                      <button type="button" className="portfolio-v2-link" onClick={() => openHoldingSnapshot(row)}>Open</button>
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={8}>
                    <div className="portfolio-command-empty">
                      <h3>No positions found</h3>
                      <p>Add holdings or connect accounts to unlock portfolio analysis.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const renderInsightFlow = () => {
    if (!activeInsightFlow) return null;
    const steps = insightFlowSteps[activeInsightFlow] || [];
    const pickExposure = flowSelection || exposureFlowData.top;
    const pickAttribution = flowSelection || attributionFlowData.top;

    const progress = (
      <div className="portfolio-v2-flow-progress">
        {steps.map((label, idx) => {
          const stepIndex = idx + 1;
          const state = stepIndex === insightFlowStep ? "active" : stepIndex < insightFlowStep ? "done" : "todo";
          return (
            <div key={`${activeInsightFlow}-${stepIndex}`} className={`portfolio-v2-flow-progress-item ${state}`}>
              <span>{stepIndex}</span>
              <strong>{label}</strong>
            </div>
          );
        })}
      </div>
    );

    let body = null;
    if (activeInsightFlow === "attribution") {
      const activeGroup = flowSelection?.group?.toLowerCase() || "sector";
      const contributionRows = attributionRows?.[activeGroup] || attributionRows?.sector || [];
      const maxAbs = Math.max(1, ...contributionRows.map((row) => Math.abs(Number(row?.pnl || 0))));
      if (insightFlowStep === 1) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Performance Attribution</h3>
              <span>{contributionRows.length || 0} contributors</span>
            </div>
            <p>Entry point from dashboard with top attribution snapshots.</p>
            <div className="portfolio-v2-flow-mini-grid">
              {[{ key: "sector", label: "Sector" }, { key: "region", label: "Region" }, { key: "factor", label: "Factor" }].map((item) => {
                const row = attributionRows?.[item.key]?.[0];
                return (
                  <button
                    key={item.key}
                    type="button"
                    className="portfolio-v2-flow-chip"
                    onClick={() => {
                      setFlowSelection(row || null);
                      setInsightFlowStep(2);
                    }}
                  >
                    <small>{item.label}</small>
                    <strong>{row?.name || "Unclassified"}</strong>
                    <em className={Number(row?.pnl || 0) >= 0 ? "positive" : "negative"}>{row ? formatSignedMoney(row.pnl) : "$0.00"}</em>
                  </button>
                );
              })}
            </div>
          </div>
        );
      } else if (insightFlowStep === 2) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Attribution Overview</h3>
              <span>{flowSelection?.group || "Sector"} view</span>
            </div>
            <div className="portfolio-v2-flow-bars">
              {contributionRows.slice(0, 6).map((row) => {
                const pnl = Number(row?.pnl || 0);
                const width = `${Math.max(8, (Math.abs(pnl) / maxAbs) * 100)}%`;
                return (
                  <div key={`${row.group}-${row.name}`} className="portfolio-v2-flow-bar-row">
                    <div className="portfolio-v2-flow-bar-copy">
                      <strong>{row.name}</strong>
                      <span>{formatSignedMoney(pnl)}</span>
                    </div>
                    <button
                      type="button"
                      className={`portfolio-v2-flow-bar ${pnl >= 0 ? "positive" : "negative"}`}
                      style={{ width }}
                      onClick={() => {
                        setFlowSelection(row);
                        setInsightFlowStep(3);
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(3)}>Continue</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(1)}>Back</button>
            </div>
          </div>
        );
      } else if (insightFlowStep === 3) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Attribution Drilldown</h3>
              <span>{pickAttribution?.name || "Contributor"}</span>
            </div>
            <div className="portfolio-v2-flow-two-col">
              <div>
                <h4>Top Positive</h4>
                <ul className="portfolio-v2-flow-list">
                  {attributionFlowData.positive.map((row) => (
                    <li key={`pos-${row.group}-${row.name}`}>
                      <span>{row.name}</span>
                      <strong className="positive">{formatSignedMoney(row.pnl)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>Top Negative</h4>
                <ul className="portfolio-v2-flow-list">
                  {attributionFlowData.negative.map((row) => (
                    <li key={`neg-${row.group}-${row.name}`}>
                      <span>{row.name}</span>
                      <strong className="negative">{formatSignedMoney(row.pnl)}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(4)}>View Insight</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(2)}>Back</button>
            </div>
          </div>
        );
      } else if (insightFlowStep === 4) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Contributor Insights</h3>
              <span>{pickAttribution?.name || "AAPL"}</span>
            </div>
            <div className="portfolio-v2-flow-detail-grid">
              <div>
                <strong>Insight</strong>
                <p>
                  {pickAttribution?.name || "This contributor"} drove portfolio return through concentrated exposure
                  and price movement in the current interval.
                </p>
              </div>
              <div>
                <strong>Total Contribution</strong>
                <p className={Number(pickAttribution?.pnl || 0) >= 0 ? "positive" : "negative"}>
                  {formatSignedMoney(Number(pickAttribution?.pnl || 0))}
                </p>
              </div>
            </div>
            <div className="portfolio-v2-flow-chart-mock">
              <span style={{ width: "22%" }} />
              <span style={{ width: "34%" }} />
              <span style={{ width: "46%" }} />
              <span style={{ width: "64%" }} />
              <span style={{ width: "53%" }} />
              <span style={{ width: "73%" }} />
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(5)}>Proceed</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(3)}>Back</button>
            </div>
          </div>
        );
      } else {
        body = flowBusy ? (
          <div className="portfolio-v2-flow-status-card">
            <div className="portfolio-v2-flow-spinner" />
            <h3>Saving insight...</h3>
            <p>{flowActionLabel || "Please wait while we finish this action."}</p>
          </div>
        ) : (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Actions &amp; Export</h3>
              <span>Step complete</span>
            </div>
            <div className="portfolio-v2-flow-list stacked">
              <button type="button" className="portfolio-v2-flow-action-row" onClick={() => runFlowProcessing(5, "Preparing attribution export...", 5, async () => {
                await exportAttributionReport();
                setFlowOutcome({
                  title: "Attribution report downloaded",
                  message: `A CSV snapshot was downloaded and saved in ${getSaveTargetLabel()}.`,
                  tone: "success"
                });
              })}>
                <strong>Export report</strong><span>Download CSV</span>
              </button>
              <button type="button" className="portfolio-v2-flow-action-row" onClick={() => runFlowProcessing(5, "Saving insight to journal...", 5, async () => {
                await saveJournalInsight(
                  "Portfolio Attribution Insight",
                  `${pickAttribution?.name || "This contributor"} added ${formatSignedMoney(Number(pickAttribution?.pnl || 0))} to portfolio performance.`,
                  {
                    symbol: pickAttribution?.name || "",
                    marketType: "Attribution"
                  }
                );
                setFlowOutcome({
                  title: "Insight added to Journal",
                  message: `The attribution note was saved in ${getSaveTargetLabel()}.`,
                  tone: "success"
                });
              })}>
                <strong>Add to journal</strong><span>Save this insight note</span>
              </button>
              <button type="button" className="portfolio-v2-flow-action-row" onClick={() => openRelatedHoldingFromInsight(pickAttribution)}>
                <strong>Review positions</strong><span>Open related holdings</span>
              </button>
            </div>
            <div className={`portfolio-v2-flow-status-inline ${flowOutcome.title ? flowOutcome.tone || "success" : "neutral"}`}>
              <span>{flowOutcome.title ? (flowOutcome.tone === "error" ? "!" : "✓") : "•"}</span>
              <div><strong>{flowOutcome.title || "Insight ready"}</strong><small>{flowOutcome.message || "Choose an action to export or save this insight."}</small></div>
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={closeInsightFlow}>Close</button>
            </div>
          </div>
        );
      }
    } else if (activeInsightFlow === "exposure") {
      const activeBucket = flowSelection?.bucket || "Sector";
      const bucketRows = exposureRows.filter(r => r.bucket === activeBucket);
      const activeSector = flowSelection || bucketRows[0];
      const concentrationScore = Math.min(100, Math.max(0, Number(activeSector?.weight || 0) * 1.8));
      if (insightFlowStep === 1) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Exposure Heatmap</h3>
              <span>{bucketRows.length} {activeBucket.toLowerCase()}s</span>
            </div>
            <p>Entry point from dashboard with top {activeBucket.toLowerCase()} exposure snapshots.</p>
            <div className="portfolio-v2-flow-mini-grid">
              {bucketRows.slice(0, 3).map((row) => (
                <button
                  key={`exp-top-${row.name}`}
                  type="button"
                  className={`portfolio-v2-flow-chip risk-${row.risk}`}
                  onClick={() => {
                    setFlowSelection(row);
                    setInsightFlowStep(2);
                  }}
                >
                  <small>{row.bucket}</small>
                  <strong>{row.name}</strong>
                  <em>{row.weight.toFixed(1)}%</em>
                </button>
              ))}
            </div>
          </div>
        );
      } else if (insightFlowStep === 2) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Heatmap Overview</h3>
              <span>{activeBucket} map</span>
            </div>
            <div className="portfolio-v2-flow-table">
              {bucketRows.slice(0, 6).map((row) => (
                <button
                  key={`heat-${row.name}`}
                  type="button"
                  className={`portfolio-v2-flow-table-row risk-${row.risk}`}
                  onClick={() => {
                    setFlowSelection(row);
                    setInsightFlowStep(3);
                  }}
                >
                  <span>{row.name}</span>
                  <strong>{row.weight.toFixed(1)}%</strong>
                  <em>{formatRiskLabel(row.risk)}</em>
                </button>
              ))}
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(3)}>Continue</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(1)}>Back</button>
            </div>
          </div>
        );
      } else if (insightFlowStep === 3) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>{activeSector?.name || "Sector"} Exposure</h3>
              <span>{activeSector?.weight?.toFixed(1) || "0.0"}%</span>
            </div>
            <div className="portfolio-v2-flow-two-col">
              <div className="portfolio-v2-flow-kpi-card">
                <span>Exposure</span>
                <strong>{activeSector?.weight?.toFixed(1) || "0.0"}%</strong>
              </div>
              <div className="portfolio-v2-flow-kpi-card">
                <span>Unrealized P&amp;L</span>
                <strong className={totalGainLoss >= 0 ? "positive" : "negative"}>{formatSignedMoney(totalGainLoss * ((Number(activeSector?.weight || 0) / 100) || 0))}</strong>
              </div>
            </div>
            <ul className="portfolio-v2-flow-list">
              {holdingsTableRows
                .filter(row => {
                  if (!flowSelection) return true;
                  const bucket = flowSelection.bucket || "Sector";
                  const val = String(row[bucket.toLowerCase()] || row.sector || "").toLowerCase();
                  return val === String(flowSelection.name || "").toLowerCase();
                })
                .slice(0, 5)
                .map((row) => (
                  <li key={`exp-holding-${row.key}`}>
                    <span>{row.symbol}</span>
                    <strong>{row.allocation.toFixed(2)}%</strong>
                  </li>
                ))}
            </ul>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(4)}>View Insights</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(2)}>Back</button>
            </div>
          </div>
        );
      } else if (insightFlowStep === 4) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Insights &amp; Risk</h3>
              <span>{activeSector?.name || "Sector"}</span>
            </div>
            <div className="portfolio-v2-flow-detail-grid">
              <div>
                <strong>Concentration Insight</strong>
                <p>{activeSector?.name || "Sector"} is above your target exposure band.</p>
              </div>
              <div>
                <strong>Diversification Score</strong>
                <p>{concentrationScore.toFixed(0)}/100</p>
              </div>
            </div>
            <div className="portfolio-v2-flow-score-track">
              <i style={{ width: `${concentrationScore}%` }} />
            </div>
            <ul className="portfolio-v2-flow-bullets">
              <li>Reduce exposure to concentrated sectors.</li>
              <li>Increase allocation to underweight buckets.</li>
              <li>Review alert thresholds and rebalance cadence.</li>
            </ul>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(5)}>Take Action</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(3)}>Back</button>
            </div>
          </div>
        );
      } else {
        body = flowBusy ? (
          <div className="portfolio-v2-flow-status-card">
            <div className="portfolio-v2-flow-spinner" />
            <h3>Applying response...</h3>
            <p>{flowActionLabel || "Updating your portfolio preferences."}</p>
          </div>
        ) : (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Portfolio Response</h3>
              <span>{activeSector?.name || "Sector"}</span>
            </div>
            <div className="portfolio-v2-flow-list stacked">
              <button type="button" className="portfolio-v2-flow-action-row" onClick={() => openInsightFlow("rebalancing", actionableRebalanceRows[0] || null)}>
                <strong>Rebalance portfolio</strong><span>Adjust allocations</span>
              </button>
              <button type="button" className="portfolio-v2-flow-action-row" onClick={() => runFlowProcessing(5, "Saving exposure alert...", 5, async () => {
                await saveExposureAlert(activeSector);
                setFlowOutcome({
                  title: "Exposure alert saved",
                  message: `${activeSector?.name || "This bucket"} is now saved in ${getSaveTargetLabel()} on your alert list. Reopen it from Saved Items.`,
                  tone: "success"
                });
              })}>
                <strong>Set alert</strong><span>Notify if exposure is breached</span>
              </button>
              <button type="button" className="portfolio-v2-flow-action-row" onClick={() => runFlowProcessing(5, "Saving heatmap view...", 5, async () => {
                await savePortfolioView("exposure-heatmap");
                await exportExposureReport();
                setFlowOutcome({
                  title: "View saved and exported",
                  message: `Your heatmap filters were saved in ${getSaveTargetLabel()} and a CSV export was downloaded. Reopen both from Saved Items.`,
                  tone: "success"
                });
              })}>
                <strong>Save view</strong><span>Store this heatmap configuration</span>
              </button>
            </div>
            <div className={`portfolio-v2-flow-status-inline ${flowOutcome.title ? flowOutcome.tone || "success" : "neutral"}`}>
              <span>{flowOutcome.title ? (flowOutcome.tone === "error" ? "!" : "✓") : "•"}</span>
              <div><strong>{flowOutcome.title || "Portfolio response ready"}</strong><small>{flowOutcome.message || "Choose an action to save or respond to this concentration risk."}</small></div>
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={closeInsightFlow}>Close</button>
            </div>
          </div>
        );
      }
    } else if (activeInsightFlow === "rebalancing") {
      const {
        tradesRequired,
        totalDrift,
        tradeVolume,
        estimatedFees,
        estimatedSlippage,
        estimatedCostImpact
      } = rebalanceMetrics;
      const trimCount = actionableRebalanceRows.filter((s) => s.action === "Trim").length;
      const addCount = actionableRebalanceRows.filter((s) => s.action === "Add").length;
      const costStatusLabel = !isSignedIn
        ? "Sign in to preview API execution costs."
        : rebalanceEstimateStatus === "loading"
          ? "Fetching execution costs..."
          : rebalanceEstimateStatus === "error"
            ? "Execution cost preview unavailable."
            : null;

      if (insightFlowStep === 1) {
        // This is usually reached by clicking "Action" in the table
        // We'll advance immediately to Step 2 since the table IS the dashboard entry
        runFlowProcessing(2, "Generating rebalance overview...");
        body = (
          <div className="portfolio-v2-flow-status-card">
            <div className="portfolio-v2-flow-spinner" />
            <h3>Analyzing Drift...</h3>
          </div>
        );
      } else if (insightFlowStep === 2) {
        const donutOptions = {
          chart: { type: 'donut', background: 'transparent' },
          labels: ['Current Allocation', 'Target Allocation'],
          colors: ['#3b82f6', '#1e293b'],
          stroke: { show: false },
          legend: { show: false },
          dataLabels: { enabled: false },
          plotOptions: {
            pie: {
              donut: {
                size: '75%',
                labels: {
                  show: true,
                  name: { show: true, fontSize: '12px', color: 'var(--color-text-secondary)', offsetY: -5 },
                  value: { show: true, fontSize: '20px', fontWeight: 700, color: 'var(--color-text-primary)', offsetY: 5 },
                  total: { show: true, label: 'Portfolio Drift', color: 'var(--color-text-secondary)', formatter: () => `${totalDrift.toFixed(1)}%` }
                }
              }
            }
          }
        };

        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Rebalance Overview</h3>
              <span>Analyze portfolio drift and trade impact</span>
            </div>

            <div className="portfolio-v2-flow-two-col" style={{ alignItems: 'center' }}>
              <div style={{ pointerEvents: 'none' }}>
                <ReactApexChart
                  options={donutOptions}
                  series={[100 - totalDrift, totalDrift]}
                  type="donut"
                  width={200}
                />
              </div>
              <div className="portfolio-v2-flow-mini-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Portfolio Drift</span>
                  <strong style={{ fontSize: '18px', color: '#f59e0b' }}>{totalDrift.toFixed(1)}%</strong>
                </div>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Trades Required</span>
                  <strong style={{ fontSize: '18px' }}>{tradesRequired}</strong>
                </div>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Platform Fees</span>
                  <strong style={{ fontSize: '18px' }}>{formatMoney(estimatedFees)}</strong>
                </div>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Expected Slippage</span>
                  <strong style={{ fontSize: '18px', color: '#38bdf8' }}>{formatMoney(estimatedSlippage)}</strong>
                </div>
              </div>
            </div>

            {costStatusLabel ? (
              <div className="portfolio-v2-flow-status-inline warning" style={{ marginTop: '14px' }}>
                <span>!</span>
                <div><strong>Execution cost preview</strong><small>{costStatusLabel}</small></div>
              </div>
            ) : (
              <div className="portfolio-v2-flow-status-inline success" style={{ marginTop: '14px' }}>
                <span>✓</span>
                <div><strong>Total execution cost impact</strong><small>{formatMoney(estimatedCostImpact)} across {formatMoney(tradeVolume)} of turnover.</small></div>
              </div>
            )}

            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(3)}>Generate Plan</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={closeInsightFlow}>Cancel</button>
            </div>
          </div>
        );
      } else if (insightFlowStep === 3) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Rebalance Plan</h3>
              <span>Inspect individual trade suggestions</span>
            </div>
            <div className="portfolio-v2-flow-list stacked" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {actionableRebalanceRows.map((s) => (
                <div key={s.symbol} className="portfolio-v2-flow-action-row" style={{ cursor: 'default' }}>
                   <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div className="portfolio-v2-activity-dot" style={{
                        color: s.action === "Trim" ? '#f59e0b' : '#22c55e',
                        background: s.action === "Trim" ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)'
                      }}>
                        {s.action === "Trim" ? "↘" : "↗"}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column' }}>
                        <strong>{s.action} {s.symbol}</strong>
                        <small style={{ color: 'var(--color-text-secondary)' }}>{s.action === "Trim" ? 'Reduce' : 'Increase'} allocation</small>
                      </div>
                   </div>
                   <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600, color: s.action === "Trim" ? '#f59e0b' : '#22c55e' }}>{s.action === "Trim" ? "Sell" : "Buy"}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}>{formatMoney(s.tradeValue)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{Number(s.tradeQuantity || 0).toFixed(6)} {s.symbol}</div>
                   </div>
                </div>
              ))}
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(4)}>Apply Plan</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(2)}>Back</button>
            </div>
          </div>
        );
      } else if (insightFlowStep === 4) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Confirm Rebalance</h3>
              <span>Review expected costs and drift reduction</span>
            </div>
            <div className="portfolio-v2-flow-list stacked">
               <div className="portfolio-v2-flow-action-row" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ fontSize: '20px' }}>🛒</div>
                    <div><strong>{tradesRequired} total trades</strong><span>{trimCount} Sell, {addCount} Buy</span></div>
                  </div>
               </div>
               <div className="portfolio-v2-flow-action-row" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ fontSize: '20px' }}>💰</div>
                    <div><strong>Platform fees</strong><span>{formatMoney(estimatedFees)}</span></div>
                  </div>
               </div>
               <div className="portfolio-v2-flow-action-row" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ fontSize: '20px' }}>↔</div>
                    <div><strong>Expected slippage</strong><span>{formatMoney(estimatedSlippage)}</span></div>
                  </div>
               </div>
               <div className="portfolio-v2-flow-action-row" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ fontSize: '20px' }}>🎯</div>
                    <div><strong>Total execution cost</strong><span>{formatMoney(estimatedCostImpact)}</span></div>
                  </div>
               </div>
            </div>
            {costStatusLabel ? (
              <div className="portfolio-v2-flow-status-inline warning">
                <span>!</span>
                <div><strong>Cost estimate note</strong><small>{costStatusLabel}</small></div>
              </div>
            ) : null}
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={handleConfirmRebalance}>Confirm</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(3)}>Back</button>
            </div>
          </div>
        );
      } else {
        body = flowBusy ? (
          <div className="portfolio-v2-flow-status-card">
            <div className="portfolio-v2-flow-spinner" />
            <h3>{flowActionLabel || "Executing trades..."}</h3>
          </div>
        ) : (
          <div className="portfolio-v2-flow-card" style={{ alignItems: 'center', textAlign: 'center' }}>
            <div className="portfolio-v2-flow-status-inline success" style={{ flexDirection: 'column', padding: '20px', gap: '16px' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: flowOutcome.tone === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)', color: flowOutcome.tone === 'success' ? '#22c55e' : '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px' }}>{flowOutcome.tone === 'success' ? '✓' : '!'}</div>
              <div style={{ textAlign: 'center' }}>
                <h3 style={{ fontSize: '20px', color: 'var(--color-text-primary)', margin: '0 0 8px' }}>{flowOutcome.title || "Rebalance update"}</h3>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px' }}>{flowOutcome.message || "Zenin saved the latest rebalance workflow status."}</p>
              </div>
            </div>

            <div className="portfolio-v2-flow-list stacked" style={{ width: '100%', marginTop: '16px' }}>
               <div className="portfolio-v2-flow-action-row" style={{ padding: '8px 12px' }}>
                  <span>Projected Drift</span><strong className={flowOutcome.tone === "success" ? "positive" : ""}>{flowOutcome.tone === "success" ? "0.0%" : `${Number(totalDrift || 0).toFixed(1)}%`}</strong>
               </div>
               <div className="portfolio-v2-flow-action-row" style={{ padding: '8px 12px' }}>
                  <span>Status</span><strong style={{ color: flowOutcome.tone === 'success' ? '#22c55e' : '#f59e0b' }}>{flowOutcome.tone === 'success' ? 'Executed' : 'Preview / Partial'}</strong>
               </div>
               <div className="portfolio-v2-flow-action-row" style={{ padding: '8px 12px' }}>
                  <span>Platform Fees</span><strong>{formatMoney(Number(rebalanceEstimate?.summary?.fees || 0))}</strong>
               </div>
               <div className="portfolio-v2-flow-action-row" style={{ padding: '8px 12px' }}>
                  <span>Slippage</span><strong>{formatMoney(Number(rebalanceEstimate?.summary?.slippage || 0))}</strong>
               </div>
            </div>

            <div className="portfolio-v2-flow-actions" style={{ width: '100%', marginTop: '20px' }}>
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={closeInsightFlow} style={{ width: '100%' }}>View Portfolio</button>
            </div>
          </div>
        );
      }
    }

    const flowTitle = activeInsightFlow === "attribution"
      ? "Performance Attribution Flow"
      : activeInsightFlow === "exposure"
        ? "Exposure Heatmap Flow"
        : "Rebalancing Suggestions Flow";

    return (
      <div className="portfolio-v2-flow-overlay" role="dialog" aria-modal="true">
        <div className="portfolio-v2-flow-shell">
          <div className="portfolio-v2-flow-top">
            <h2>{flowTitle}</h2>
            <button type="button" className="portfolio-v2-flow-close" onClick={closeInsightFlow}>✕</button>
          </div>
          <div className="portfolio-v2-flow-body">
            {body}
          </div>
        </div>
      </div>
    );
  };


  useEffect(() => {
    document.body.classList.add("portfolio-active");
    document.documentElement.classList.add("portfolio-active");
    return () => {
      document.body.classList.remove("portfolio-active");
      document.documentElement.classList.remove("portfolio-active");
    };
  }, []);

  return (
    <div className="portfolio-module portfolio-v2 portfolio-exec-page portfolio-command-page">
      <header className="portfolio-command-header">
        <div className="portfolio-command-titleblock">
          <span className="portfolio-command-eyebrow">Portfolio</span>
          <h1>Portfolio Command Center</h1>
          <p>Actionable intelligence. Clear next step.</p>
        </div>
        <div className="portfolio-command-header-actions">
          <select
            value={assetClassFilter}
            onChange={(event) => setAssetClassFilter(event.target.value)}
            className="portfolio-v2-select"
            aria-label="Portfolio scope"
          >
            <option value="all">All Assets</option>
            <option value="equities">Equities</option>
            <option value="crypto">Crypto</option>
            <option value="options">Options</option>
            <option value="commodities">Commodities</option>
          </select>
          {typeof onOpenMarketContext === "function" ? (
            <button type="button" className="portfolio-v2-link" onClick={onOpenMarketContext}>Market Context</button>
          ) : null}
          <button type="button" className="portfolio-v2-link" onClick={handleOpenConnections}>Connections</button>
          <button
            type="button"
            className="portfolio-v2-link"
            onClick={async () => {
              await savePortfolioView("portfolio-command-center");
              setFlowOutcome({
                title: "View saved",
                message: `The current command-center filters were saved in ${getSaveTargetLabel()}.`,
                tone: "success",
              });
            }}
          >
            Save View
          </button>
          <button
            type="button"
            className="portfolio-v2-link secondary"
            onClick={() => setShowSavedWorkspaceDrawer(true)}
          >
            Saved Items{savedWorkspaceCount ? ` (${savedWorkspaceCount})` : ""}
          </button>
        </div>
      </header>

      <section className="portfolio-command-summary">
        <div className="portfolio-command-section-head">
          <span>Portfolio Summary</span>
          <em>{isSyncing ? "Syncing venues..." : `As of ${formatSavedTimestamp(feeDashboard.updatedAt || Date.now())}`}</em>
        </div>
        <div className="portfolio-command-summary-grid">
          {portfolioSummaryCards.map((card) => (
            <article key={card.label} className={`portfolio-command-summary-card ${card.tone || "neutral"}`}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <em>{card.detail}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="portfolio-command-attention">
        <div className="portfolio-command-section-head">
          <span>What Needs Attention</span>
          <button type="button" className="portfolio-v2-link" onClick={() => openPortfolioTab("exposure")}>View All</button>
        </div>
        <div className="portfolio-command-attention-grid">
          {attentionCards.map((card) => (
            <button
              key={card.id}
              type="button"
              className={`portfolio-command-attention-card ${card.tone || "neutral"}`}
              onClick={card.onClick}
            >
              <div>
                <span>{card.title}</span>
                <strong>{card.metric}</strong>
                <em>{card.detail}</em>
              </div>
              <b>{card.action}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="portfolio-command-rebalance">
        <div className="portfolio-command-section-head">
          <span>Recommended Changes</span>
          <div className="portfolio-command-inline-actions">
            <div className="portfolio-v2-range">
              {intervals.map((int) => (
                <button
                  key={int}
                  type="button"
                  className={`portfolio-v2-range-btn ${chartInterval === int ? "active" : ""}`}
                  onClick={() => setChartInterval(int)}
                >
                  {int}
                </button>
              ))}
            </div>
            <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("rebalancing", topDriftRow || null)}>Open Rebalance Flow</button>
          </div>
        </div>
        <div className="portfolio-command-rebalance-grid">
          <div className="portfolio-command-drift-card">
            <div className="portfolio-command-panel-head">
              <div>
                <h3>Rebalance to Restore Target Allocation</h3>
                <p>Address drift, reduce concentration, and improve portfolio alignment.</p>
              </div>
            </div>
            <div className="portfolio-command-drift-visual">
              <ReactApexChart options={rebalanceDonutOptions} series={driftDistribution} type="donut" height={214} />
              <div className="portfolio-command-drift-legend">
                <span><i className="risk" />Overweight</span>
                <span><i className="info" />Underweight</span>
                <span><i className="neutral" />In Range</span>
              </div>
            </div>
            <div className="portfolio-command-stat-rail">
              {executiveStatRail.map((item) => (
                <div key={item.label}>
                  <span>{item.label}</span>
                  <strong className={item.tone || "neutral"}>{item.value}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="portfolio-command-change-card">
            <div className="portfolio-command-panel-head">
              <div>
                <h3>Trim / Add Summary</h3>
                <p>Highest-impact allocation changes from the current drift model.</p>
              </div>
            </div>
            <div className="portfolio-command-change-grid">
              <div>
                <span className="portfolio-command-column-label risk">Trim</span>
                <div className="portfolio-command-change-list">
                  {actionableRebalanceRows.filter((row) => row.action === "Trim").slice(0, 5).map((row) => (
                    <button key={`trim-${row.symbol}`} type="button" className="portfolio-command-change-row" onClick={() => openInsightFlow("rebalancing", row)}>
                      <strong>{row.symbol}</strong>
                      <em>{formatMoney(-Math.abs(row.tradeValue || 0))}</em>
                      <b>{formatSignedPercent(row.drift, 1)}</b>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <span className="portfolio-command-column-label positive">Add</span>
                <div className="portfolio-command-change-list">
                  {actionableRebalanceRows.filter((row) => row.action === "Add").slice(0, 5).map((row) => (
                    <button key={`add-${row.symbol}`} type="button" className="portfolio-command-change-row" onClick={() => openInsightFlow("rebalancing", row)}>
                      <strong>{row.symbol}</strong>
                      <em>{formatMoney(Math.abs(row.tradeValue || 0))}</em>
                      <b>{formatSignedPercent(Math.abs(row.drift || 0), 1)}</b>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="portfolio-command-impact-card">
            <div className="portfolio-command-panel-head">
              <div>
                <h3>Execution Impact</h3>
                <p>Estimated cost, readiness, and alignment improvement before you commit.</p>
              </div>
            </div>
            <div className="portfolio-command-impact-list">
              <div><span>Trade Count</span><strong>{rebalanceMetrics.tradesRequired}</strong></div>
              <div><span>Est. Fees</span><strong>{formatMoney(rebalanceMetrics.estimatedFees)}</strong></div>
              <div><span>Est. Slippage</span><strong>{formatMoney(rebalanceMetrics.estimatedSlippage)}</strong></div>
              <div><span>Projected Alignment</span><strong>{projectedAlignment.before.toFixed(0)}% → {projectedAlignment.after.toFixed(0)}%</strong></div>
            </div>
            <div className="portfolio-command-readiness">
              <span>Execution Readiness</span>
              <ul>
                <li className={liveAvailableBalance > 0 ? "positive" : "negative"}>{liveAvailableBalance > 0 ? "Sufficient cash" : "Low available cash"}</li>
                <li className={rebalanceMetrics.tradesRequired > 0 ? "positive" : "neutral"}>{rebalanceMetrics.tradesRequired > 0 ? "Actionable trade set" : "No trades required"}</li>
                <li className={feeDashboard.tradeCount > 0 ? "positive" : "neutral"}>{feeDashboard.tradeCount > 0 ? "Fee history available" : "Fee history still sparse"}</li>
              </ul>
            </div>
            <button type="button" className="portfolio-command-primary-cta" onClick={() => openInsightFlow("rebalancing", topDriftRow || null)}>
              Review &amp; Rebalance
            </button>
          </div>
        </div>
      </section>

      <section className="portfolio-command-analysis" ref={analysisSectionRef}>
        <div className="portfolio-command-tabs">
          {[
            { id: "holdings", label: "Holdings" },
            { id: "attribution", label: "Attribution" },
            { id: "exposure", label: "Exposure" },
            { id: "fees", label: "Fees" },
            { id: "prediction", label: "Event Risk", beta: true },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`portfolio-command-tab ${activePortfolioTab === tab.id ? "active" : ""}`}
              onClick={() => openPortfolioTab(tab.id)}
            >
              {tab.label}
              {tab.beta ? <small>Beta</small> : null}
            </button>
          ))}
        </div>
        <div className="portfolio-command-analysis-grid">
          <div className="portfolio-command-analysis-main">
            {renderPortfolioTabContent()}
          </div>
          <aside className="portfolio-command-analysis-rail">
            <section className="portfolio-command-side-card">
              <div className="portfolio-command-panel-head">
                <div>
                  <h3>Benchmark &amp; Risk</h3>
                  <p>Keep benchmark context visible without overwhelming the main workspace.</p>
                </div>
              </div>
              <div className="portfolio-command-side-list">
                {benchmarkRiskRows.map((row) => (
                  <div key={row.label}>
                    <span>{row.label}</span>
                    <strong className={row.tone || "neutral"}>{row.value}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="portfolio-command-side-card">
              <div className="portfolio-command-panel-head">
                <div>
                  <h3>Fees (YTD)</h3>
                  <p>Cost context and cheapest-avenue comparison.</p>
                </div>
              </div>
              <div className="portfolio-command-side-list">
                <div><span>Gross Fees Paid</span><strong>{formatMoney(feeDashboard.estimatedUsd)}</strong></div>
                <div><span>Annual Run Rate</span><strong>{feeDashboard.tradeCount ? `${((feeDashboard.estimatedUsd / Math.max(1, feeDashboard.tradeCount)) * 12).toFixed(2)}` : "N/A"}</strong></div>
                <div><span>vs Policy</span><strong className={feeDashboard.comparisonDeltaUsd <= 0 ? "positive" : "negative"}>{feeDashboard.comparison ? formatSignedMoney(-feeDashboard.comparisonDeltaUsd) : "N/A"}</strong></div>
              </div>
              <button type="button" className="portfolio-v2-link" onClick={() => setActivePortfolioTab("fees")}>View Details</button>
            </section>

            <section className="portfolio-command-side-card">
              <div className="portfolio-command-panel-head">
                <div>
                  <h3>Recent Activity</h3>
                  <p>Most recent trades and fills across the portfolio.</p>
                </div>
              </div>
              <div className="portfolio-command-activity-list">
                {recentActivityRows.length ? recentActivityRows.map((row) => (
                  <div key={row.id} className="portfolio-command-activity-row">
                    <div className="portfolio-command-activity-copy">
                      <strong>{row.symbol} · {row.side}</strong>
                      <span>{row.when}</span>
                    </div>
                    <div className="portfolio-command-activity-values">
                      <strong>{formatMoney(row.notional)}</strong>
                      <span>{row.qty.toFixed(2)} qty</span>
                    </div>
                  </div>
                )) : (
                  <div className="portfolio-command-empty">
                    <h3>No recent activity</h3>
                    <p>Trades will appear here once the portfolio starts moving.</p>
                  </div>
                )}
              </div>
            </section>
          </aside>
        </div>
      </section>

      {activePortfolioTab !== "prediction" ? (
        <section className="portfolio-command-prediction-strip">
          <div className="portfolio-command-panel-head">
            <div>
              <h3>Prediction Markets</h3>
              <p>Event-driven context for macro, policy, earnings, and cross-asset risk.</p>
            </div>
            <div className="portfolio-command-inline-actions">
              <span className="portfolio-command-beta-pill">Beta</span>
              <button type="button" className="portfolio-v2-link" onClick={() => onOpenPredictions?.()}>View All Prediction Markets</button>
            </div>
          </div>
          {demotedPredictionRows.length ? (
            <div className="portfolio-command-card-grid four">
              {demotedPredictionRows.map((row) => (
                <div key={row.market} className="portfolio-command-market-card">
                  <span>{row.market}</span>
                  <strong>{formatSignedMoney(row.pnl)}</strong>
                  <em>{row.netQty.toFixed(2)} qty</em>
                </div>
              ))}
            </div>
          ) : (
            <div className="portfolio-command-empty compact">
              <h3>No prediction market positions yet</h3>
              <p>Explore macro and event markets when you want portfolio context beyond traditional assets.</p>
            </div>
          )}
        </section>
      ) : null}

      {renderInsightFlow()}

      {showPredictionGuide ? (
        <div className="portfolio-v2-flow-overlay" onClick={() => setShowPredictionGuide(false)}>
          <div className="portfolio-v2-flow-shell" onClick={(event) => event.stopPropagation()}>
            <div className="portfolio-v2-flow-top">
              <h2>Prediction Markets in Zenin</h2>
              <button type="button" className="portfolio-v2-flow-close" onClick={() => setShowPredictionGuide(false)} aria-label="Close guide">✕</button>
            </div>
            <div className="portfolio-v2-flow-body">
              <div className="portfolio-v2-flow-card">
                <div className="portfolio-v2-flow-headline">
                  <h3>How it works</h3>
                  <span>Workspace preview</span>
                </div>
                <ul className="portfolio-v2-flow-bullets">
                  <li>Explore live event markets in Predictions, then add positions as you take them.</li>
                  <li>Portfolio tracks market P&amp;L separately from spot, options, and equity holdings.</li>
                  <li>These positions are informational until a live linked prediction account is connected.</li>
                </ul>
                <div className="portfolio-v2-flow-actions">
                  <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => {
                    setShowPredictionGuide(false);
                    onOpenPredictions?.();
                  }}>Open Predictions</button>
                  <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setShowPredictionGuide(false)}>Close</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {showDiversificationModal ? (
        <div className="modal-overlay" onClick={() => setShowDiversificationModal(false)}>
          <div className="modal-content portfolio-diversification-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header" style={{ marginBottom: "12px" }}>
              <div>
                <h2 style={{ margin: 0 }}>Diversification By Theme</h2>
                <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Theme exposure across your current stock picks.
                </p>
              </div>
              <button type="button" className="pagination-button" onClick={() => setShowDiversificationModal(false)}>
                Close
              </button>
            </div>

            {diversificationRows.length === 0 ? (
              <div className="loading-state">No themed holdings yet.</div>
            ) : (
              <div className="table-scroll">
                <table className="option-chain-table">
                  <thead>
                    <tr>
                      <th>Theme</th>
                      <th>Positions</th>
                      <th>Symbols</th>
                      <th>Exposure</th>
                      <th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diversificationRows.map((row) => (
                      <tr key={row.theme}>
                        <td className="greek">{row.theme}</td>
                        <td className="greek">{row.positions}</td>
                        <td className="greek">{row.symbols.join(", ") || "—"}</td>
                        <td className="bid-ask positive">
                          ${row.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="greek">{row.weight.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {selectedHolding ? (
        <div className="modal-overlay" onClick={() => setSelectedHolding(null)}>
          <div className="modal-content portfolio-diversification-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header" style={{ marginBottom: "10px" }}>
              <h2 style={{ margin: 0 }}>{selectedHolding.symbol} Detail</h2>
              <button type="button" className="pagination-button" onClick={() => setSelectedHolding(null)}>Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginBottom: "10px" }}>
              <div className="journal-stat-card"><span className="journal-stat-label">Value</span><span className="journal-stat-value">${Number(selectedHolding.positionValue || 0).toFixed(2)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">PnL</span><span className="journal-stat-value">{Number(selectedHolding.positionGain || 0) >= 0 ? "+" : ""}${Number(selectedHolding.positionGain || 0).toFixed(2)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">Quantity</span><span className="journal-stat-value">{Number(selectedHolding.quantity || 0).toFixed(2)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">Price</span><span className="journal-stat-value">${Number(selectedHolding.price || 0).toFixed(2)}</span></div>
            </div>
            <div style={{ borderTop: "1px solid rgba(148,163,184,0.14)", paddingTop: "10px", marginTop: "10px" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>Tax Lot Optimizer</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <select value={selectedTaxLotMethod} onChange={(e) => setSelectedTaxLotMethod(e.target.value)} style={{ background: "rgba(5,5,5,0.7)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.25)", borderRadius: "8px", padding: "4px 8px", fontSize: "12px" }}>
                  <option value="fifo">FIFO</option>
                  <option value="lifo">LIFO</option>
                  <option value="hifo">HIFO</option>
                  <option value="average">Average Cost</option>
                </select>
                <span style={{ fontSize: "12px", color: "#cbd5e1" }}>
                  Suggested lot method: <strong>{selectedTaxLotMethod.toUpperCase()}</strong> for this sale.
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <PortfolioSavedWorkspaceDrawer
        open={showSavedWorkspaceDrawer}
        onClose={() => setShowSavedWorkspaceDrawer(false)}
        savedViews={savedPortfolioViews}
        savedAlerts={savedPortfolioAlerts}
        savedQueue={savedPortfolioQueue}
        savedHistory={savedPortfolioHistory}
        savedExports={savedPortfolioExports}
        onApplyView={applySavedPortfolioView}
        onReviewItem={reviewSavedPortfolioItem}
      />
      <PortfolioConnectionsModal
        open={showConnectionsModal}
        onClose={() => setShowConnectionsModal(false)}
        accounts={connectedAccounts}
        onAddConnection={onOpenConnections}
      />
    </div>
  );
}

function PortfolioSavedWorkspaceDrawer({
  open,
  onClose,
  savedViews,
  savedAlerts,
  savedQueue,
  savedHistory,
  savedExports,
  onApplyView,
  onReviewItem
}) {
  if (!open) return null;

  const sections = [
    {
      title: "Saved Views",
      rows: savedViews,
      empty: "No saved portfolio views yet.",
      renderRow: (view) => (
        <SavedWorkspaceRow
          key={view.id}
          title={`${view.context || "portfolio"} · ${view.chartInterval || "1D"}`}
          subtitle={`${view.assetClassFilter || "all"} assets · ${formatSavedTimestamp(view.createdAt)}`}
          actionLabel="Apply"
          onAction={() => onApplyView(view)}
        />
      )
    },
    {
      title: "Exposure Alerts",
      rows: savedAlerts,
      empty: "No saved exposure alerts yet.",
      renderRow: (alert) => (
        <SavedWorkspaceRow
          key={alert.id}
          title={alert.name || alert.bucket || "Exposure alert"}
          subtitle={`${Number(alert.weight || 0).toFixed(1)}% weight · ${formatSavedTimestamp(alert.createdAt)}`}
          actionLabel="Open"
          onAction={() => onReviewItem("alert", alert)}
        />
      )
    },
    {
      title: "Queued Rebalances",
      rows: savedQueue,
      empty: "No queued rebalances yet.",
      renderRow: (item) => (
        <SavedWorkspaceRow
          key={item.id}
          title={`${item.context || "rebalance"} · ${Number(item.totalDrift || 0).toFixed(1)} drift`}
          subtitle={`${Number(item.tradesRequired || 0)} trades · ${formatSavedTimestamp(item.createdAt)}`}
          actionLabel="Open"
          onAction={() => onReviewItem("rebalance", item)}
        />
      )
    },
    {
      title: "Execution History",
      rows: savedHistory,
      empty: "No rebalance execution history yet.",
      renderRow: (item) => (
        <SavedWorkspaceRow
          key={item.id}
          title={String(item.status || "saved").toUpperCase()}
          subtitle={`${Number(item.summary?.tradeCount || item.trades?.length || 0)} trades · ${formatSavedTimestamp(item.createdAt)}`}
          actionLabel="Open"
          onAction={() => onReviewItem("history", item)}
        />
      )
    },
    {
      title: "Exports",
      rows: savedExports,
      empty: "No exports yet.",
      renderRow: (item) => (
        <SavedWorkspaceRow
          key={item.id}
          title={`${item.type || "export"} export`}
          subtitle={formatSavedTimestamp(item.createdAt)}
          actionLabel="Download"
          onAction={() => onReviewItem("export", item)}
        />
      )
    }
  ];

  return (
    <div className="home-v3-drawer-overlay" onMouseDown={onClose}>
      <aside
        className="home-v3-detail-drawer saved-items-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Saved items"
        style={{ maxWidth: 760 }}
      >
        <div className="home-v3-drawer-head">
          <h2>Saved Items</h2>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div className="saved-items-drawer-content">
          {sections.map((section) => (
            <section key={section.title} className="saved-items-section">
              <div className="saved-items-section-head">
                <strong>{section.title}</strong>
                <span>
                  {section.rows.length ? `${section.rows.length} saved item${section.rows.length === 1 ? "" : "s"}` : section.empty}
                </span>
              </div>
              {section.rows.length ? section.rows.map(section.renderRow) : null}
            </section>
          ))}
        </div>
      </aside>
    </div>
  );
}

function SavedWorkspaceRow({ title, subtitle, actionLabel, onAction }) {
  return (
    <div className="saved-items-row">
      <div className="saved-items-row-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      {actionLabel ? (
        <button type="button" className="portfolio-v2-link" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function PortfolioConnectionsModal({ open, onClose, accounts = [], onAddConnection }) {
  if (!open) return null;

  return (
    <div className="home-v3-drawer-overlay" onMouseDown={onClose}>
      <aside
        className="home-v3-detail-drawer saved-items-drawer portfolio-connections-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Connected exchanges"
        style={{ maxWidth: 760 }}
      >
        <div className="home-v3-drawer-head">
          <div className="saved-items-section-head">
            <strong>Connected Exchanges</strong>
            <span>{accounts.length ? `${accounts.length} connected venue${accounts.length === 1 ? "" : "s"}` : "No connected venues yet."}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div className="saved-items-drawer-content">
          {accounts.length ? (
            <section className="saved-items-section">
              {accounts.map((account) => (
                <div key={account.id || `${account.exchange}-${account.username}`} className="saved-items-row connection-row">
                  <div className="saved-items-row-copy">
                    <strong>{account.provider || account.exchange || "Connected venue"}</strong>
                    <span>{account.username || "Workspace source"} · {String(account.venueType || "cex").toUpperCase()}</span>
                  </div>
                  <div className="saved-items-row-meta">
                    <em>{account.canTrade ? "Trading-enabled" : "Read-only"}</em>
                    <span>{account.lastSyncAt ? `Synced ${formatSavedTimestamp(account.lastSyncAt)}` : "Sync pending"}</span>
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <section className="saved-items-section">
              <div className="saved-items-empty">
                <strong>No exchanges connected</strong>
                <span>Connect a venue to unlock portfolio sync, execution context, and shared desk monitoring.</span>
              </div>
            </section>
          )}
          <div className="saved-items-drawer-actions">
            <button type="button" className="portfolio-v2-link" onClick={onClose}>Close</button>
            <button type="button" className="portfolio-command-primary-cta subtle" onClick={() => { onClose(); onAddConnection?.(); }}>
              Add Connection
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
