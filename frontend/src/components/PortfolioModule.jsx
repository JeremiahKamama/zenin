import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import ReactApexChart from "react-apexcharts";
import { DataTable } from "./data-table/DataTable";
import { TradingViewChart } from "./TradingViewChart";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { chartColors } from "../utils/chartTheme";
import { formatCurrency, getCurrencySymbol, convertToUSD, convertFromUSD, DEFAULT_FX_RATES } from "../utils/currencyUtils";
import { PortfolioDrillDown } from "./PortfolioDrillDown";
import { PortfolioActivity } from "./PortfolioActivity";
import { deriveBrokerageBadge, formatLastSync, maskAccountNumber, findDuplicateSymbols } from "../utils/brokerageStatus.js";
import { classifyPortfolioInstrument, PORTFOLIO_BUCKETS } from "../utils/portfolioInstrumentClassifier.js";
import { formatPercent } from "../utils/format";
import { hasWorkspaceSession, loadWorkspaceDoc, saveWorkspaceCollection, saveWorkspaceDoc } from "../utils/workspacePersistence";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import {
  fetchPerformanceHistory,
  buildEquitySeries,
  buildBenchmarkSeries,
  computePerformanceMetrics
} from "../utils/performanceHistory";
import { WorkspaceScopeSelector } from "./WorkspaceScopeSelector";
// Portfolio Intelligence — feature modules + normalized data layer.
import { PortfolioOverview } from "./portfolioIntelligence/PortfolioOverview";
import { PortfolioAnalysis, PORTFOLIO_ANALYSIS_TABS } from "./portfolioIntelligence/PortfolioAnalysis";
import { useRegimeIntelligence } from "./portfolioIntelligence/useRegimeIntelligence";
import { deriveOrderLedgerFromConnections } from "./portfolioIntelligence/services/OrderNormalizationService";
import { normalizeExecutions } from "./portfolioIntelligence/services/ExecutionService";
import { buildAlerts } from "./portfolioIntelligence/services/AlertEngine";
import { relatedByKind, NODE_KIND } from "../utils/relationshipGraph";
import { createPortfolioHealth } from "./portfolioIntelligence/models/domainModels";
import { NotificationTransmission } from "../transmission/TransmissionSurfaces";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { DeferredChart } from "./DeferredChart.jsx";
import { EtfRecommendations } from "./EtfRecommendations";
import { CORE_ETF_SEED } from "../utils/assetGraph";

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

// Weight → risk tier (single source of truth; mirrors exposureFlowData.classify).
function riskForWeight(weight) {
  const w = Number(weight || 0);
  if (w >= 50) return "very-high";
  if (w >= 25) return "high";
  if (w >= 10) return "moderate";
  return "low";
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

function formatVenueLabel(value) {
  return String(value || "Connected platform")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatExecutionTimestamp(value) {
  const timestamp = new Date(value || Date.now());
  if (Number.isNaN(timestamp.getTime())) return "Unknown time";
  return timestamp.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatExecutionQuantity(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "0";
  return amount.toLocaleString(undefined, { maximumFractionDigits: amount < 1 ? 8 : 4 });
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
  apiTradeExecutions = [],
  workspaceNotifications = [],
  unreadNotificationCount = 0,
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
  brokerageAccounts = [],
  brokerageSummary = null,
  onConnectBrokerage,
  onOpenPlans,
  indicatorContext,
  unifiedPortfolio = null
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
  // Immutable snapshot history (single source of truth for the Performance
  // Curve). Fetched from GET /api/history/range — never reconstructed from trades.
  const [snapshotHistory, setSnapshotHistory] = useState([]);
  const [historyStatus, setHistoryStatus] = useState("idle"); // idle|loading|ready|empty|error
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
  const [historyFilters, setHistoryFilters] = useState({ platform: "all", side: "all", symbol: "" });
  const [selectedExecution, setSelectedExecution] = useState(null);
  const [showPredictionGuide, setShowPredictionGuide] = useState(false);
  const [showSavedWorkspaceDrawer, setShowSavedWorkspaceDrawer] = useState(false);
  const [showAttentionDrawer, setShowAttentionDrawer] = useState(false);
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
  const openPortfolioTab = (tabId, { scroll = true } = {}) => {
    setActivePortfolioTab(tabId);
    if (!scroll) return;
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

  const apiExecutionRows = useMemo(() => {
    const rows = Array.isArray(apiTradeExecutions) ? apiTradeExecutions : [];
    return rows
      .filter((execution) => execution && execution.source === "api_connection")
      .filter((execution) => String(execution.platform || "").trim())
      .filter((execution) => {
        if (assetClassFilter === "all") return true;
        const marketType = String(execution.marketType || "").toLowerCase();
        if (assetClassFilter === "equities") return ["stock", "equity", "etf"].includes(marketType);
        if (assetClassFilter === "options") return marketType.includes("option");
        if (assetClassFilter === "commodities") return ["commodity", "commodities", "future", "futures"].includes(marketType);
        if (assetClassFilter === "crypto") return ["spot", "perp", "crypto"].includes(marketType);
        return true;
      })
      .filter((execution) => historyFilters.platform === "all" || execution.platform === historyFilters.platform)
      .filter((execution) => historyFilters.side === "all" || execution.side === historyFilters.side)
      .filter((execution) => {
        const symbol = String(historyFilters.symbol || "").trim().toUpperCase();
        if (!symbol) return true;
        return String(execution.symbol || "").toUpperCase().includes(symbol);
      })
      .sort((a, b) => new Date(b.executedAt || 0).getTime() - new Date(a.executedAt || 0).getTime());
  }, [apiTradeExecutions, assetClassFilter, historyFilters]);

  const executionPlatformOptions = useMemo(() => {
    return [...new Set((Array.isArray(apiTradeExecutions) ? apiTradeExecutions : [])
      .map((execution) => execution?.platform)
      .filter(Boolean))]
      .sort()
      .map((platform) => ({ value: platform, label: formatVenueLabel(platform) }));
  }, [apiTradeExecutions]);

  const recentExecutionNotifications = useMemo(() => {
    return (Array.isArray(workspaceNotifications) ? workspaceNotifications : [])
      .filter((item) => {
        const type = String(item?.type || "");
        return type.startsWith("portfolio_transaction.");
      })
      .slice(0, 5);
  }, [workspaceNotifications]);

  const filteredPortfolio = useMemo(() => {
    // When the unified read model is active and connected sources have data,
    // the legacy manual holdings are stale — exclude them from display.
    if (unifiedPortfolio?.isUnified && (unifiedPortfolio.sources || []).some((s) => s.sourceType !== "manual" && s.positionCount > 0)) {
      return [];
    }
    if (assetClassFilter === "all") return portfolio;
    return (portfolio || []).filter(p => {
      const type = String(p.type || p.marketType || "").toLowerCase();
      if (assetClassFilter === "equities") return ["stock", "equity", "etf"].includes(type);
      if (assetClassFilter === "commodities") return ["commodity", "commodities", "future", "futures"].includes(type);
      if (assetClassFilter === "crypto") return type === "crypto";
      return false;
    });
  }, [portfolio, assetClassFilter, unifiedPortfolio]);

  const filteredOptionsTrades = useMemo(() => {
    if (assetClassFilter === "all" || assetClassFilter === "options") return activeOptionsTrades;
    return [];
  }, [activeOptionsTrades, assetClassFilter]);

  // ✅ 1) compute portfolioValue first
  const portfolioValue = useMemo(() => {
    return (filteredPortfolio || []).reduce((sum, item) => sum + ((Number(item?.price) || 0) * (Number(item?.quantity) || 0)), 0);
  }, [filteredPortfolio]);

  // Brokerage (SnapTrade pilot) read-model split. Manual and brokerage holdings
  // stay SEPARATE by design — we never auto-merge same-symbol positions. The
  // aggregate is only used for the headline value; connected holdings render in
  // their own group with source attribution + a duplicate-exposure notice.
  const brokerageReadModel = useMemo(() => {
    const manualHoldings = Array.isArray(filteredPortfolio) ? filteredPortfolio : [];
    const manualValue = portfolioValue;
    const brokerageHoldings = Array.isArray(brokerageSummary?.holdings) ? brokerageSummary.holdings : [];
    const brokerageValue = Number(brokerageSummary?.brokerageValue) || 0;
    const aggregateValue = manualValue + brokerageValue;
    const duplicateSymbols = findDuplicateSymbols(manualHoldings, brokerageHoldings);
    return {
      manualHoldings,
      brokerageHoldings,
      manualValue,
      brokerageValue,
      aggregateValue,
      duplicateSymbols,
      lastSyncAt: brokerageSummary?.lastSyncAt || null,
      requiresReconnect: Boolean(brokerageSummary?.requiresReconnect),
      syncFailed: Boolean(brokerageSummary?.syncFailed)
    };
  }, [filteredPortfolio, portfolioValue, brokerageSummary]);

// ✅ 2) compute metrics next — when unified is active, suppress stale legacy balance
const effectiveBalance = unifiedPortfolio?.isUnified && (unifiedPortfolio.sources || []).some((s) => s.sourceType !== "manual" && s.positionCount > 0)
  ? 0
  : balance;
const derivedAccountMetrics = useMemo(
  () =>
    calculateAccountSnapshot({
      trades: filteredTrades,
      portfolioValue,
      balance: assetClassFilter === "all" ? effectiveBalance : 0,
    }),
  [filteredTrades, portfolioValue, effectiveBalance, assetClassFilter]
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

// Prefer the unified multi-source total when available (Hyperliquid perps +
// cash). Falls back to the legacy snapshot only when unified is absent.
const currentAccountEquity =
  unifiedPortfolio?.isUnified && Number.isFinite(Number(unifiedPortfolio.totalValue))
    ? Number(unifiedPortfolio.totalValue)
    : totalAccountEquity;

const isProfitable = currentAccountEquity >= initialBalance;
  const chartColor = chartMode === "pnl" ? (isProfitable ? "var(--color-success)" : "var(--color-danger)") : "var(--color-data-primary)";

  // Fetch immutable daily snapshots for the selected interval. Prefer unified
  // snapshots (connected sources) over the legacy portfolio_daily_snapshots.
  useEffect(() => {
    // When the unified read model has daily snapshots from connected sources,
    // use them directly — they reflect the real account history.
    if (unifiedPortfolio?.isUnified && (unifiedPortfolio.snapshots || []).length > 0) {
      const rows = (unifiedPortfolio.snapshots || [])
        .filter((s) => s.snapshotDate && Number.isFinite(s.portfolioValue))
        .map((s) => ({
          date: s.snapshotDate,
          ts: new Date(`${s.snapshotDate}T00:00:00Z`).getTime(),
          portfolioValue: Number(s.portfolioValue),
          cash: 0,
          investedCapital: 0,
          dailyPnl: 0,
          dailyReturn: 0,
          benchmarkValue: null,
          benchmarkReturn: null,
          deposits: 0,
          withdrawals: 0,
          estimated: false,
          source: "unified"
        }))
        .filter((r) => Number.isFinite(r.ts))
        .sort((a, b) => a.ts - b.ts);
      setSnapshotHistory(rows);
      setHistoryStatus(rows.length ? "ready" : "empty");
      return;
    }

    let cancelled = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    setHistoryStatus("loading");
    fetchPerformanceHistory(chartInterval, { signal: controller?.signal })
      .then((rows) => {
        if (cancelled) return;
        setSnapshotHistory(rows);
        setHistoryStatus(rows.length ? "ready" : "empty");
      })
      .catch((err) => {
        if (cancelled || err?.name === "AbortError") return;
        setSnapshotHistory([]);
        setHistoryStatus("error");
      });
    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [chartInterval, unifiedPortfolio?.isUnified, unifiedPortfolio?.snapshots]);

  // Base value = first snapshot's portfolio value (for %/PnL rebasing). Falls
  // back to initialBalance when history is empty.
  const historyBaseValue = useMemo(() => {
    if (snapshotHistory.length > 0) return snapshotHistory[0].portfolioValue;
    return initialBalance;
  }, [snapshotHistory, initialBalance]);

  const chartData = useMemo(() => {
    // Equity curve from immutable snapshots at REAL dates (no fake buckets).
    const series = buildEquitySeries(snapshotHistory, chartMode, { baseValue: historyBaseValue });
    // Live overlay: append today's live equity as a SEPARATE trailing point
    // without overwriting the last immutable snapshot. Only when the last
    // snapshot predates today (market open / pre-EOD).
    if (series.length > 0 && Number.isFinite(currentAccountEquity)) {
      const todayTs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
      const lastTs = snapshotHistory[snapshotHistory.length - 1]?.ts;
      if (lastTs != null && todayTs > lastTs) {
        const liveUsd = currentAccountEquity;
        const liveConverted = displayCurrency === "USD" ? liveUsd : convertFromUSD(liveUsd, displayCurrency, spotPrices);
        let value;
        if (chartMode === "percentage") value = historyBaseValue ? ((liveUsd - historyBaseValue) / historyBaseValue) * 100 : 0;
        else if (chartMode === "pnl") value = liveConverted - (displayCurrency === "USD" ? historyBaseValue : convertFromUSD(historyBaseValue, displayCurrency, spotPrices));
        else value = liveConverted;
        series.push([Date.now(), Number(Number(value).toFixed(2))]);
      }
    }
    return series;
  }, [snapshotHistory, chartMode, historyBaseValue, currentAccountEquity, displayCurrency, spotPrices]);

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

  // Rec 10 — derive portfolio gaps from current exposure vs the ETF
  // seed's exposure universe. Missing = seed exposure token not present
  // in the portfolio's actual holdings. 100% from real data.
  const etfGaps = useMemo(() => {
    const held = new Set((exposureRows || []).map((r) => String(r.name).toLowerCase()));
    const universe = new Set();
    Object.values(CORE_ETF_SEED).forEach((m) => (m.exposure || []).forEach((e) => universe.add(e.toLowerCase())));
    const missing = [...universe].filter((u) => !held.has(u));
    return { missingSectors: missing, missingCountries: [], wantExposure: [] };
  }, [exposureRows]);

  // Phase 3: asset-aware Portfolio Exposure. When the Indicator Modal opens
  // Portfolio with an indicator context, surface the real sector exposures that
  // indicator maps to (via RelationshipGraph), weighted by actual portfolio
  // holdings. No fabricated percentages — only sectors the graph links AND the
  // portfolio actually holds are shown; otherwise an honest unavailable state.
  const indicatorExposure = useMemo(() => {
    if (!indicatorContext) return null;
    const linked = relatedByKind(String(indicatorContext).toUpperCase(), "sector", 3)
      .map((n) => String(n.label || n.id).toUpperCase());
    const linkedSet = new Set(linked);
    const matched = (Array.isArray(exposureRows) ? exposureRows : [])
      .filter((r) => linkedSet.has(String(r.name).toUpperCase()));
    const totalLinkedWeight = matched.reduce((s, r) => s + (Number(r.weight) || 0), 0);
    return { linked, matched, totalLinkedWeight };
  }, [indicatorContext, exposureRows]);

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

  // Performance Metrics — derived from the SAME immutable snapshots that feed
  // the Performance Curve (GET /api/history/range). No trade reconstruction,
  // no duplicated equity logic. A live trailing point is appended only when the
  // last snapshot predates today, mirroring chartData's live overlay.
  const metrics = useMemo(() => {
    const base = snapshotHistory.slice();
    if (
      base.length > 0 &&
      Number.isFinite(currentAccountEquity) &&
      currentAccountEquity > 0
    ) {
      const todayTs = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").getTime();
      const lastTs = base[base.length - 1]?.ts;
      if (lastTs != null && todayTs > lastTs) {
        base.push({
          date: new Date().toISOString().slice(0, 10),
          ts: todayTs,
          portfolioValue: currentAccountEquity,
          dailyPnl: 0,
          dailyReturn: 0,
          deposits: 0,
          withdrawals: 0,
          estimated: false
        });
      }
    }
    const m = computePerformanceMetrics(base);
    return {
      ...m,
      sharpe: Number.isFinite(m.sharpe) ? m.sharpe.toFixed(2) : "N/A",
      sortino: Number.isFinite(m.sortino) ? m.sortino.toFixed(2) : "N/A",
      maxDrawdown: Number.isFinite(m.maxDrawdown) ? m.maxDrawdown.toFixed(2) : "0.00",
      volatility: Number.isFinite(m.volatility) ? m.volatility.toFixed(2) : "N/A",
      twr: Number.isFinite(m.twr) ? m.twr.toFixed(2) : "N/A",
      mwr: Number.isFinite(m.mwr) ? m.mwr.toFixed(2) : "N/A",
      calmar: Number.isFinite(m.calmar) ? m.calmar.toFixed(2) : "N/A",
      winRate: Number.isFinite(m.winRate) ? m.winRate.toFixed(1) : "N/A",
      alpha: "N/A",
      beta: "N/A"
    };
  }, [snapshotHistory, currentAccountEquity]);

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
      // MyStocks (African) rows carry priceUsd from the backend; prefer it so a
      // mixed-currency portfolio values correctly without relying on possibly
      // absent local FX rates. Fall back to local price + convertToUSD otherwise.
      const priceUsd = Number(item?.priceUsd);
      const rawValue = (Number(item?.price) || 0) * (Number(item?.quantity) || 0);
      const positionValue = Number.isFinite(priceUsd)
        ? priceUsd * (Number(item?.quantity) || 0)
        : convertToUSD(rawValue, currency, spotPrices);
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
        bucket: classifyPortfolioInstrument({ symbol: symbolKey, marketType: marketKey, category: item?.category, instrumentType: item?.instrumentType, type: item?.type, hasRealPosition: Boolean(item?.quantity && Number(item?.quantity) !== 0) }),
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

  // Benchmark series from REAL stored benchmark closes (portfolio_daily_snapshots
  // .benchmark_value). Rebased to the portfolio's start. Returns [] when the
  // engine has no benchmark feed configured — the curve shows no fake benchmark.
  const benchmarkSeries = useMemo(() => {
    return buildBenchmarkSeries(snapshotHistory, chartMode, { baseValue: historyBaseValue });
  }, [snapshotHistory, chartMode, historyBaseValue]);

  // Snapshot-derived performance metrics (TWR, MWR, Sharpe, drawdown, ...).
  const performanceMetrics = useMemo(() => {
    return computePerformanceMetrics(snapshotHistory);
  }, [snapshotHistory]);

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
        color: "var(--color-warning)",
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
    color: "rgba(160, 160, 160, 0.72)"
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

  // §7 — instrument-class exposure buckets (Equities/ETFs/Crypto/Commodities/
  // Bonds/FX/Cash/Other). Computed from the classified combinedHoldings so every
  // valuation/allocation/rebalance consumer shares one classifier. Currency codes
  // with no real position fall to "Other" (excluded from tradable totals).
  const exposureBuckets = useMemo(() => {
    const totals = Object.fromEntries(PORTFOLIO_BUCKETS.map((b) => [b, 0]));
    let fxStale = false;
    for (const row of combinedHoldings) {
      const b = row.bucket || "Other";
      totals[b] = (totals[b] || 0) + Number(row.positionValue || 0);
      // Mark partial FX conversion coverage when an FX/fx-valued row lacks a
      // usable spot rate for its quote currency.
      if (b === "FX" && row.currency && row.currency !== "USD") {
        const rate = spotPrices?.[row.currency];
        if (!rate || !Number.isFinite(Number(rate))) fxStale = true;
      }
    }
    const grand = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
    const out = PORTFOLIO_BUCKETS.map((b) => ({
      bucket: b,
      value: totals[b] || 0,
      weight: ((totals[b] || 0) / grand) * 100,
    })).sort((a, b) => b.value - a.value);
    return { rows: out, totals, fxConversionPartial: fxStale, grand };
  }, [combinedHoldings, spotPrices]);

  // §7 — rebalance gating. This lives after exposureBuckets so FX conversion
  // coverage is available during render; no recommendation is shown as actionable
  // until holdings, prices, targets, and FX conversion are all usable.
  const { rebalanceActionable, rebalanceBlockedReason } = useMemo(() => {
    if (!actionableRebalanceRows.length) {
      return { rebalanceActionable: false, rebalanceBlockedReason: "Insufficient data for an actionable rebalance recommendation. Review instrument data and currency conversion coverage." };
    }
    const hasStale = actionableRebalanceRows.some((row) => Number(row.price || 0) <= 0);
    if (hasStale) {
      return { rebalanceActionable: false, rebalanceBlockedReason: "Insufficient data for an actionable rebalance recommendation. Review instrument data and currency conversion coverage." };
    }
    if (exposureBuckets.fxConversionPartial) {
      return { rebalanceActionable: false, rebalanceBlockedReason: "FX conversion coverage is partial. Resolve quote-currency rates before rebalancing FX exposure." };
    }
    return { rebalanceActionable: true, rebalanceBlockedReason: null };
  }, [actionableRebalanceRows, exposureBuckets]);

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
          pnlSub: formatPercent(Number(item?.priceChangePercent || 0), { sign: true }),
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
        pnlSub: formatPercent(pct, { sign: true }),
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
          side: isSell ? "Reduce" : "Increase",
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
      bestPeriod: formatPercent(best, { sign: true }),
      worstPeriod: formatPercent(worst, { sign: true }),
      maxDrawdown: formatPercent(Number(metrics.maxDrawdown || maxDrawdown || 0)),
      currentDrawdown: formatPercent(Number(currentDrawdown || 0))
    };
  }, [chartData, chartMode, metrics.maxDrawdown]);

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
        detail: bestPerformer ? `${formatPercent(Number(bestPerformer.priceChangePercent || 0), { sign: true })} leads current marked performance.` : "Tax-lot signals appear when realized loss candidates exist.",
        action: "Review",
        onClick: () => bestPerformer ? onSelectAsset?.(bestPerformer) : setShowDiversificationModal(true)
      },
      {
        kind: feeTone,
        title: topRebalance ? `${topRebalance.symbol} drift update` : "Theta update",
        detail: topRebalance ? `${topRebalance.action} ${formatPercent(Math.abs(topRebalance.drift))} drift against equal-weight target.` : "Options greek and rebalance alerts update with connected holdings.",
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
    if (flow === "rebalancing" && !rebalanceActionable) {
      setFlowOutcome({
        title: "Rebalance blocked",
        message: rebalanceBlockedReason || "Rebalance data is not ready yet.",
        tone: "warning",
      });
      return;
    }
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
      status: result?.mode || (result?.ok ? "saved" : "error"),
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
        message: "There are no allocation changes to save right now.",
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
        message: `The preview was saved in ${getSaveTargetLabel()}. Zenin now keeps this as a research plan, not an execution instruction.`,
        tone: "warning"
      });
      setInsightFlowStep(5);
      return;
    }

    setFlowBusy(true);
    setFlowActionLabel("Saving authenticated rebalance plan...");

    try {
      const result = await onExecuteRebalance(actionableRebalanceRows);
      await recordRebalanceExecution(result);

      if (result?.ok) {
        setFlowOutcome({
          title: "Rebalance plan saved",
          message: `Saved ${result?.summary?.tradeCount || actionableRebalanceRows.length} allocation changes. Estimated fees ${formatMoney(result?.summary?.fees || 0)} and slippage ${formatMoney(result?.summary?.slippage || 0)} were recorded for research context.`,
          tone: "success"
        });
      } else if (result?.mode === "partial") {
        setFlowOutcome({
          title: "Rebalance partially saved",
          message: `${result?.trades?.length || 0} allocation changes were saved before the workflow stopped. Your portfolio context was refreshed from the latest saved state.`,
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
          message: error?.message || "Zenin could not save the rebalance plan.",
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
  const hasConnectedPortfolioAccounts =
    (Array.isArray(connectedAccounts) && connectedAccounts.length > 0) ||
    (Array.isArray(brokerageAccounts) && brokerageAccounts.length > 0) ||
    brokerageReadModel.brokerageHoldings.length > 0 ||
    brokerageReadModel.brokerageValue > 0;

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
    colors: [chartColors.danger(), chartColors.info(), chartColors.muted()],
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
              color: "var(--color-data-slate)",
              fontSize: "12px",
              offsetY: -6,
            },
            value: {
              show: true,
              color: "var(--color-text-primary)",
              fontSize: "24px",
              fontWeight: 700,
              offsetY: 10,
              formatter: () => `${projectedAlignment.after.toFixed(0)}%`,
            },
            total: {
              show: true,
              label: "Alignment",
              color: "var(--color-data-slate)",
              fontSize: "12px",
              formatter: () => "Projected",
            },
          },
        },
      },
    },
  }), [projectedAlignment.after]);

  // P3 — subscribe to the IntelligenceBus (Phase 4) so the Portfolio Summary
  // reflects the current macro regime + commodity exposure without prop-drilling
  // or local recompute.
  const regimeIntelligence = useRegimeIntelligence();

  const portfolioSummaryCards = useMemo(() => {
    const optionsWeight = currentAccountEquity > 0 ? (totalOptionsValue / currentAccountEquity) * 100 : 0;
    const cards = [
      {
        label: "Total Value",
        value: formatMoney(currentAccountEquity),
        detail: `${formatSignedMoney(totalGainLoss)} (${formatSignedPercent(totalReturnPct, 2)})`,
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
    // P3 — Tier-1 external intelligence cards, fed by the IntelligenceBus (Phase 4).
    // Macro regime + commodity exposure now flow into the Portfolio Summary instead
    // of being trapped in the Macro desk. Honest empty state when the bus is silent.
    if (regimeIntelligence?.regime) {
      const r = regimeIntelligence.regime;
      cards.push({
        label: "Macro Regime",
        value: r.label || "Unavailable",
        detail: `Conf ${r.confidence ?? "—"} · ${r.risk || "—"} risk`,
        tone: r.tone === "positive" ? "positive" : r.tone === "negative" ? "negative" : "neutral",
      });
    }
    if (regimeIntelligence?.macroSignal?.affectedAssets?.length) {
      const aff = regimeIntelligence.macroSignal.affectedAssets;
      cards.push({
        label: "Commodity Exposure",
        value: `${aff.length} drivers`,
        detail: aff.slice(0, 3).map((a) => a.label).join(", ") || "None mapped",
        tone: "neutral",
      });
    }
    return cards;
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
    regimeIntelligence?.regime,
    regimeIntelligence?.macroSignal,
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
          if (topExposure) openInsightFlow("exposure", topExposure);
          else openPortfolioTab("exposure");
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
  }, [exposureSummary, formatMoney, lossHarvestSnapshot, openInsightFlow, openPortfolioTab, topDriftRow]);

  const handleOpenAttentionDrawer = useCallback(() => {
    if (attentionCards.length) {
      setShowAttentionDrawer(true);
      return;
    }
    openPortfolioTab("exposure");
    setFlowOutcome({
      title: "Showing exposure risks",
      message: "No separate attention queue is available, so Zenin opened the Exposure tab.",
      tone: "success",
    });
  }, [attentionCards.length, openPortfolioTab]);

  const handleOpenAttentionItem = useCallback((card) => {
    setShowAttentionDrawer(false);
    if (typeof card?.onClick === "function") {
      card.onClick();
      return;
    }
    openPortfolioTab("exposure");
  }, [openPortfolioTab]);

  const benchmarkRiskRows = useMemo(() => ([
    { label: "Benchmark", value: benchmarkSymbol },
    { label: "Portfolio YTD", value: formatSignedPercent(totalReturnPct, 2), tone: totalReturnPct >= 0 ? "positive" : "negative" },
    { label: "Benchmark YTD", value: formatSignedPercent(benchmarkSnapshot.returnPct, 2), tone: benchmarkSnapshot.returnPct >= 0 ? "positive" : "negative" },
    { label: "YTD Relative", value: formatSignedPercent(benchmarkSnapshot.relativePct, 2), tone: benchmarkSnapshot.relativePct >= 0 ? "positive" : "negative" },
    { label: "Beta", value: String(metrics.beta || "N/A") },
        { label: "Tracking Error", value: formatPercent(Math.abs(Number(benchmarkSnapshot.relativePct || 0))) },
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
      openInsightFlow("rebalancing", payload?.suggestions?.[0] || actionableRebalanceRows[0] || null);
      setFlowOutcome({
        title: "Plan history loaded",
        message: `${Number(payload?.summary?.tradeCount || payload?.trades?.length || 0)} change${Number(payload?.summary?.tradeCount || payload?.trades?.length || 0) === 1 ? "" : "s"} were recorded with status ${String(payload?.status || "saved").toUpperCase()}.`,
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
          <div className="portfolio-command-card-grid three portfolio-command-attribution-grid">
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
            <DataTable
              columns={[
                { key: "bucket", header: "Bucket", sortable: false },
                { key: "name", header: "Leader", sortable: false },
                {
                  key: "pnl",
                  header: "Contribution",
                  sortable: false,
                  cell: (row) => <span className={Number(row?.pnl || 0) >= 0 ? "positive" : "negative"}>{formatSignedMoney(row.pnl)}</span>,
                },
                {
                  key: "action",
                  header: "Action",
                  sortable: false,
                  cell: (row) => <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("attribution", row)}>Review</button>,
                },
              ]}
              data={groups.flatMap((group) => (attributionRows?.[group.key] || []).slice(0, 3).map((row) => ({ ...row, bucket: group.label })))}
              getRowId={(row) => `${row.bucket}-${row.name}`}
              className="portfolio-command-table compact"
            />
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
          <div className="portfolio-command-card-grid three portfolio-command-exposure-grid">
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
            <DataTable
              columns={[
                { key: "bucket", header: "Bucket", sortable: false },
                { key: "name", header: "Name", sortable: false },
                { key: "weight", header: "Weight", sortable: false, cell: (row) => `${row.weight.toFixed(1)}%` },
                { key: "risk", header: "Risk", sortable: false, cell: (row) => formatRiskLabel(row.risk) },
                {
                  key: "action",
                  header: "Action",
                  sortable: false,
                  cell: (row) => <button type="button" className="portfolio-v2-link" onClick={() => openInsightFlow("exposure", row)}>Inspect</button>,
                },
              ]}
              data={(exposureRows || []).slice(0, 10)}
              getRowId={(row) => `exp-${row.bucket}-${row.name}`}
              className="portfolio-command-table compact"
            />
          </div>
        </div>
      );
    }

    if (activePortfolioTab === "history") {
      const latestExecution = apiExecutionRows[0] || null;
      const totalNotional = apiExecutionRows.reduce((sum, execution) => sum + (Number(execution.notional) || 0), 0);
      return (
        <div className="portfolio-command-tab-panel">
          <div className="portfolio-command-panel-head">
            <div>
              <h3>Execution History</h3>
              <p>API-sourced fills from connected platforms only. Manual notes and simulated planning are excluded from this ledger.</p>
            </div>
            <div className="portfolio-command-inline-actions">
              {unreadNotificationCount > 0 ? <span className="portfolio-command-beta-pill">{unreadNotificationCount} unread</span> : null}
              <button type="button" className="portfolio-v2-link" onClick={handleOpenConnections}>Manage Connections</button>
            </div>
          </div>

          <div className="portfolio-command-card-grid three portfolio-command-fees-grid">
            <div className="portfolio-command-mini-card static">
              <span>API Executions</span>
              <strong>{apiExecutionRows.length}</strong>
              <em>{executionPlatformOptions.length} connected venue bucket{executionPlatformOptions.length === 1 ? "" : "s"}</em>
            </div>
            <div className="portfolio-command-mini-card static">
              <span>Matched Notional</span>
              <strong>{formatMoney(totalNotional)}</strong>
              <em>Filtered execution value</em>
            </div>
            <div className="portfolio-command-mini-card static">
              <span>Latest Fill</span>
              <strong>{latestExecution ? latestExecution.symbol : "No fills"}</strong>
              <em>{latestExecution ? `${formatVenueLabel(latestExecution.platform)} · ${formatExecutionTimestamp(latestExecution.executedAt)}` : "Connect an API account"}</em>
            </div>
          </div>

          <div className="portfolio-history-toolbar">
            <select
              value={historyFilters.platform}
              onChange={(event) => setHistoryFilters((prev) => ({ ...prev, platform: event.target.value }))}
              aria-label="Filter executions by platform"
            >
              <option value="all">All platforms</option>
              {executionPlatformOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <select
              value={historyFilters.side}
              onChange={(event) => setHistoryFilters((prev) => ({ ...prev, side: event.target.value }))}
              aria-label="Filter executions by side"
            >
              <option value="all">Buy and sell</option>
              <option value="buy">Buys</option>
              <option value="sell">Sells</option>
            </select>
            <input
              value={historyFilters.symbol}
              onChange={(event) => setHistoryFilters((prev) => ({ ...prev, symbol: event.target.value }))}
              placeholder="Symbol"
              aria-label="Filter executions by symbol"
            />
          </div>

          <div className="portfolio-command-table-wrap portfolio-history-table-wrap">
            <DataTable
              columns={[
                {
                  key: "executedAt",
                  header: "Time",
                  sortable: false,
                  cell: (e) => (
                    <div>
                      <strong>{formatExecutionTimestamp(e.executedAt)}</strong>
                      <span>{e.platformFillId || "Fill ID pending"}</span>
                    </div>
                  ),
                },
                { key: "platform", header: "Platform", sortable: false, cell: (e) => formatVenueLabel(e.platform) },
                {
                  key: "symbol",
                  header: "Symbol",
                  sortable: false,
                  cell: (e) => (<div><strong>{e.symbol}</strong><span>{e.marketType}</span></div>),
                },
                {
                  key: "side",
                  header: "Side",
                  sortable: false,
                  cell: (e) => <span className={e.side === "buy" ? "positive" : "negative"}>{e.side.toUpperCase()}</span>,
                },
                { key: "quantity", header: "Quantity", sortable: false, cell: (e) => formatExecutionQuantity(e.quantity) },
                { key: "price", header: "Price", sortable: false, cell: (e) => formatMoney(e.price) },
                { key: "feeAmount", header: "Fee", sortable: false, cell: (e) => e.feeAmount ? `${formatExecutionQuantity(e.feeAmount)} ${e.feeCurrency}` : "N/A" },
                { key: "source", header: "Source", sortable: false, cell: () => <span>API connection</span> },
              ]}
              data={apiExecutionRows.slice(0, 5)}
              getRowId={(e) => `${e.platform}-${e.platformFillId || e.id}`}
              onRowClick={(e) => setSelectedExecution(e)}
              emptyState={
                <div className="portfolio-command-empty">
                  <h3>No API executions yet</h3>
                  <p>Connect Binance, Bybit, Hyperliquid, or another supported account to import previous executions.</p>
                  <button type="button" className="portfolio-command-primary-cta subtle" onClick={handleOpenConnections}>Connect Account</button>
                </div>
              }
              className="portfolio-command-table compact portfolio-history-table"
            />
          </div>

          {recentExecutionNotifications.length ? (
            <div className="portfolio-command-activity-list portfolio-history-pings">
              {recentExecutionNotifications.map((notification) => (
                <div key={notification.id} className="portfolio-command-activity-row">
                  <div className="portfolio-command-activity-copy">
                    <strong>{notification.title}</strong>
                    <span>{notification.body}</span>
                  </div>
                  <div className="portfolio-command-activity-values">
                    <strong>{notification.readAt ? "Read" : "New"}</strong>
                    <span>{formatExecutionTimestamp(notification.createdAt)}</span>
                  </div>
                </div>
              ))}
              {recentExecutionNotifications.slice(0, 1).map((notification) => (
                <NotificationTransmission key={`tx-${notification.id}`} driver="Oil" affectedHoldings={5} />
              ))}
            </div>
          ) : null}
        </div>
      );
    }

    if (activePortfolioTab === "fees") {
      return (
        <div className="portfolio-command-tab-panel">
          <div className="portfolio-command-panel-head">
            <div>
              <h3>Fees</h3>
              <p>Portfolio activity costs across venues, benchmark comparison, and savings opportunities versus the cheapest avenue.</p>
            </div>
          </div>
          <div className="portfolio-command-card-grid three">
            <div className="portfolio-command-mini-card static">
              <span>Gross Fees Paid</span>
              <strong>{formatMoney(feeDashboard.estimatedUsd)}</strong>
              <em>{feeDashboard.tradeCount} charged activities</em>
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
                  <span>{row.tradeCount} activities</span>
                </div>
              </div>
            ))}
            {!feeDashboard.platforms.length ? (
              <div className="portfolio-command-empty">
                <h3>No recorded fees yet</h3>
                <p>Connect read-only venues to populate cost history.</p>
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
          </div>
        </div>
        <div className="portfolio-command-table-wrap">
          <DataTable
            columns={[
              { key: "symbol", header: "Symbol", sortable: false },
              { key: "name", header: "Name", sortable: false },
              {
                key: "kind",
                header: "Asset Class",
                sortable: false,
                cell: (row) => row.kind === "options" ? "Options" : String(row?.raw?.marketType || row?.raw?.type || "Asset").replace(/_/g, " "),
              },
              {
                key: "allocation",
                header: "Allocation",
                sortable: false,
                cell: (row) => (
                  <div className="portfolio-command-allocation-cell">
                    <strong>{row.allocation.toFixed(1)}%</strong>
                    <div className="portfolio-command-allocation-bar"><i style={{ width: `${Math.min(100, Math.max(4, row.allocation))}%` }} /></div>
                  </div>
                ),
              },
              {
                key: "pnl",
                header: "Unrealized PnL",
                sortable: false,
                cell: (row) => <span className={row.pnlPositive ? "positive" : "negative"}>{row.pnlMain}</span>,
              },
              {
                key: "benchDelta",
                header: "vs Benchmark",
                sortable: false,
                cell: (row) => {
                  const benchDelta = row.kind === "spot"
                    ? Number(row?.raw?.priceChangePercent || 0) - Number(benchmarkSnapshot.returnPct || 0)
                    : null;
                  if (benchDelta == null) return "—";
                  return <span className={benchDelta >= 0 ? "positive" : "negative"}>{formatSignedPercent(benchDelta, 1)}</span>;
                },
              },
              {
                key: "drift",
                header: "Weight vs Bench",
                sortable: false,
                cell: (row) => {
                  const driftRow = rebalanceActionMap.get(String(row.symbol || "").toUpperCase());
                  if (!driftRow) return "—";
                  return <span className={Number(driftRow?.drift || 0) <= 0 ? "positive" : "negative"}>{formatSignedPercent(driftRow.drift, 1)}</span>;
                },
              },
              {
                key: "action",
                header: "",
                sortable: false,
                cell: (row) => <button type="button" className="portfolio-v2-link" onClick={() => openHoldingSnapshot(row)}>Open</button>,
              },
            ]}
            data={holdingsTableRows}
            getRowId={(row) => row.key}
            emptyState={
              <div className="portfolio-command-empty">
                <h3>No positions found</h3>
                <p>Add holdings or connect accounts to unlock portfolio analysis.</p>
              </div>
            }
            className="portfolio-command-table"
          />
        </div>
      </div>
    );
  };

  const InsightFlowOverlay = () => {
    const dialogRef = useFocusTrap({ open: !!activeInsightFlow, onClose: closeInsightFlow });
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
            <p>Which positions drove your return. Larger bars contributed more — tap one to see its detail.</p>
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
        const buckets = ["Sector", "Country", "Currency"];
        const switchBucket = (b) => { setFlowSelection({ bucket: b, name: "", weight: 0 }); setInsightFlowStep(1); };
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Exposure Heatmap</h3>
              <span>{bucketRows.length} {activeBucket.toLowerCase()}s</span>
            </div>
            <p>Where your book is concentrated. Darker cells carry more weight — tap one to inspect holdings and risk.</p>
            <div className="portfolio-v2-flow-buckets" role="tablist" aria-label="Exposure dimension">
              {buckets.map((b) => (
                <button
                  key={b}
                  type="button"
                  role="tab"
                  aria-selected={activeBucket === b}
                  className={`portfolio-v2-flow-bucket ${activeBucket === b ? "is-active" : ""}`}
                  onClick={() => switchBucket(b)}
                >{b}</button>
              ))}
            </div>
            <div className="portfolio-v2-flow-heatmap" role="list">
              {bucketRows.map((row) => {
                const risk = riskForWeight(row.weight);
                return (
                  <button
                    key={`heat-${row.name}`}
                    type="button"
                    role="listitem"
                    className={`portfolio-v2-flow-heat-cell risk-${risk}`}
                    style={{ "--heat": Math.max(8, Math.min(100, Number(row.weight || 0))) }}
                    aria-label={`${row.name}, ${row.weight.toFixed(1)} percent, ${risk} risk`}
                    onClick={() => { setFlowSelection(row); setInsightFlowStep(2); }}
                  >
                    <span className="portfolio-v2-flow-heat-name">{row.name}</span>
                    <strong className="portfolio-v2-flow-heat-weight">{row.weight.toFixed(1)}%</strong>
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
              <h3>Heatmap Overview</h3>
              <span>{activeBucket} map</span>
            </div>
            <div className="portfolio-v2-flow-table">
              {bucketRows.slice(0, 6).map((row) => (
                <button
                  key={`heat-${row.name}`}
                  type="button"
                  className={`portfolio-v2-flow-table-row risk-${riskForWeight(row.weight)}`}
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
        ? "Sign in to preview API turnover costs."
        : rebalanceEstimateStatus === "loading"
          ? "Fetching turnover costs..."
          : rebalanceEstimateStatus === "error"
            ? "Turnover cost preview unavailable."
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
          colors: [chartColors.info(), chartColors.textPrimary()],
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
              <span>Analyze portfolio drift and allocation impact</span>
            </div>

            <div className="portfolio-v2-flow-two-col" style={{ alignItems: 'center' }}>
              <div style={{ pointerEvents: 'none' }}>
                <DeferredChart height={214}>
                  <ReactApexChart
                    options={donutOptions}
                    series={[100 - totalDrift, totalDrift]}
                    type="donut"
                  />
                </DeferredChart>
              </div>
              <div className="portfolio-v2-flow-mini-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Portfolio Drift</span>
                  <strong style={{ fontSize: '18px', color: 'var(--color-warning)' }}>{totalDrift.toFixed(1)}%</strong>
                </div>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Changes Required</span>
                  <strong style={{ fontSize: '18px' }}>{tradesRequired}</strong>
                </div>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Platform Fees</span>
                  <strong style={{ fontSize: '18px' }}>{formatMoney(estimatedFees)}</strong>
                </div>
                <div className="portfolio-v2-flow-kpi-card" style={{ padding: '12px' }}>
                  <span style={{ fontSize: '10px' }}>Expected Slippage</span>
                  <strong style={{ fontSize: '18px', color: 'var(--color-data-primary)' }}>{formatMoney(estimatedSlippage)}</strong>
                </div>
              </div>
            </div>

            {costStatusLabel ? (
              <div className="portfolio-v2-flow-status-inline warning" style={{ marginTop: '14px' }}>
                <span>!</span>
                <div><strong>Turnover cost preview</strong><small>{costStatusLabel}</small></div>
              </div>
            ) : (
              <div className="portfolio-v2-flow-status-inline success" style={{ marginTop: '14px' }}>
                <span>✓</span>
                <div><strong>Total turnover cost impact</strong><small>{formatMoney(estimatedCostImpact)} across {formatMoney(tradeVolume)} of turnover.</small></div>
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
              <span>Inspect individual allocation changes</span>
            </div>
            <div className="portfolio-v2-flow-list stacked" style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {actionableRebalanceRows.map((s) => (
                <div key={s.symbol} className="portfolio-v2-flow-action-row" style={{ cursor: 'default' }}>
                   <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                      <div className="portfolio-v2-activity-dot" style={{
                        color: s.action === "Trim" ? 'var(--color-warning)' : 'var(--color-success)',
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
                      <div style={{ fontWeight: 600, color: s.action === "Trim" ? 'var(--color-warning)' : 'var(--color-success)' }}>{s.action === "Trim" ? "Reduce" : "Increase"}</div>
                      <div style={{ fontSize: '12px', color: 'var(--color-text-primary)' }}>{formatMoney(s.tradeValue)}</div>
                      <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}>{Number(s.tradeQuantity || 0).toFixed(6)} {s.symbol}</div>
                   </div>
                </div>
              ))}
            </div>
            <div className="portfolio-v2-flow-actions">
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={() => setInsightFlowStep(4)}>Save Plan</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(2)}>Back</button>
            </div>
          </div>
        );
      } else if (insightFlowStep === 4) {
        body = (
          <div className="portfolio-v2-flow-card">
            <div className="portfolio-v2-flow-headline">
              <h3>Save Rebalance Plan</h3>
              <span>Review expected costs and drift reduction</span>
            </div>
            <div className="portfolio-v2-flow-list stacked">
               <div className="portfolio-v2-flow-action-row" style={{ cursor: 'default' }}>
                  <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <div style={{ fontSize: '20px' }}>🛒</div>
                    <div><strong>{tradesRequired} allocation changes</strong><span>{trimCount} reduce, {addCount} increase</span></div>
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
                    <div><strong>Total turnover cost</strong><span>{formatMoney(estimatedCostImpact)}</span></div>
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
              <button type="button" className="portfolio-v2-flow-btn primary" onClick={handleConfirmRebalance}>Save Plan</button>
              <button type="button" className="portfolio-v2-flow-btn ghost" onClick={() => setInsightFlowStep(3)}>Back</button>
            </div>
          </div>
        );
      } else {
        body = flowBusy ? (
          <div className="portfolio-v2-flow-status-card">
            <div className="portfolio-v2-flow-spinner" />
            <h3>{flowActionLabel || "Saving plan..."}</h3>
          </div>
        ) : (
          <div className="portfolio-v2-flow-card" style={{ alignItems: 'center', textAlign: 'center' }}>
            <div className="portfolio-v2-flow-status-inline success" style={{ flexDirection: 'column', padding: '20px', gap: '16px' }}>
              <div style={{ width: '64px', height: '64px', borderRadius: '50%', background: flowOutcome.tone === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.15)', color: flowOutcome.tone === 'success' ? 'var(--color-success)' : 'var(--color-warning)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '32px' }}>{flowOutcome.tone === 'success' ? '✓' : '!'}</div>
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
                  <span>Status</span><strong style={{ color: flowOutcome.tone === 'success' ? 'var(--color-success)' : 'var(--color-warning)' }}>{flowOutcome.tone === 'success' ? 'Saved' : 'Preview / Partial'}</strong>
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
      <div ref={dialogRef} className="portfolio-v2-flow-overlay" role="dialog" aria-modal="true">
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

  // --- Portfolio Intelligence: normalized data layer -----------------------
  // Orders ledger derived read-only from connected broker accounts. Because
  // the Zenin backend has no orders endpoint, we surface what brokers report
  // (open/resting intents) and never fabricate market data.
  const orderLedger = useMemo(
    () => deriveOrderLedgerFromConnections(connectedAccounts),
    [connectedAccounts]
  );

  // Normalized executions feed Order Desk metrics, Execution Analysis, Costs,
  // Events, and the Alert engine.
  const normalizedExecutions = useMemo(
    () => normalizeExecutions(apiTradeExecutions),
    [apiTradeExecutions]
  );

  // Portfolio health roll-up for drift + risk alerts.
  const portfolioHealth = useMemo(
    () =>
      createPortfolioHealth({
        totalValue: currentAccountEquity,
        driftPct: Number(rebalanceMetrics?.totalDrift || 0),
        concentrationPct: Number(exposureSummary?.maxWeight || 0),
        topMoverSymbol: undefined,
        riskLevel: metrics?.riskLevel || "normal",
      }),
    [currentAccountEquity, rebalanceMetrics?.totalDrift, exposureSummary?.maxWeight, metrics?.riskLevel]
  );

  // Alert engine context (memoized; AlertEngine is pure/read-only).
  const alertContext = useMemo(
    () => ({
      orders: orderLedger.orders,
      executions: normalizedExecutions,
      brokers: orderLedger.brokers,
      venues: orderLedger.venues,
      portfolioHealth,
      notifications: workspaceNotifications,
      connectedAccounts,
    }),
    [orderLedger, normalizedExecutions, portfolioHealth, workspaceNotifications, connectedAccounts]
  );

  // Right rail is independently refreshable: its own token + state. Refreshing
  // re-runs AlertEngine without re-rendering the main workspace.
  const [railRefreshToken, setRailRefreshToken] = useState(0);
  const [railRefreshing, setRailRefreshing] = useState(false);
  const alertContextForRail = useMemo(() => alertContext, [alertContext, railRefreshToken]);
  const handleRefreshAlerts = useCallback(() => {
    setRailRefreshing(true);
    // AlertEngine is synchronous + cheap; simulate async refresh boundary so the
    // rail can show a pending state without blocking the workspace.
    requestAnimationFrame(() => {
      setRailRefreshToken((t) => t + 1);
      setRailRefreshing(false);
    });
  }, []);

  // Next Best Action (spec §3): one dominant, above-the-fold action derived from
  // concentration → drift → tax → healthy. Routes into existing insight flows
  // with relevant context preselected. Uses Brandv2 surfaces (no colored hero).
  const nextBestAction = useMemo(() => {
    if (topDriftRow) {
      const drift = Number(topDriftRow.drift || 0);
      const align = projectedAlignment?.after != null
        ? ` Rebalancing is projected to improve target alignment from ${Math.round(projectedAlignment.before)}% to ${Math.round(projectedAlignment.after)}%.`
        : "";
      return {
        tone: "warning",
        label: "Recommended action",
        title: "Review rebalance plan",
        desc: `Largest drift: ${topDriftRow.symbol} at ${drift >= 0 ? "+" : ""}${drift.toFixed(1)}% vs target.${align}`,
        cta: "Review & rebalance",
        onAction: () => openInsightFlow("rebalancing", topDriftRow),
      };
    }

    if (lossHarvestSnapshot?.count) {
      return {
        tone: "neutral",
        label: "Opportunity",
        title: "Review tax impact",
        desc: `${lossHarvestSnapshot.count} position(s) sit on unrealized losses — an estimated ${formatMoney(Number(lossHarvestSnapshot.estimatedSavings || 0))} tax offset is available via harvesting.`,
        cta: "Review tax impact",
        onAction: () => openInsightFlow("exposure", lossHarvestSnapshot.top),
      };
    }

    return {
      tone: "healthy",
      label: "On track",
      title: "Portfolio is within current targets",
      desc: "Holdings are inside drift bands and concentration limits. No immediate action required.",
      cta: "Review allocation",
      onAction: () => openPortfolioTab("exposure"),
    };
  }, [exposureSummary, topDriftRow, projectedAlignment, lossHarvestSnapshot, openInsightFlow, openPortfolioTab]);

  const renderNextBestAction = () => (
    <section
      className={`portfolio-next-best-action portfolio-next-best-action--${nextBestAction.tone}`}
      aria-label="Next best action"
    >
      <div className="portfolio-next-best-action__body">
        <div className="portfolio-next-best-action__label">{nextBestAction.label}</div>
        <h2 className="portfolio-next-best-action__title">{nextBestAction.title}</h2>
        <p className="portfolio-next-best-action__desc">{nextBestAction.desc}</p>
      </div>
      <div className="portfolio-next-best-action__cta">
        <button
          type="button"
          className="portfolio-command-primary-cta"
          onClick={nextBestAction.onAction}
        >{nextBestAction.cta}</button>
      </div>
    </section>
  );

  return (
    <div className="portfolio-module portfolio-v2 portfolio-exec-page portfolio-command-page">
      <header className="portfolio-command-header">
        <div className="portfolio-command-titleblock">
          <span className="portfolio-command-eyebrow">Portfolio</span>
          <h1>Portfolio Command Center</h1>
          <p>Actionable intelligence. Clear next step.</p>
          </div>
          {indicatorContext ? (
          <div className="indicator-context-banner portfolio-indicator-context">
            <span>Exposure filtered to <b>{String(indicatorContext).toUpperCase()}</b></span>
            {indicatorExposure ? (
              <div className="indicator-exposure-panel">
                {indicatorExposure.matched.length ? (
                  <div className="indicator-exposure-rows">
                    {indicatorExposure.matched.map((r) => (
                      <div key={r.name} className="indicator-exposure-row">
                        <span>{r.name}</span>
                        <strong className={Number(r.weight) >= 0 ? "up" : "down"}>{Number(r.weight).toFixed(1)}%</strong>
                      </div>
                    ))}
                    <div className="indicator-exposure-total">
                      <span>Linked exposure</span><strong>{indicatorExposure.totalLinkedWeight.toFixed(1)}%</strong>
                    </div>
                  </div>
                ) : (
                  <p className="indicator-exposure-empty">
                    Portfolio exposure for this indicator has not yet been computed.
                    {indicatorExposure.linked.length
                      ? ` Related themes: ${indicatorExposure.linked.slice(0, 6).join(", ")}.`
                      : ""} As positions are mapped through the Relationship Graph, they will appear here.
                  </p>
                )}
              </div>
            ) : null}
          </div>
          ) : null}
        <div className="portfolio-command-header-actions">
          <WorkspaceScopeSelector />
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
        </div>
      </header>

      {/* Connected brokerage (SnapTrade pilot) status — above the fold, distinct
          from manual holdings. Never implies trading; read-only only. */}
      {hasConnectedPortfolioAccounts ? (
        <section className="portfolio-brokerage-banner" aria-label="Connected brokerage accounts">
          <div className="portfolio-brokerage-banner-head">
            <span className="portfolio-brokerage-banner-title">Brokerage accounts · Read-only</span>
            <span className="portfolio-brokerage-banner-value">{formatCurrency(brokerageReadModel.brokerageValue)}</span>
          </div>
          <div className="portfolio-brokerage-banner-meta">
            <span>{brokerageReadModel.brokerageHoldings.length} connected position{brokerageReadModel.brokerageHoldings.length === 1 ? "" : "s"}</span>
            <span>{formatLastSync(brokerageReadModel.lastSyncAt)}</span>
            {brokerageReadModel.requiresReconnect ? (
              <span className="provider-trust-pill provider-trust-pill-warn">Needs reconnection</span>
            ) : null}
            {brokerageReadModel.syncFailed ? (
              <span className="provider-trust-pill provider-trust-pill-danger">Sync failed</span>
            ) : null}
            <button type="button" className="portfolio-v2-link" onClick={handleOpenConnections}>Manage</button>
          </div>
          {brokerageReadModel.duplicateSymbols.length > 0 ? (
            <div className="portfolio-brokerage-duplicate" role="note">
              <strong>Duplicate exposure:</strong> {brokerageReadModel.duplicateSymbols.join(", ")} appear in both your manual and brokerage holdings. They are shown separately — Zenin does not merge them.
            </div>
          ) : null}
        </section>
      ) : (
        <section className="portfolio-connection-strip" aria-label="Portfolio data connections">
          <div>
            <strong>Data connections</strong>
            <span>Connect brokerages or exchanges to unlock live holdings, executions, fees, orders, and sync health.</span>
          </div>
          <button type="button" className="portfolio-v2-link" onClick={handleOpenConnections}>
            Connect accounts
          </button>
        </section>
      )}

        <PortfolioOverview
        summary={{
          eyebrow: isSyncing ? "Syncing venues..." : `As of ${formatSavedTimestamp(feeDashboard.updatedAt || Date.now())}`,
          cards: portfolioSummaryCards,
        }}
        attention={{ onViewAll: handleOpenAttentionDrawer, cards: attentionCards }}
        analysis={
          <div
            ref={analysisSectionRef}
            className="portfolio-analysis-anchor"
          >
            <PortfolioAnalysis
              activeTab={activePortfolioTab}
              onTabChange={(id) => openPortfolioTab(id, { scroll: false })}
              assetClassFilter={assetClassFilter}
              orders={orderLedger.orders}
              rawExecutions={apiTradeExecutions}
              feeDashboard={feeDashboard}
              notifications={workspaceNotifications}
              onManageConnections={handleOpenConnections}
              transactions={unifiedPortfolio?.transactions || []}
              reconciliation={unifiedPortfolio?.reconciliation || null}
              syncStatus={unifiedPortfolio?.syncStatus || null}
              baseCurrency={unifiedPortfolio?.summary?.baseCurrency || "USD"}
              renderLegacyTab={(id) => {
                // Render the existing Holdings / Performance(Attribution) / Exposure
                // panels exactly as before. History/Fees/Prediction are superseded by
                // the new Execution/Orders/Costs/Events intelligence tabs. `id` already
                // equals activePortfolioTab (set by onTabChange); no state write here.
                return renderPortfolioTabContent();
              }}
              rail={null}
            />
            {unifiedPortfolio?.isUnified && (
              <PortfolioDrillDown
                sources={unifiedPortfolio.sources}
                positions={unifiedPortfolio.positions}
                summary={unifiedPortfolio.summary}
                syncStatus={unifiedPortfolio.syncStatus}
                duplicateInstruments={unifiedPortfolio.duplicateInstruments}
                warnings={unifiedPortfolio.warnings}
                unvaluedTotal={unifiedPortfolio.unvaluedTotal}
                fxRates={unifiedPortfolio.fxRates}
                snapshots={unifiedPortfolio.snapshots}
                shadow={unifiedPortfolio.shadow}
                baseCurrency={unifiedPortfolio.summary?.baseCurrency || "USD"}
                onSync={unifiedPortfolio.triggerSync}
                syncing={unifiedPortfolio.syncing}
              />
            )}
          </div>
        }
        recommendedChanges={
          <div className="portfolio-command-rebalance-inner">
            <div className="portfolio-command-section-head">
              <span>Recommended Changes</span>
              <div className="portfolio-command-inline-actions">
                <div className="portfolio-v2-range">
                  <label className="portfolio-v2-range-label" htmlFor="recommended-changes-interval">Timeframe</label>
                  <select
                    id="recommended-changes-interval"
                    className="portfolio-v2-select"
                    value={chartInterval}
                    onChange={(event) => setChartInterval(event.target.value)}
                    aria-label="Select timeframe for Recommended Changes"
                  >
                    {intervals.map((int) => (
                      <option key={int} value={int}>{int}</option>
                    ))}
                  </select>
                </div>
                <div className="portfolio-v2-range">
                  <label className="portfolio-v2-range-label" htmlFor="recommended-changes-chart-mode">View</label>
                  <select
                    id="recommended-changes-chart-mode"
                    className="portfolio-v2-select"
                    value={chartMode}
                    onChange={(event) => setChartMode(event.target.value)}
                    aria-label="Select chart view mode for Recommended Changes"
                  >
                    <option value="equity">Equity</option>
                    <option value="percentage">% Gain</option>
                    <option value="pnl">Cash PnL</option>
                  </select>
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
                  <DeferredChart height={214}>
                    <ReactApexChart options={rebalanceDonutOptions} series={driftDistribution} type="donut" height={214} />
                  </DeferredChart>
                  <div className="portfolio-command-drift-legend">
                    <span><i className="risk" />Overweight</span>
                    <span><i className="info" />Underweight</span>
                    <span><i className="neutral" />In Range</span>
                  </div>
                </div>
                <div className="portfolio-command-change-summary">
                  <div className="portfolio-command-panel-head">
                    <div>
                      <h3>Trim / Add Summary</h3>
                      <p>Highest-impact allocation changes from the current drift model.</p>
                    </div>
                  </div>
                  {actionableRebalanceRows.some((row) => row.action === "Trim" || row.action === "Add") ? (
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
                  ) : (
                    <p className="portfolio-command-change-empty" role="status">No allocation changes required.</p>
                  )}
                </div>
              </div>

              <div className="portfolio-command-impact-card">
                <div className="portfolio-command-panel-head">
                  <div>
                  <h3>Allocation Impact</h3>
                    <p>Estimated cost, readiness, and alignment improvement before you commit.</p>
                  </div>
                </div>
                <div className="portfolio-command-impact-list">
                  <div><span>Change Count</span><strong>{rebalanceMetrics.tradesRequired}</strong></div>
                  <div><span>Est. Fees</span><strong>{formatMoney(rebalanceMetrics.estimatedFees)}</strong></div>
                  <div><span>Est. Slippage</span><strong>{formatMoney(rebalanceMetrics.estimatedSlippage)}</strong></div>
                  <div><span>Projected Alignment</span><strong>{projectedAlignment.before.toFixed(0)}% → {projectedAlignment.after.toFixed(0)}%</strong></div>
                </div>
                <div className="portfolio-command-readiness">
                  <span>Plan Readiness</span>
                  <ul>
                    <li className={liveAvailableBalance > 0 ? "positive" : "negative"}>{liveAvailableBalance > 0 ? "Sufficient cash" : "Low available cash"}</li>
                    <li className={rebalanceMetrics.tradesRequired > 0 ? "positive" : "neutral"}>{rebalanceMetrics.tradesRequired > 0 ? "Actionable allocation set" : "No changes required"}</li>
                    <li className={feeDashboard.tradeCount > 0 ? "positive" : "neutral"}>{feeDashboard.tradeCount > 0 ? "Fee history available" : "Fee history still sparse"}</li>
                  </ul>
                </div>
                <div className="portfolio-command-exposure-buckets">
                  <div className="portfolio-command-exposure-buckets__head">
                    <span>Instrument exposure</span>
                    <em>{formatMoney(exposureBuckets.grand)}</em>
                  </div>
                  <table>
                    <caption className="sr-only">Portfolio value and allocation by instrument class</caption>
                    <thead><tr><th scope="col">Bucket</th><th scope="col">Value</th><th scope="col">Weight</th></tr></thead>
                    <tbody>
                      {exposureBuckets.rows.map((row) => (
                        <tr key={row.bucket}>
                          <th scope="row">{row.bucket}</th>
                          <td>{formatMoney(row.value)}</td>
                          <td>{row.weight.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {exposureBuckets.fxConversionPartial ? <p className="portfolio-command-exposure-buckets__note">FX conversion coverage is partial; affected FX values may be incomplete.</p> : null}
                </div>
                {!rebalanceActionable ? <p id="rebalance-blocked-reason" className="portfolio-command-rebalance-blocked" role="status"><strong>Rebalance blocked</strong>{rebalanceBlockedReason}</p> : null}
                <button type="button" className="portfolio-command-primary-cta" disabled={!rebalanceActionable} aria-describedby={!rebalanceActionable ? "rebalance-blocked-reason" : undefined} onClick={() => openInsightFlow("rebalancing", topDriftRow || null)}>
                  Review &amp; Rebalance
                </button>
              </div>
            </div>
          </div>
        }
      />

      {renderNextBestAction()}

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
      <InsightFlowOverlay />

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
                          {formatMoney(row.value, "USD")}
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
              <div className="journal-stat-card"><span className="journal-stat-label">Value</span><span className="journal-stat-value">{formatMoney(selectedHolding.positionValue)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">PnL</span><span className="journal-stat-value">{formatSignedMoney(selectedHolding.positionGain)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">Quantity</span><span className="journal-stat-value">{Number(selectedHolding.quantity || 0).toFixed(2)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">Price</span><span className="journal-stat-value">{formatMoney(selectedHolding.price)}</span></div>
            </div>
            <div style={{ borderTop: "1px solid rgba(160, 160, 160, 0.14)", paddingTop: "10px", marginTop: "10px" }}>
              <div style={{ fontSize: "12px", color: "var(--color-data-slate)", marginBottom: "6px" }}>Tax Lot Optimizer</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <select value={selectedTaxLotMethod} onChange={(e) => setSelectedTaxLotMethod(e.target.value)} style={{ background: "rgba(5,5,5,0.7)", color: "var(--color-data-slate-bright)", border: "1px solid rgba(160, 160, 160, 0.25)", borderRadius: "8px", padding: "4px 8px", fontSize: "12px" }}>
                  <option value="fifo">FIFO</option>
                  <option value="lifo">LIFO</option>
                  <option value="hifo">HIFO</option>
                  <option value="average">Average Cost</option>
                </select>
                <span style={{ fontSize: "12px", color: "var(--color-data-slate-bright)" }}>
                  Suggested lot method: <strong>{selectedTaxLotMethod.toUpperCase()}</strong> for this sale.
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {selectedExecution ? (
        <div className="modal-overlay" onClick={() => setSelectedExecution(null)}>
          <div className="modal-content portfolio-execution-detail-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header" style={{ marginBottom: "12px" }}>
              <div>
                <h2 style={{ margin: 0 }}>{selectedExecution.symbol} Execution</h2>
                <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Imported from {formatVenueLabel(selectedExecution.platform)} via API connection.
                </p>
              </div>
              <button type="button" className="pagination-button" onClick={() => setSelectedExecution(null)}>Close</button>
            </div>
            <div className="portfolio-execution-detail-grid">
              <div><span>Side</span><strong className={selectedExecution.side === "buy" ? "positive" : "negative"}>{selectedExecution.side.toUpperCase()}</strong></div>
              <div><span>Quantity</span><strong>{formatExecutionQuantity(selectedExecution.quantity)}</strong></div>
              <div><span>Price</span><strong>{formatMoney(selectedExecution.price)}</strong></div>
              <div><span>Notional</span><strong>{formatMoney(selectedExecution.notional)}</strong></div>
              <div><span>Fee</span><strong>{selectedExecution.feeAmount ? `${formatExecutionQuantity(selectedExecution.feeAmount)} ${selectedExecution.feeCurrency}` : "N/A"}</strong></div>
              <div><span>Executed</span><strong>{formatExecutionTimestamp(selectedExecution.executedAt)}</strong></div>
              <div><span>Platform Trade ID</span><strong>{selectedExecution.platformTradeId || "N/A"}</strong></div>
              <div><span>Platform Fill ID</span><strong>{selectedExecution.platformFillId || "N/A"}</strong></div>
              <div><span>Fee Source</span><strong>{formatFeeSourceLabel(selectedExecution.feeSource)}</strong></div>
              <div><span>Market Type</span><strong>{selectedExecution.marketType}</strong></div>
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
      <PortfolioAttentionDrawer
        open={showAttentionDrawer}
        onClose={() => setShowAttentionDrawer(false)}
        cards={attentionCards}
        onSelectItem={handleOpenAttentionItem}
        onOpenExposure={() => {
          setShowAttentionDrawer(false);
          openPortfolioTab("exposure");
        }}
      />
      <PortfolioConnectionsModal
        open={showConnectionsModal}
        onClose={() => setShowConnectionsModal(false)}
        accounts={connectedAccounts}
        brokerageAccounts={brokerageAccounts}
        unifiedPortfolio={unifiedPortfolio}
        onAddConnection={onOpenConnections}
        onConnectBrokerage={onConnectBrokerage}
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

  const dialogRef = useFocusTrap({ open, onClose });

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
          subtitle={`${Number(item.tradesRequired || 0)} changes · ${formatSavedTimestamp(item.createdAt)}`}
          actionLabel="Open"
          onAction={() => onReviewItem("rebalance", item)}
        />
      )
    },
    {
      title: "Plan History",
      rows: savedHistory,
      empty: "No rebalance plan history yet.",
      renderRow: (item) => (
        <SavedWorkspaceRow
          key={item.id}
          title={String(item.status || "saved").toUpperCase()}
          subtitle={`${Number(item.summary?.tradeCount || item.trades?.length || 0)} changes · ${formatSavedTimestamp(item.createdAt)}`}
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
    <div className="home-v3-drawer-overlay portfolio-attention-modal-overlay" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
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

function PortfolioAttentionDrawer({ open, onClose, cards = [], onSelectItem, onOpenExposure }) {
  if (!open) return null;

  const dialogRef = useFocusTrap({ open, onClose });
  const groups = [
    { title: "Concentration / exposure", ids: ["concentration"], empty: "No concentration issue is active." },
    { title: "Rebalance drift", ids: ["drift"], empty: "No rebalance drift is active." },
    { title: "Tax impact", ids: ["tax"], empty: "No tax-impact opportunity is active." },
  ].map((group) => ({
    ...group,
    rows: cards.filter((card) => group.ids.includes(card.id)),
  }));

  return (
    <div className="home-v3-drawer-overlay" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
        className="home-v3-detail-drawer saved-items-drawer portfolio-attention-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="All portfolio attention items"
        style={{ maxWidth: 760 }}
      >
        <div className="home-v3-drawer-head">
          <div>
            <h2>All Attention Items</h2>
            <p className="portfolio-attention-drawer-subtitle">
              Triage concentration, drift, and tax-impact signals from one place.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div className="saved-items-drawer-content portfolio-attention-drawer-content">
          {groups.map((group) => (
            <section key={group.title} className="saved-items-section portfolio-attention-section">
              <div className="saved-items-section-head">
                <strong>{group.title}</strong>
                <span>
                  {group.rows.length ? `${group.rows.length} item${group.rows.length === 1 ? "" : "s"} to review` : group.empty}
                </span>
              </div>
              {group.rows.map((card) => (
                <button
                  key={card.id}
                  type="button"
                  className={`saved-items-row portfolio-attention-row portfolio-attention-row--${card.tone || "neutral"}`}
                  onClick={() => onSelectItem?.(card)}
                >
                  <span className="portfolio-attention-row-copy">
                    <span className="portfolio-attention-row-title">
                      <strong>{card.title}</strong>
                      <em>{card.metric}</em>
                    </span>
                    <span>{card.detail}</span>
                  </span>
                  <b>{card.action || "Inspect"}</b>
                </button>
              ))}
            </section>
          ))}
          <div className="saved-items-drawer-actions portfolio-attention-drawer-actions">
            <button type="button" className="portfolio-v2-link" onClick={onOpenExposure}>
              Open Exposure tab
            </button>
            <button type="button" className="portfolio-command-primary-cta subtle" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function PortfolioConnectionsModal({ open, onClose, accounts = [], brokerageAccounts = [], unifiedPortfolio = null, onAddConnection, onConnectBrokerage }) {
  const dialogRef = useFocusTrap({ open, onClose });
  if (!open) return null;

  const renderScopeBadge = (account) => {
    const trust = account?.providerTrust;
    const status = String(trust?.scopeStatus || "scope_unverified").trim().toLowerCase();
    let label = "Scope unverified";
    let tone = "unverified";
    if (status === "verified_read_only") { label = "Verified read-only"; tone = "verified"; }
    else if (status === "verified_watch_only") { label = "Watch-only"; tone = "verified"; }
    else if (status === "rejected_trade_enabled") { label = "Trading key rejected"; tone = "rejected"; }
    else if (status === "sync_failed") { label = "Sync failed"; tone = "unverified"; }
    return <span className={`provider-trust-pill provider-trust-pill-${tone}`}>{label}</span>;
  };

  const totalCount = accounts.length + brokerageAccounts.length;

  // Map a unified sync-status source to a compact per-account health summary.
  const syncSources = unifiedPortfolio?.syncStatus?.sources || [];
  const unifiedTransactions = unifiedPortfolio?.transactions || [];
  const schedulerOn = true; // 15-min scheduler is on by default server-side
  const nextSyncLabel = "next sync ~15m";
  const accountSyncState = (provider, accountId) => {
    const src = syncSources.find((s) => String(s.provider || "").toLowerCase() === String(provider || "").toLowerCase());
    if (!src) return { state: "unknown", note: "Not yet synced" };
    if (src.status === "error") return { state: "error", note: src.lastError || "Sync failed" };
    if (src.stale) return { state: "stale", note: "Data is stale" };
    if (src.status === "synced" || src.status === "partial") return { state: "ok", note: `${src.positionCount || 0} positions` };
    return { state: "unknown", note: "Not yet synced" };
  };
  const historyCountFor = (provider) => unifiedTransactions.filter((t) => String(t.provider || "").toLowerCase() === String(provider || "").toLowerCase()).length;

  return (
    <div className="home-v3-drawer-overlay" onMouseDown={onClose}>
      <aside
        ref={dialogRef}
        className="home-v3-detail-drawer saved-items-drawer portfolio-connections-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Connected accounts"
        style={{ maxWidth: 760 }}
      >
        <div className="home-v3-drawer-head">
          <div className="saved-items-section-head">
            <strong>Connected Accounts</strong>
            <span>{totalCount ? `${totalCount} connected source${totalCount === 1 ? "" : "s"}` : "No connected sources yet."}</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div className="saved-items-drawer-content">
          {/* Manual / exchange-key sources (existing pathway — untouched) */}
          {accounts.length ? (
            <section className="saved-items-section">
              <div className="saved-items-section-eyebrow">Workspace sources</div>
              {accounts.map((account) => {
                const trust = account?.providerTrust;
                const cannotTrade = trust ? trust.cannotTrade : true;
                const cannotWithdraw = trust ? trust.cannotWithdraw : true;
                return (
                  <div key={account.id || `${account.exchange}-${account.username}`} className="saved-items-row connection-row">
                    <div className="saved-items-row-copy">
                      <strong>{account.provider || account.exchange || "Connected venue"}</strong>
                      <span>{account.username || "Workspace source"} · {String(account.venueType || "cex").toUpperCase()}</span>
                      {cannotTrade && cannotWithdraw ? (
                        <span className="connection-row-trust-note">Zenin cannot trade or withdraw from this account.</span>
                      ) : null}
                    </div>
                    <div className="saved-items-row-meta">
                      {renderScopeBadge(account)}
                      <span>{account.lastSyncAt ? `Synced ${formatSavedTimestamp(account.lastSyncAt)}` : "Sync pending"}</span>
                      {(() => {
                        const st = accountSyncState(account.provider || account.exchange, account.id);
                        return (
                          <span className={`connection-sync-state connection-sync-${st.state}`}>
                            {st.state === "ok" ? nextSyncLabel : st.note}
                            {historyCountFor(account.provider || account.exchange) > 0 ? ` · ${historyCountFor(account.provider || account.exchange)} txns` : ""}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

          {/* Brokerage (SnapTrade pilot) sources — read-only, never merged */}
          {brokerageAccounts.length ? (
            <section className="saved-items-section">
              <div className="saved-items-section-eyebrow">Brokerage accounts · Read-only</div>
              {brokerageAccounts.map((account) => {
                const badge = deriveBrokerageBadge(account);
                const institution = account?.institutionName || account?.providerMeta?.institutionName || account?.provider || "Brokerage";
                const accountNumber = maskAccountNumber(account?.accountNumber || account?.providerMeta?.accountNumber);
                return (
                  <div key={account.id || account.connectionId || `${account.sourceKind}-${account.accountId}`} className="saved-items-row connection-row connection-row--brokerage">
                    <div className="saved-items-row-copy">
                      <strong>{institution}</strong>
                      <span>
                        <span className="connection-source-kind">{String(account.sourceKind || "snaptrade").toUpperCase()}</span>
                        {account.accountName ? ` · ${account.accountName}` : ""}
                        {accountNumber ? ` · ${accountNumber}` : ""}
                      </span>
                      <span className="connection-row-trust-note">Read-only brokerage connection. Zenin cannot trade or withdraw.</span>
                    </div>
                    <div className="saved-items-row-meta">
                      <span className={`provider-trust-pill provider-trust-pill-${badge.tone === "ok" ? "verified" : badge.tone}`}>{badge.label}</span>
                      <span>{formatLastSync(account.lastSyncedAt || account.lastSyncAt)}</span>
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

          {/* First-sync / latest import result — coverage summary from the unified read model */}
          {unifiedPortfolio?.isUnified ? (() => {
            const s = unifiedPortfolio.summary || {};
            const srcs = unifiedPortfolio.sources || [];
            const connected = srcs.filter((x) => x.sourceType !== "manual");
            const manual = srcs.filter((x) => x.sourceType === "manual");
            const excludedManual = manual.filter((x) => x.excluded);
            const unvalued = Number(s.unvaluedTotal || 0);
            const base = s.baseCurrency || "USD";
            return (
              <section className="saved-items-section connection-import-result">
                <div className="saved-items-section-eyebrow">Latest import result</div>
                <div className="connection-import-grid">
                  <div><span className="connection-import-k">Accounts</span><span className="connection-import-v">{connected.length + manual.length}</span></div>
                  <div><span className="connection-import-k">Holdings</span><span className="connection-import-v">{Number(s.positionCount || 0)}</span></div>
                  <div><span className="connection-import-k">Transactions</span><span className="connection-import-v">{unifiedPortfolio.transactions?.length || 0}</span></div>
                  <div><span className="connection-import-k">Valuation</span><span className="connection-import-v">{base}</span></div>
                </div>
                <div className="connection-import-notes">
                  {connected.length > 0 ? (
                    <span className="connection-import-note">Manual holdings excluded from headline — {connected.length} connected source{connected.length === 1 ? "" : "s"} valued.</span>
                  ) : null}
                  {excludedManual.length > 0 ? (
                    <span className="connection-import-note">Excluded manual: {excludedManual.length} (no connected source yet).</span>
                  ) : null}
                  {unvalued > 0 ? (
                    <span className="connection-import-note connection-import-warn">Unvalued: {unvalued.toLocaleString()} {base} (missing price/FX).</span>
                  ) : null}
                  {s.isPartial ? (
                    <span className="connection-import-note connection-import-warn">Partial coverage — some sources could not be valued.</span>
                  ) : null}
                </div>
              </section>
            );
          })() : null}

          {totalCount === 0 ? (
            <section className="saved-items-section">
              <div className="saved-items-empty">
                <strong>No accounts connected</strong>
                <span>Connect an exchange key for workspace context, or link a read-only brokerage to preserve portfolio context.</span>
              </div>
            </section>
          ) : null}

          <div className="saved-items-drawer-actions">
            <button type="button" className="portfolio-v2-link" onClick={onClose}>Close</button>
            <button type="button" className="portfolio-command-primary-cta subtle" onClick={() => { onClose(); onAddConnection?.(); }}>
              Add Connection
            </button>
            <button type="button" className="portfolio-command-primary-cta subtle" onClick={() => { onClose(); onConnectBrokerage?.(); }}>
              Connect brokerage
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
