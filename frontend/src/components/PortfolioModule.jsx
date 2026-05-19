import { useEffect, useMemo, useRef, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { TradingViewChart } from "./TradingViewChart";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { formatCurrency, getCurrencySymbol, convertToUSD, convertFromUSD, DEFAULT_FX_RATES } from "../utils/currencyUtils";
import { hasWorkspaceSession, loadWorkspaceDoc, saveWorkspaceCollection, saveWorkspaceDoc } from "../utils/workspacePersistence";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { PortfolioInstitutionalSuite } from "./InstitutionalPanels";

const PORTFOLIO_VIEW_STORAGE_KEY = "zenin_portfolio_view_state_v1";
const PORTFOLIO_SAVED_VIEWS_KEY = "zenin_portfolio_saved_views";
const PORTFOLIO_ALERTS_KEY = "zenin_portfolio_alerts";
const PORTFOLIO_REBALANCE_QUEUE_KEY = "zenin_portfolio_rebalance_queue";
const PORTFOLIO_REBALANCE_HISTORY_KEY = "zenin_portfolio_rebalance_history";
const PORTFOLIO_EXPORTS_KEY = "zenin_portfolio_exports";
const JOURNAL_STORAGE_KEY = "zenin_journal_entries";
const FEE_SOURCE_EXCHANGE_REPORTED = "exchange_reported";
const FEE_SOURCE_CHEAPEST_AVENUE = "cheapest_avenue";

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
  onOpenConnections
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
  const [showPredictionGuide, setShowPredictionGuide] = useState(false);
  const [showSavedWorkspaceDrawer, setShowSavedWorkspaceDrawer] = useState(false);
  const isSyncing = false;
  const [rebalanceEstimate, setRebalanceEstimate] = useState(null);
  const [rebalanceEstimateStatus, setRebalanceEstimateStatus] = useState("idle");
  const [savedPortfolioViews, setSavedPortfolioViews] = useState(() => readStoredJson(PORTFOLIO_SAVED_VIEWS_KEY, []));
  const [savedPortfolioAlerts, setSavedPortfolioAlerts] = useState(() => readStoredJson(PORTFOLIO_ALERTS_KEY, []));
  const [savedPortfolioQueue, setSavedPortfolioQueue] = useState(() => readStoredJson(PORTFOLIO_REBALANCE_QUEUE_KEY, []));
  const [savedPortfolioHistory, setSavedPortfolioHistory] = useState(() => readStoredJson(PORTFOLIO_REBALANCE_HISTORY_KEY, []));
  const [savedPortfolioExports, setSavedPortfolioExports] = useState(() => readStoredJson(PORTFOLIO_EXPORTS_KEY, []));
  const prefsHydratedRef = useRef(false);
  const getSaveTargetLabel = () => hasWorkspaceSession() ? "your Zenin workspace" : "this browser";

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
                  <em>{row.risk.replace("-", " ")}</em>
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
    <div className="portfolio-module portfolio-v2 portfolio-exec-page">
      <div className="portfolio-v2-head portfolio-exec-head">
        <div className="portfolio-v2-title-row portfolio-exec-heading">
          <h2>Portfolio</h2>
        </div>
        <div className="portfolio-v2-toolbar portfolio-exec-toolbar" style={{ justifyContent: "space-between", gap: "16px", flexWrap: "wrap" }}>
          <div className="portfolio-exec-toolbar-group portfolio-exec-toolbar-meta">
            <span className={`portfolio-exec-sync ${isSyncing ? "syncing" : ""}`}>
              {isSyncing ? "Syncing venues" : `Synced ${formatSavedTimestamp(feeDashboard.updatedAt || Date.now())}`}
            </span>
          </div>
          <div className="portfolio-exec-toolbar-group portfolio-exec-toolbar-actions" style={{ gap: "12px", flexWrap: "wrap" }}>
            <select
              value={assetClassFilter}
              onChange={(e) => setAssetClassFilter(e.target.value)}
              className="portfolio-v2-select"
              aria-label="Account scope"
            >
              <option value="all">All Accounts</option>
              <option value="equities">Equities</option>
              <option value="crypto">Crypto</option>
              <option value="options">Options</option>
              <option value="commodities">Commodities</option>
            </select>
            <button
              type="button"
              className="portfolio-v2-link"
              onClick={onOpenConnections}
            >
              Connections
            </button>
            <button
              type="button"
              className="portfolio-v2-link secondary"
              onClick={() => setShowSavedWorkspaceDrawer(true)}
            >
              Saved Items{savedWorkspaceCount ? ` (${savedWorkspaceCount})` : ""}
            </button>
            <div className="portfolio-v2-range portfolio-exec-timeframe-strip">
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
          </div>
        </div>
      </div>

      <div className="portfolio-exec-hero-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "16px" }}>
        <article className="portfolio-v2-stat-card portfolio-exec-rail-card">
          <span className="label">Total Account Equity</span>
          <strong>{formatMoney(currentAccountEquity)}</strong>
          <span className={`delta ${totalGainLoss >= 0 ? "positive" : "negative"}`}>
            {formatSignedMoney(totalGainLoss)} ({totalReturnPct >= 0 ? "+" : ""}{totalReturnPct.toFixed(2)}%)
          </span>
        </article>
        <article className="portfolio-v2-stat-card portfolio-exec-rail-card">
          <span className="label">Cash &amp; Liquidity</span>
          <strong>{formatMoney(liveAvailableBalance)}</strong>
          <span className="sub">{cashWeight.toFixed(1)}% of portfolio</span>
        </article>
        <article className="portfolio-v2-stat-card portfolio-exec-rail-card">
          <span className="label">Best Performing</span>
          <strong>{bestPerformer?.symbol || "N/A"}</strong>
          <span className={`delta ${Number(bestPerformer?.priceChangePercent || 0) >= 0 ? "positive" : "negative"}`}>
            {bestPerformer ? `${Number(bestPerformer.priceChangePercent || 0) >= 0 ? "+" : ""}${Number(bestPerformer.priceChangePercent || 0).toFixed(2)}%` : "No data"}
          </span>
        </article>
        <article className="portfolio-v2-stat-card portfolio-exec-rail-card">
          <span className="label">Exposure Summary</span>
          <div className="portfolio-v2-mini-grid">
            <div><span>Sector</span><strong>{exposureSummary.sector?.name || "Unclassified"}</strong></div>
            <div><span>Country</span><strong>{exposureSummary.country?.name || "Global"}</strong></div>
            <div><span>Currency</span><strong>{exposureSummary.currency?.name || "USD"}</strong></div>
          </div>
        </article>
      </div>

      <div className="portfolio-v2-main-grid portfolio-exec-main-grid" style={{ marginTop: "16px" }}>
        <div className="portfolio-v2-left">
          <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-performance-panel" style={{ marginBottom: "16px" }}>
        <div className="section-header portfolio-exec-section-head">
          <div className="portfolio-exec-section-title-row">
            <h2>Portfolio Performance</h2>
            <p style={{ margin: "4px 0 0", color: "var(--color-text-secondary)", fontSize: "12px" }}>
              Account curve with benchmark overlay
            </p>
          </div>
          <div className="portfolio-exec-control-row">
            {[
              ["equity", "Equity"],
              ["percentage", "% Gain"],
              ["pnl", "Cash PnL"]
            ].map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={`portfolio-v2-range-btn ${chartMode === mode ? "active" : ""}`}
                onClick={() => setChartMode(mode)}
              >
                {label}
              </button>
            ))}
            <select
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value)}
              className="portfolio-v2-select"
              aria-label="Currency"
            >
              {g7Currencies.map(curr => (
                <option key={curr} value={curr}>{curr}</option>
              ))}
            </select>

            <select
              value={benchmarkSymbol}
              onChange={(event) => setBenchmarkSymbol(event.target.value)}
              className="portfolio-v2-select"
              aria-label="Benchmark"
            >
              <option value="SPY">SPY</option>
              <option value="QQQ">QQQ</option>
              <option value="ACWI">ACWI</option>
            </select>
          </div>
        </div>
        <TradingViewChart
          options={portfolioChartOptions}
          series={portfolioPerformanceSeries}
          priceLines={portfolioPerformanceLines}
          valueFormatter={(value) => yFormatter(Number(value))}
          timeFormatter={formatPortfolioChartTime}
          height={320}
          width="100%"
        />
        <div className="portfolio-exec-chart-footer">
          {[
            ["Best Period", performanceSnapshot.bestPeriod],
            ["Worst Period", performanceSnapshot.worstPeriod],
            ["Max DD", performanceSnapshot.maxDrawdown],
            ["Current DD", performanceSnapshot.currentDrawdown]
          ].map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong className={String(value).startsWith("-") ? "negative" : label.includes("Worst") || label.includes("DD") ? "neutral" : "positive"}>{value}</strong>
            </div>
          ))}
        </div>
      </section>

          <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-holdings-panel">
            <div className="section-header portfolio-exec-section-head">
              <h2>Holdings &amp; Positions</h2>
              <div className="portfolio-exec-inline-controls">
                <span className="asset-count">{holdingsTableRows.length} Positions</span>
                <select
                  value={holdingsSortBy}
                  onChange={(e) => setHoldingsSortBy(e.target.value)}
                  className="portfolio-v2-select"
                >
                  <option value="value">Sort: Value</option>
                  <option value="pnl">Sort: PnL</option>
                  <option value="return">Sort: Return</option>
                  <option value="risk">Sort: Risk</option>
                </select>
              </div>
            </div>
            <div className="portfolio-v2-table-wrap">
              <table className="portfolio-v2-table">
                <thead>
                  <tr>
                    <th>Symbol / Name</th>
                    <th>Allocation</th>
                    <th>Mark / Value</th>
                    <th>P&amp;L</th>
                    <th>Funding / OI</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingsTableRows.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="portfolio-v2-empty" style={{ padding: '40px 20px', textAlign: 'center' }}>
                          <div className="portfolio-v2-empty-icon" style={{ fontSize: '32px', marginBottom: '12px', opacity: 0.5 }}>📊</div>
                          <h3 style={{ margin: '0 0 8px', color: 'var(--color-text-primary)' }}>No positions found</h3>
                          <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '13px' }}>Your portfolio is currently empty. Add assets from the watchlist or search to start tracking.</p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    holdingsTableRows.map((row) => (
                      <tr
                        key={row.key}
                        role={row.kind === "spot" ? "button" : undefined}
                        tabIndex={row.kind === "spot" ? 0 : undefined}
                        onClick={() => row.kind === "spot" ? onSelectAsset?.(row.raw) : null}
                        onKeyDown={(event) => {
                          if (row.kind !== "spot") return;
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onSelectAsset?.(row.raw);
                          }
                        }}
                      >
                        <td>
                          <div className="portfolio-v2-symbol-cell">
                            <div className="portfolio-v2-symbol-avatar">{row.symbol?.slice(0, 1) || "?"}</div>
                            <div>
                              <strong>{row.symbol || "Unknown"}</strong>
                              <span>{row.name || ""}</span>
                            </div>
                          </div>
                        </td>
                        <td>{(row.allocation || 0).toFixed(2)}%</td>
                        <td>
                          <div className="portfolio-v2-stack">
                            <strong>{row.markValueMain || "$0.00"}</strong>
                            <span>{row.markValueSub || "0.00"}</span>
                          </div>
                        </td>
                        <td>
                          <div className={`portfolio-v2-stack ${row.pnlPositive ? "positive" : "negative"}`}>
                            <strong>{row.pnlMain || "$0.00"}</strong>
                            <span>{row.pnlSub || "0.00%"}</span>
                          </div>
                        </td>
                        <td>
                          {row.marketType === "perp" ? (
                            <div className="portfolio-v2-stack" style={{ fontSize: '11px' }}>
                              <strong style={{ color: 'var(--color-brand-cyan)' }}>{row.fundingRate != null ? `${(row.fundingRate * 100).toFixed(4)}%` : "—"}</strong>
                              <span style={{ color: 'var(--color-text-secondary)' }}>{row.openInterest != null ? formatMoney(row.openInterest) : "—"}</span>
                            </div>
                          ) : (
                            <span style={{ color: 'var(--color-text-secondary)', fontSize: '11px' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span className={`portfolio-v2-status ${row.statusClass || ""}`}>{row.status || "Open"}</span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><span>Total Account Equity</span> <strong>{formatMoney(currentAccountEquity)}</strong></td>
                    <td colSpan={4}><span>Total Gain/Loss</span> <strong className={totalGainLoss >= 0 ? "positive" : "negative"}>{formatSignedMoney(totalGainLoss)} ({totalReturnPct >= 0 ? "+" : ""}{totalReturnPct.toFixed(2)}%)</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="portfolio-v2-two-col">
            <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-attribution-panel">
              <div className="section-header portfolio-exec-section-head">
                <h2>Performance Attribution</h2>
                <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("attribution")}>View Flow</button>
              </div>
              <div className="portfolio-v2-guided-strip" aria-label="Performance attribution workflow">
                {["Overview", "Drill down", "Top contributors", "Save insight", "Export"].map((step, idx) => (
                  <button
                    key={`attrib-step-${step}`}
                    type="button"
                    className={insightFlowStep === idx + 1 && activeInsightFlow === "attribution" ? "active" : ""}
                    onClick={() => {
                      setActiveInsightFlow("attribution");
                      setInsightFlowStep(idx + 1);
                    }}
                  >
                    {step}
                  </button>
                ))}
              </div>
              <div className="portfolio-v2-attrib-grid">
                {[{ key: "sector", label: "By Sector" }, { key: "region", label: "By Region" }, { key: "factor", label: "By Factor" }].map((group) => {
                  const first = attributionRows[group.key]?.[0];
                  return (
                    <button
                      key={group.key}
                      type="button"
                      className="portfolio-v2-attrib-card"
                      onClick={() => openInsightFlow("attribution", first || null)}
                    >
                      <span>{group.label}</span>
                      <strong>{first?.name || "Unclassified"}</strong>
                      <em className={(first?.pnl || 0) >= 0 ? "positive" : "negative"}>
                        {first ? formatSignedMoney(first.pnl) : "$0.00"}
                      </em>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-exposure-panel">
              <div className="section-header portfolio-exec-section-head">
                <h2>Exposure Heatmap</h2>
                <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("exposure")}>View Flow</button>
              </div>
              <div className="portfolio-v2-guided-strip" aria-label="Exposure heatmap workflow">
                {["Sector", "Cell detail", "Holdings", "Risk", "Alert"].map((step, idx) => (
                  <button
                    key={`exposure-step-${step}`}
                    type="button"
                    className={insightFlowStep === idx + 1 && activeInsightFlow === "exposure" ? "active" : ""}
                    onClick={() => {
                      setActiveInsightFlow("exposure");
                      setInsightFlowStep(idx + 1);
                    }}
                  >
                    {step}
                  </button>
                ))}
              </div>
              <div className="portfolio-v2-heatmap">
                {exposureRows.slice(0, 3).map((row) => (
                  <button
                    key={`${row.bucket}-${row.name}`}
                    type="button"
                    className="portfolio-v2-heat-cell"
                    onClick={() => openInsightFlow("exposure", row)}
                  >
                    <span>{row.bucket}</span>
                    <strong>{row.name}</strong>
                    <em>{row.weight.toFixed(1)}%</em>
                  </button>
                ))}
              </div>
            </section>
          </div>

          <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-predictions-panel">
            <div className="section-header portfolio-exec-section-head">
              <div className="portfolio-exec-section-title-row">
                <h2>Prediction Markets</h2>
                <p className="portfolio-v2-section-kicker">Event-driven exposures tracked beside equities, options, and crypto.</p>
              </div>
              <div className="asset-count">{predictionMarketRows.length} Markets</div>
            </div>
            {predictionMarketRows.length === 0 ? (
              <div className="portfolio-v2-empty">
                <div className="portfolio-v2-empty-icon">↗</div>
                <h3>No prediction market positions yet</h3>
                <p>Track event-driven opportunities across markets, macro, crypto, and equities.</p>
                <div className="portfolio-v2-empty-actions">
                  <button type="button" className="portfolio-v2-link" onClick={() => onOpenPredictions?.()}>Explore Markets</button>
                  <button type="button" className="portfolio-v2-link secondary" onClick={() => setShowPredictionGuide(true)}>Learn how it works</button>
                </div>
              </div>
            ) : (
              <div className="portfolio-v2-activity-list portfolio-exec-market-list">
                {predictionMarketRows.slice(0, 6).map((row) => (
                  <div key={row.market} className="portfolio-v2-activity-row">
                    <div className="portfolio-v2-activity-main">
                      <strong>{row.market}</strong>
                      <span>{row.netQty.toFixed(2)} qty</span>
                    </div>
                    <div className={`portfolio-v2-activity-pnl ${row.pnl >= 0 ? "positive" : "negative"}`}>{formatSignedMoney(row.pnl)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
        <aside className="portfolio-v2-right">
          <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-metrics-panel">
            <div className="section-header portfolio-exec-section-head"><h2>Performance Metrics</h2></div>
            <div className="portfolio-v2-metric-list">
              {[
                { label: "Sharpe Ratio", value: metrics.sharpe },
                { label: "Sortino Ratio", value: metrics.sortino },
                { label: "Max Drawdown", value: `${metrics.maxDrawdown}%` },
                { label: "Alpha (Jensen's)", value: metrics.alpha },
                { label: "Beta", value: metrics.beta }
              ].map((m) => (
                <div key={m.label} className="portfolio-v2-metric-row">
                  <span>{m.label}</span>
                  <strong className={m.label === "Max Drawdown" ? "positive" : Number(m.value) < 0 ? "negative" : ""}>{m.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-fees-panel">
            <div className="section-header portfolio-exec-section-head">
              <div className="portfolio-exec-section-title-row">
                <h2>Fees Paid</h2>
                <p style={{ margin: "4px 0 0", color: "var(--color-text-secondary)", fontSize: "12px" }}>
                  Historical execution fees across connected venues and cheapest-avenue executions
                </p>
              </div>
            </div>
            {feeDashboard.tradeCount > 0 ? (
              <>
                <div className="portfolio-v2-metric-list" style={{ marginBottom: "12px" }}>
                  <div className="portfolio-v2-metric-row">
                    <span>Total Paid</span>
                    <strong>{formatMoney(feeDashboard.estimatedUsd)}</strong>
                  </div>
                  <div className="portfolio-v2-metric-row">
                    <span>Charged Trades</span>
                    <strong>{feeDashboard.tradeCount}</strong>
                  </div>
                  <div className="portfolio-v2-metric-row">
                    <span>Recorded Fills</span>
                    <strong>{feeDashboard.fillCount}</strong>
                  </div>
                </div>
                <div className="portfolio-v2-activity-list">
                  {feeDashboard.platforms.slice(0, 5).map((row) => (
                    <div key={`fee-platform-${row.platform}`} className="portfolio-v2-activity-row" style={{ alignItems: "flex-start" }}>
                      <div className="portfolio-v2-activity-main">
                        <strong>{row.label}</strong>
                        <span>{row.breakdown}</span>
                      </div>
                      <div style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: "4px" }}>
                        <strong>{formatMoney(row.estimatedUsd)}</strong>
                        <span style={{ color: "var(--color-text-secondary)", fontSize: "11px" }}>{row.tradeCount} trades</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="portfolio-v2-empty" style={{ padding: "12px 0 0", textAlign: "left" }}>
                  <p style={{ margin: 0 }}>
                    Breakdown: {feeDashboard.breakdown}
                  </p>
                  {feeDashboard.comparison && feeDashboard.comparison.benchmarkEligibleFillCount > 0 ? (
                    <>
                      <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                        Comparison on synced venue fills:
                      </p>
                      <p style={{ margin: "6px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                        {formatFeeSourceLabel(FEE_SOURCE_EXCHANGE_REPORTED)}: {formatMoney(feeDashboard.comparison.exchangeReported.estimatedUsd)} across {feeDashboard.comparison.exchangeReported.fillCount} fills
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                        {formatFeeSourceLabel(FEE_SOURCE_CHEAPEST_AVENUE)} benchmark: {formatMoney(feeDashboard.comparison.cheapestAvenueBenchmark.estimatedUsd)} across {feeDashboard.comparison.benchmarkEligibleFillCount} comparable fills
                      </p>
                      <p style={{ margin: "4px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                        {feeDashboard.comparisonDeltaUsd > 0
                          ? `Potential savings versus the cheapest avenue benchmark: ${formatMoney(feeDashboard.comparisonDeltaUsd)}.`
                          : feeDashboard.comparisonDeltaUsd < 0
                            ? `Exchange-reported fees came in ${formatMoney(Math.abs(feeDashboard.comparisonDeltaUsd))} below the cheapest avenue benchmark.`
                            : "Exchange-reported fees are aligned with the cheapest avenue benchmark."}
                      </p>
                    </>
                  ) : null}
                  {feeDashboard.comparison?.cheapestAvenueObserved?.fillCount > 0 ? (
                    <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                      Cheapest avenue executions recorded: {formatMoney(feeDashboard.comparison.cheapestAvenueObserved.estimatedUsd)} across {feeDashboard.comparison.cheapestAvenueObserved.fillCount} fills.
                    </p>
                  ) : null}
                  {Array.isArray(feeDashboard.sources) && feeDashboard.sources.length > 0 ? (
                    <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                      Sources: {feeDashboard.sources.map((row) => `${formatFeeSourceLabel(row.source)} (${row.fillCount})`).join(" · ")}
                    </p>
                  ) : null}
                  {feeDashboard.unknownCurrencies.length > 0 ? (
                    <p style={{ margin: "8px 0 0", fontSize: "11px", color: "var(--color-text-secondary)" }}>
                      Some fee assets were kept in native units: {feeDashboard.unknownCurrencies.join(", ")}.
                    </p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="portfolio-v2-empty">
                <div className="portfolio-v2-empty-icon">%</div>
                <h3>No recorded fees yet</h3>
                <p>Sync a connected exchange or execute trades through the portfolio flow to populate your fee history.</p>
              </div>
            )}
          </section>

          <section className="watchlist-panel glass portfolio-v2-panel portfolio-exec-panel portfolio-exec-rebalance-panel">
            <div className="section-header portfolio-exec-section-head">
              <div className="portfolio-exec-section-title-row">
                <h2>Rebalancing Suggestions</h2>
                <p style={{ margin: "4px 0 0", color: "var(--color-text-secondary)", fontSize: "12px" }}>
                  Drift, target weight, and action queue.
                </p>
              </div>
              <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("rebalancing", rebalanceSuggestions[0] || null)}>View Flow</button>
            </div>
            <div className="portfolio-exec-rebalance-list">
              {rebalanceSuggestions.slice(0, 5).map((row) => (
                <button
                  key={`reb-side-${row.symbol}`}
                  type="button"
                  className="portfolio-exec-rebalance-row"
                  onClick={() => row.action !== "Hold" && openInsightFlow("rebalancing", row)}
                >
                  <span>{row.symbol}</span>
                  <strong className={row.drift >= 0 ? "negative" : "positive"}>{row.drift >= 0 ? "+" : ""}{row.drift.toFixed(2)}%</strong>
                  <em>{row.action}</em>
                </button>
              ))}
              {rebalanceSuggestions.length === 0 ? (
                <div className="portfolio-v2-empty">
                  <h3>No drift detected</h3>
                  <p>Add holdings to generate target-weight suggestions.</p>
                </div>
              ) : null}
            </div>
          </section>

        </aside>
      </div>

      <PortfolioInstitutionalSuite
        portfolio={filteredPortfolio}
        trades={filteredTrades}
        activeOptionsTrades={filteredOptionsTrades}
        benchmarkSymbol={benchmarkSymbol}
        currency={displayCurrency}
        balance={liveAvailableBalance}
        onOpenConnections={onOpenConnections}
      />
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
        className="home-v3-detail-drawer"
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
        <div style={{ display: "grid", gap: 18 }}>
          {sections.map((section) => (
            <section key={section.title} style={{ display: "grid", gap: 10 }}>
              <div>
                <strong style={{ display: "block", marginBottom: 4 }}>{section.title}</strong>
                <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>
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
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        alignItems: "center",
        padding: "12px 14px",
        borderRadius: 3,
        border: "1px solid rgba(148, 163, 184, 0.14)",
        background: "var(--color-surface-card)"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: "block" }}>{title}</strong>
        <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>{subtitle}</span>
      </div>
      {actionLabel ? (
        <button type="button" className="portfolio-v2-link" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
