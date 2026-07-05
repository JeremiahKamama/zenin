import { useEffect, useMemo, useRef, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { DataTable } from "./data-table/DataTable";
import { TradingViewChart } from "./TradingViewChart";
import { chartColors } from "../utils/chartTheme";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { hasWorkspaceSession, loadWorkspaceDoc, saveWorkspaceCollection, saveWorkspaceDoc } from "../utils/workspacePersistence";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { zeninFetchJson } from "../utils/zeninFetch";
import { DashboardLayout, DashboardHero, DashboardGrid } from "./layout/DashboardLayout";

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";
import { zeninFetch } from "../utils/zeninFetch";
import { formatCurrency, getCurrencySymbol, convertToUSD, inferAssetCurrency } from "../utils/currencyUtils";

const BACKEND_URL = ZENIN_API_BASE_URL;

const HOME_VIEW_STORAGE_KEY = "zenin_home_view_state_v1";
const HOME_SAVED_VIEWS_STORAGE_KEY = "zenin_home_saved_views";
const HOME_ALERTS_STORAGE_KEY = "zenin_home_alerts";
const HOME_TASKS_STORAGE_KEY = "zenin_home_workspace_tasks";
const HOME_REBALANCE_STORAGE_KEY = "zenin_home_rebalance_queue";
const HOME_SIGNAL_ARCHIVE_STORAGE_KEY = "zenin_home_signal_archive";
const HOME_SIGNAL_SNOOZE_STORAGE_KEY = "zenin_home_signal_snooze";
const JOURNAL_STORAGE_KEY = "zenin_journal_entries";
const RESEARCH_THESES_NAMESPACE = "research:knowledge:theses";
const RESEARCH_CATALYSTS_NAMESPACE = "research:knowledge:catalysts";
const RESEARCH_TRIGGERS_NAMESPACE = "research:knowledge:triggers";
const RESEARCH_DECISIONS_NAMESPACE = "research:knowledge:decisions";
const RESEARCH_THESES_STORAGE_KEY = "zenin_research_knowledge_theses";
const RESEARCH_CATALYSTS_STORAGE_KEY = "zenin_research_knowledge_catalysts";
const RESEARCH_TRIGGERS_STORAGE_KEY = "zenin_research_knowledge_triggers";
const RESEARCH_DECISIONS_STORAGE_KEY = "zenin_research_knowledge_decisions";

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

function downloadHomeCsv(fileName, rows) {
  if (!Array.isArray(rows) || !rows.length || typeof document === "undefined") return;
  const csv = rows
    .map((row) => row.map((value) => `"${String(value ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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

function toTitleLabel(value) {
  return String(value || "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function HomeModule({
  portfolio,
  trades = [],
  assets,
  marketMovers = [],
  watchlistAssets = [],
  activeOptionsTrades = [],
  multiChainCache = {},
  spotPrices = {},
  onSelectAsset,
  accountMetrics = null,
  calculatePortfolioValue,
  calculatePortfolioGain,
  balance = 0,
  onViewAllPositions,
  onViewFullMetrics,
  onOpenWatchlist,
  onOpenAnalytics,
  onOpenResearch,
  openMarketContextOnMount = false,
  onMarketContextOpened
}) {
  const moversHorizons = getAppRuntimeConfig()?.ui?.moversHorizons || {
    daily: { label: "Daily", interval: "1D" },
    weekly: { label: "Weekly", interval: "1W" },
    quarterly: { label: "Quarterly", interval: "3M" },
    ytd: { label: "YTD", interval: "YTD" },
    yearly: { label: "Yearly", interval: "1Y" }
  };
  const displayIntervals = Array.isArray(getAppRuntimeConfig()?.ui?.homeDisplayIntervals)
    ? getAppRuntimeConfig().ui.homeDisplayIntervals
    : ["1D", "1W", "1M", "3M", "1Y", "ALL"];
  const [chartMode, setChartMode] = useState("equity"); // equity | percentage | pnl
  const [chartInterval, setChartInterval] = useState("1D");
  const [moversHorizon, setMoversHorizon] = useState("daily");
  const [moversPerformanceByKey, setMoversPerformanceByKey] = useState({});
  const [moversLoading, setMoversLoading] = useState(false);
  const [todayView, setTodayView] = useState({
    vix: null,
    rates: null,
    breadth: null,
    sentiment: "Neutral",
    headlines: []
  });
  const [eventRows, setEventRows] = useState([]);
  const [quickActionFeedback, setQuickActionFeedback] = useState("");
  const [activeAttentionFlow, setActiveAttentionFlow] = useState(null);
  const [attentionFlowStep, setAttentionFlowStep] = useState(1);
  const [archivedAttentionCards, setArchivedAttentionCards] = useState(() => readStoredJson(HOME_SIGNAL_ARCHIVE_STORAGE_KEY, []));
  const [snoozedAttentionCards, setSnoozedAttentionCards] = useState(() => readStoredJson(HOME_SIGNAL_SNOOZE_STORAGE_KEY, []));
  const [flowSelection, setFlowSelection] = useState(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowActionLabel, setFlowActionLabel] = useState("");
  const [homeLastUpdatedAt, setHomeLastUpdatedAt] = useState(Date.now());
  const [homeToast, setHomeToast] = useState("");
  const [selectedHoldingDetail, setSelectedHoldingDetail] = useState(null);
  const [selectedActivityDetail, setSelectedActivityDetail] = useState(null);
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [marketScope, setMarketScope] = useState("all");
  const [marketDetailOpen, setMarketDetailOpen] = useState(false);
  const [marketDetailTab, setMarketDetailTab] = useState("equities");
  const [marketRegion, setMarketRegion] = useState("global");
  const [marketSortBy, setMarketSortBy] = useState("marketCap");
  const [marketRefreshNonce, setMarketRefreshNonce] = useState(0);
  const [macroData, setMacroData] = useState([]);
  const [homeEquitiesSnapshot, setHomeEquitiesSnapshot] = useState(null);
  const [eventsData, setEventsData] = useState([]);
  const [marketDataLoading, setMarketDataLoading] = useState(false);
  const [marketContextHealth, setMarketContextHealth] = useState({
    status: "idle",
    staleSources: [],
    unavailableSources: [],
  });
  const [showSavedItemsDrawer, setShowSavedItemsDrawer] = useState(false);
  const [showSignalArchiveDrawer, setShowSignalArchiveDrawer] = useState(false);
  const [pendingDismissCard, setPendingDismissCard] = useState(null);
  const [savedHomeViews, setSavedHomeViews] = useState(() => readStoredJson(HOME_SAVED_VIEWS_STORAGE_KEY, []));
  const [savedHomeAlerts, setSavedHomeAlerts] = useState(() => readStoredJson(HOME_ALERTS_STORAGE_KEY, []));
  const [savedHomeTasks, setSavedHomeTasks] = useState(() => readStoredJson(HOME_TASKS_STORAGE_KEY, []));
  const [savedHomeRebalances, setSavedHomeRebalances] = useState(() => readStoredJson(HOME_REBALANCE_STORAGE_KEY, []));
  const [researchTheses, setResearchTheses] = useState(() => readStoredJson(RESEARCH_THESES_STORAGE_KEY, []));
  const [researchCatalysts, setResearchCatalysts] = useState(() => readStoredJson(RESEARCH_CATALYSTS_STORAGE_KEY, []));
  const [researchTriggers, setResearchTriggers] = useState(() => readStoredJson(RESEARCH_TRIGGERS_STORAGE_KEY, []));
  const [researchDecisions, setResearchDecisions] = useState(() => readStoredJson(RESEARCH_DECISIONS_STORAGE_KEY, []));
  const moversPerfCacheRef = useRef(new Map());
  const flowTimerRef = useRef(null);
  const homePrefsHydratedRef = useRef(false);
  const [flowOutcome, setFlowOutcome] = useState({ title: "", message: "", tone: "success" });

  const getSaveTargetLabel = () => hasWorkspaceSession() ? "your Zenin workspace" : "this browser";

  const syncHomeCollection = async (namespace, rows, limit = 100) => {
    return saveWorkspaceCollection(namespace, rows, limit);
  };

  const syncResearchCollection = async (namespace, storageKey, rows, limit = 500) => {
    localStorage.setItem(storageKey, JSON.stringify(rows));
    return saveWorkspaceCollection(namespace, rows, limit);
  };

  const archiveAttentionCard = (card, reason = "dismissed") => {
    if (!card?.id) return;
    setArchivedAttentionCards((prev) => {
      const remaining = Array.isArray(prev) ? prev.filter((entry) => entry?.id !== card.id) : [];
      return [{
        id: card.id,
        title: card.title,
        severity: card.severity,
        reason,
        archivedAt: new Date().toISOString()
      }, ...remaining].slice(0, 50);
    });
    setSnoozedAttentionCards((prev) => Array.isArray(prev) ? prev.filter((entry) => entry?.id !== card.id) : []);
  };

  const snoozeAttentionCard = (card, hours = 24) => {
    if (!card?.id) return;
    const snoozeUntil = new Date(Date.now() + (hours * 60 * 60 * 1000)).toISOString();
    setSnoozedAttentionCards((prev) => {
      const remaining = Array.isArray(prev) ? prev.filter((entry) => entry?.id !== card.id) : [];
      return [{
        id: card.id,
        title: card.title,
        severity: card.severity,
        snoozedAt: new Date().toISOString(),
        snoozeUntil
      }, ...remaining].slice(0, 50);
    });
  };

  const topPositions = useMemo(() => {
    const spotPositions = (Array.isArray(portfolio) ? portfolio : []).map((asset) => {
      const currency = asset?.currency || asset?.quotedCurrency || "USD";
      const rawValue = (Number(asset?.price) || 0) * (Number(asset?.quantity) || 0);
      const __positionValue = convertToUSD(rawValue, currency, spotPrices);
      return {
        ...asset,
        __isOptionPosition: false,
        __positionValue
      };
    });

    const optionPositions = (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []).map((trade) => {
      const chain = multiChainCache?.[trade.asset];
      const spot = spotPrices?.[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      const mark = Number(metrics?.currentMark || 0);
      const qty = Number(trade?.qty || trade?.quantity || 1);
      const markValue = Math.abs(mark * qty);
      return {
        id: `opt-top-${trade.id || `${trade.asset}-${trade.strategy}`}`,
        symbol: String(trade?.asset || "OPT").toUpperCase(),
        strategy: trade?.strategy || "Options Strategy",
        quantity: qty,
        __isOptionPosition: true,
        __positionValue: Number.isFinite(markValue) ? markValue : 0,
        __optionPnl: Number(metrics?.pnl || 0)
      };
    });

    return [...spotPositions, ...optionPositions]
      .sort((a, b) => (Number(b.__positionValue) || 0) - (Number(a.__positionValue) || 0))
      .slice(0, 8);
  }, [portfolio, activeOptionsTrades, multiChainCache, spotPrices]);

  const resolveMoverType = (asset) => {
    const type = String(asset?.type || "").toLowerCase();
    const marketType = String(asset?.marketType || "").toLowerCase();
    const symbol = String(asset?.symbol || "").toUpperCase();
    
    if (type.includes("crypto") || type === "stablecoin" || type === "exchange token" || marketType === "spot") return "crypto";
    if (type.includes("forex") || type.includes("fx") || symbol.includes("/") || asset?.pair) return "forex";
    if (type.includes("commodity") || ["GLD", "GC", "CL", "NG"].includes(symbol)) return "commodity";
    if (type.includes("option")) return "option";
    
    return "equity";
  };

  const moversUniverse = useMemo(() => {
    const normalizePortfolioAsset = (asset) => {
      const symbol = String(asset?.symbol || "").toUpperCase();
      const quantity = Number(asset?.quantity || 0);
      const price = Number(asset?.price || 0);
      return {
        ...asset,
        symbol,
        price: Number.isFinite(price) && price > 0 ? price : asset?.price,
        __positionValue: Number.isFinite(price * quantity) ? price * quantity : 0
      };
    };

    const holdingsSource = (Array.isArray(portfolio) ? portfolio : [])
      .map(normalizePortfolioAsset)
      .filter((asset) => asset.symbol);
    const watchlistSource = Array.isArray(watchlistAssets) ? watchlistAssets : [];
    const broadSource = [
      ...holdingsSource,
      ...watchlistSource,
      ...(Array.isArray(marketMovers) ? marketMovers : []),
      ...(Array.isArray(assets) ? assets : [])
    ];

    const source =
      marketScope === "holdings"
        ? holdingsSource
        : marketScope === "watchlist"
        ? watchlistSource
        : broadSource;

    const priceMap = new Map();
    [...broadSource, ...marketMovers, ...assets].forEach((asset) => {
      const symbol = String(asset?.symbol || "").toUpperCase();
      if (!symbol || priceMap.has(symbol)) return;
      priceMap.set(symbol, {
        price: Number.isFinite(Number(asset?.price)) ? Number(asset.price) : null,
        name: asset?.name || symbol
      });
    });

    const deduped = new Map();
    const fallbackSource = source.length ? source : broadSource;
    fallbackSource.forEach((asset) => {
      const symbol = String(asset?.symbol || "").toUpperCase();
      if (!symbol || deduped.has(symbol)) return;
      const priced = priceMap.get(symbol);
      deduped.set(symbol, {
        ...asset,
        symbol,
        name: asset?.name || priced?.name || symbol,
        price: Number.isFinite(Number(asset?.price))
          ? Number(asset.price)
          : (Number.isFinite(Number(priced?.price)) ? Number(priced.price) : null),
        __moverType: resolveMoverType(asset)
      });
    });

    return [...deduped.values()];
  }, [watchlistAssets, marketMovers, assets, portfolio, marketScope]);

  const moversUniverseKey = useMemo(
    () => moversUniverse.map((a) => `${a.symbol}:${a.__moverType}`).join("|"),
    [moversUniverse]
  );

  useEffect(() => {
    if (moversUniverse.length === 0) {
      setMoversLoading(false);
      setMoversPerformanceByKey({});
      return;
    }

    const controller = new AbortController();
    const { signal } = controller;
    setMoversLoading(true);
    const nextByKey = {};
    let cursor = 0;
    const concurrency = Math.min(6, moversUniverse.length);

    const worker = async () => {
      while (!signal.aborted && cursor < moversUniverse.length) {
        const index = cursor;
        cursor += 1;
        const asset = moversUniverse[index];
        const symbol = asset.symbol;
        const moverType = asset.__moverType === "crypto" ? "crypto" : "tradfi";
        const key = `${symbol}:${moverType}`;
        if (moversPerfCacheRef.current.has(key)) {
          nextByKey[key] = moversPerfCacheRef.current.get(key);
          continue;
        }

        try {
          const res = await zeninFetch(
            `/interval-performance?symbol=${encodeURIComponent(symbol)}&type=${encodeURIComponent(moverType)}`,
            { signal }
          );
          if (!res.ok) continue;
          const data = await res.json();
          const perf = data?.performance && typeof data.performance === "object" ? data.performance : null;
          if (!perf) continue;
          moversPerfCacheRef.current.set(key, perf);
          nextByKey[key] = perf;
        } catch (error) {
          if (signal.aborted) return;
          console.warn(`[Home] Performance fetch failed for ${key}:`, error?.message || error);
        }
      }
    };

    Promise.all(Array.from({ length: concurrency }, () => worker()))
      .then(() => {
        if (signal.aborted) return;
        const hydrated = {};
        moversUniverse.forEach((asset) => {
          const moverType = asset.__moverType === "crypto" ? "crypto" : "tradfi";
          const key = `${asset.symbol}:${moverType}`;
          const perf = nextByKey[key] || moversPerfCacheRef.current.get(key);
          if (perf) hydrated[key] = perf;
        });
        setMoversPerformanceByKey(hydrated);
      })
      .finally(() => {
        if (!signal.aborted) {
          setMoversLoading(false);
        }
      });

    return () => controller.abort();
  }, [moversUniverseKey, marketRefreshNonce]);

  const getMoverChange = (asset) => {
    const symbol = String(asset?.symbol || "").toUpperCase();
    const moverType = asset?.__moverType === "crypto" ? "crypto" : "tradfi";
    const key = `${symbol}:${moverType}`;
    const perf = moversPerformanceByKey[key];
    const intervalCode = moversHorizons[moversHorizon]?.interval || "1D";
    const value = Number(perf?.[intervalCode]);
    if (Number.isFinite(value)) return value;
    return null;
  };

  const moversWithChange = moversUniverse
    .map((asset) => ({ ...asset, __moverChange: getMoverChange(asset) }))
    .filter((asset) => Number.isFinite(asset.__moverChange));

  const moversCoverage = useMemo(() => {
    const intervalCode = moversHorizons[moversHorizon]?.interval || "1D";
    return moversUniverse.reduce((summary, asset) => {
      const moverType = asset?.__moverType === "crypto" ? "crypto" : "tradfi";
      const key = `${String(asset?.symbol || "").toUpperCase()}:${moverType}`;
      const perf = moversPerformanceByKey[key];
      const exactValue = Number(perf?.[intervalCode]);

      summary.total += 1;
      if (Number.isFinite(exactValue)) {
        summary.resolved += 1;
      } else {
        summary.unavailable += 1;
      }
      return summary;
    }, { total: 0, resolved: 0, fallback: 0, unavailable: 0 });
  }, [moversUniverse, moversPerformanceByKey, moversHorizon]);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const hydrateTodayView = async () => {
      try {
        const [macroPayload, earningsPayload] = await Promise.allSettled([
          zeninFetchJson("/macro-indicators?country=USA", { signal }),
          zeninFetchJson("/earnings-calendar", { signal })
        ]);
        if (signal.aborted) return;

        const macroValue = macroPayload.status === "fulfilled" ? macroPayload.value : null;
        const earningsValue = earningsPayload.status === "fulfilled" ? earningsPayload.value : null;

        const macroRows = Array.isArray(macroValue?.indicators)
          ? macroValue.indicators
          : Array.isArray(macroValue?.data)
          ? macroValue.data
          : [];
        const vixRow = macroRows.find((row) => String(row?.name || row?.indicator || "").toLowerCase().includes("vix"));
        const rateRow = macroRows.find((row) => String(row?.name || row?.indicator || "").toLowerCase().includes("interest"));
        const breadthRow = macroRows.find((row) => String(row?.name || row?.indicator || "").toLowerCase().includes("advance"));
        const vixValue = Number(vixRow?.value);
        const sentiment = Number.isFinite(vixValue)
          ? vixValue > 25 ? "Risk Off" : vixValue < 15 ? "Risk On" : "Balanced"
          : "Neutral";

        const earningsRows = Array.isArray(earningsValue?.events)
          ? earningsValue.events
          : Array.isArray(earningsValue?.rows)
          ? earningsValue.rows
          : Array.isArray(earningsValue)
          ? earningsValue
          : [];
        setEventRows(earningsRows.slice(0, 8));
        setTodayView({
          vix: Number.isFinite(vixValue) ? vixValue : null,
          rates: Number(rateRow?.value),
          breadth: Number(breadthRow?.value),
          sentiment,
          headlines: earningsRows.slice(0, 3).map((row) => {
            const symbol = row?.symbol || row?.ticker || "Event";
            const date = row?.date || row?.reportDate || "";
            return `${symbol} earnings ${date ? `on ${date}` : "upcoming"}`;
          })
        });
      } catch (error) {
        console.warn("[Home] Today view headlines fetch failed:", error?.message || error);
        if (!signal.aborted) {
          setTodayView((prev) => ({
            ...prev,
            headlines: ["Macro and earnings feeds unavailable, showing portfolio-native signals."]
          }));
          setEventRows([]);
        }
      }
    };
    hydrateTodayView();
    return () => controller.abort();
  }, []);

  const gainers = [...moversWithChange]
    .sort((a, b) => (b.__moverChange || 0) - (a.__moverChange || 0))
    .slice(0, 5);
  const losers = [...moversWithChange]
    .sort((a, b) => (a.__moverChange || 0) - (b.__moverChange || 0))
    .slice(0, 5);

  const portfolioValue = calculatePortfolioValue();
  const derivedAccountMetrics = useMemo(
    () => calculateAccountSnapshot({
      trades,
      portfolioValue,
      balance
    }),
    [trades, portfolioValue, balance]
  );
  const activeAccountMetrics = accountMetrics || derivedAccountMetrics;
  const initialBalance = Number(activeAccountMetrics?.initialBalance) || INITIAL_ACCOUNT_BALANCE;
  const tradeTimeline = Array.isArray(activeAccountMetrics?.tradeTimeline) ? activeAccountMetrics.tradeTimeline : [];
  const liveAvailableBalance = Number.isFinite(Number(activeAccountMetrics?.liveAvailableBalance))
    ? Number(activeAccountMetrics.liveAvailableBalance)
    : initialBalance;
  const totalAccountEquity = Number.isFinite(Number(activeAccountMetrics?.totalAccountEquity))
    ? Number(activeAccountMetrics.totalAccountEquity)
    : (liveAvailableBalance + portfolioValue);
  const realizedPnl = Number(activeAccountMetrics?.realizedPnl || 0);
  const unrealizedPnl = Number(activeAccountMetrics?.unrealizedPnl || calculatePortfolioGain() || 0);

  const dailyChange = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const anchor = [...tradeTimeline].reverse().find((point) => Number(point?.t) <= dayAgo);
    const start = Number(anchor?.equity || initialBalance);
    return totalAccountEquity - start;
  }, [tradeTimeline, totalAccountEquity, initialBalance]);

  const weeklyChange = useMemo(() => {
    if (tradeTimeline.length < 2) return 0;
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const weekAnchor = [...tradeTimeline].reverse().find((point) => Number(point?.t) <= weekAgo);
    const start = Number(weekAnchor?.equity || initialBalance);
    return totalAccountEquity - start;
  }, [tradeTimeline, totalAccountEquity, initialBalance]);

  const ytdChange = useMemo(() => {
    const now = new Date();
    const ytdStartTs = new Date(now.getFullYear(), 0, 1).getTime();
    const ytdAnchor = [...tradeTimeline].reverse().find((point) => Number(point?.t) <= ytdStartTs);
    const start = Number(ytdAnchor?.equity || initialBalance);
    return totalAccountEquity - start;
  }, [tradeTimeline, totalAccountEquity, initialBalance]);

  const alerts = useMemo(() => {
    const rows = [];
    const highVolMovers = moversWithChange.filter((row) => Math.abs(Number(row.__moverChange || 0)) >= 5).slice(0, 3);
    highVolMovers.forEach((row) => {
      rows.push({
        id: `mv-${row.symbol}`,
        type: "price",
        text: `${row.symbol} moved ${Number(row.__moverChange).toFixed(2)}% (${moversHorizons[moversHorizon]?.label || "selected horizon"})`
      });
    });
    if (Number.isFinite(todayView.vix) && todayView.vix > 25) {
      rows.push({ id: "vix-risk", type: "risk", text: `VIX elevated at ${todayView.vix.toFixed(2)}.` });
    }
    if (moversCoverage.unavailable > 0) {
      rows.push({ id: "missing-data", type: "data", text: `${moversCoverage.unavailable} symbols missing interval data.` });
    }
    eventRows.slice(0, 2).forEach((evt, idx) => {
      rows.push({
        id: `evt-${idx}`,
        type: "earnings",
        text: `${evt?.symbol || evt?.ticker || "Upcoming"} earnings ${evt?.date || evt?.reportDate || "soon"}`
      });
    });
    return rows.slice(0, 6);
  }, [moversWithChange, moversHorizon, todayView.vix, moversCoverage.unavailable, eventRows]);

  const needsAttention = useMemo(() => {
    const rows = [];
    if ((watchlistAssets || []).length === 0) rows.push("Watchlist is empty. Add symbols for stronger alert coverage.");
    if (moversCoverage.unavailable > 0) rows.push(`${moversCoverage.unavailable} assets have stale or missing interval performance data.`);
    if ((portfolio || []).length === 0) rows.push("Portfolio has no open positions.");
    if (Math.abs(weeklyChange) > Math.max(500, totalAccountEquity * 0.05)) rows.push("Weekly equity swing exceeded 5% of account value.");
    return rows;
  }, [watchlistAssets, moversCoverage.unavailable, portfolio, weeklyChange, totalAccountEquity]);

  const quickActions = [
    { id: "trade", label: "Add Trade", action: () => onSelectAsset?.(gainers[0] || moversUniverse[0] || null) },
    { id: "rebalance", label: "Rebalance", action: () => openAttentionFlow("rebalance") },
    { id: "alert", label: "Set Alert", action: async () => {
      const leader = gainers[0] || moversUniverse[0];
      if (!leader) {
        setQuickActionFeedback("Add holdings or watchlist assets before creating alerts.");
        return;
      }
      const nextAlerts = appendStoredRecord(HOME_ALERTS_STORAGE_KEY, {
        id: `home-alert-${Date.now()}`,
        createdAt: new Date().toISOString(),
        symbol: leader.symbol,
        type: leader.__moverType || leader.type || "asset",
        context: "home-top-mover",
        message: `${leader.symbol} moved ${formatSignedPercent(Number(leader.__moverChange || 0))} on the ${moversHorizons[moversHorizon]?.label || "selected"} horizon.`
      }, 50);
      setSavedHomeAlerts(nextAlerts);
      try {
        await syncHomeCollection("home:alerts", nextAlerts, 50);
        setQuickActionFeedback(`Alert saved for ${leader.symbol} in ${getSaveTargetLabel()}. Open Saved Items to review it anytime.`);
      } catch (error) {
        console.warn("Home alert save failed.", error);
        setQuickActionFeedback(`Could not sync the alert for ${leader.symbol}: ${error?.message || "workspace save failed"}`);
      }
    } },
    { id: "journal", label: "Journal Note", action: async () => {
      const leader = gainers[0] || moversUniverse[0];
      const existing = readStoredJson(JOURNAL_STORAGE_KEY, []);
      const rows = Array.isArray(existing) ? existing : [];
      const nowIso = new Date().toISOString();
      const symbol = String(leader?.symbol || "MARKET").toUpperCase();
      const note = {
        id: `jrnl-home-${Date.now()}`,
        createdAt: nowIso,
        symbol,
        tradeDate: nowIso,
        side: "NOTE",
        quantity: 0,
        price: Number(leader?.price || 0),
        notional: 0,
        marketType: leader?.__moverType || leader?.type || "Insight",
        status: "Idea",
        strategy: "Home Insight",
        setupTag: "Home Insight",
        marketRegime: riskOn ? "Risk On" : "Risk Off",
        timeframe: "intraday",
        emotion: "neutral",
        confidence: 4,
        preThesis: leader
          ? `${symbol} is a notable mover on the ${moversHorizons[moversHorizon]?.label || "selected"} horizon. Capture follow-up plan before taking a trade.`
          : "Capture today’s market takeaway from the Home dashboard.",
        postReview: "",
        mistakeCategory: "",
        learned: "",
        chartLink: ""
      };
      const nextRows = [note, ...rows].slice(0, 300);
      localStorage.setItem(JOURNAL_STORAGE_KEY, JSON.stringify(nextRows));
      try {
        await syncHomeCollection("journal:entries", nextRows, 500);
        setQuickActionFeedback(`Journal note saved in ${getSaveTargetLabel()} for ${symbol}.`);
      } catch (error) {
        console.warn("Home journal note save failed.", error);
        setQuickActionFeedback(`Could not sync the journal note for ${symbol}: ${error?.message || "workspace save failed"}`);
      }
    } }
  ];

  const queueWorkspaceTask = async (kind, payload = {}) => {
    const nextTasks = appendStoredRecord(HOME_TASKS_STORAGE_KEY, {
      id: `home-task-${Date.now()}`,
      kind,
      createdAt: new Date().toISOString(),
      ...payload
    }, 60);
    await syncHomeCollection("home:tasks", nextTasks, 60);
    return nextTasks;
  };

  const handleRefreshDashboard = (toastMessage = "Dashboard refreshed.") => {
    setHomeLastUpdatedAt(Date.now());
    setMarketRefreshNonce((prev) => prev + 1);
    setHomeToast(toastMessage);
  };

  const handleSaveHomeView = async () => {
    const nextViews = appendStoredRecord(HOME_SAVED_VIEWS_STORAGE_KEY, {
      id: `home-view-${Date.now()}`,
      createdAt: new Date().toISOString(),
      chartMode,
      chartInterval,
      moversHorizon,
      marketScope,
      marketDetailTab,
      marketRegion,
      marketSortBy
    }, 25);
    setSavedHomeViews(nextViews);
    try {
      await syncHomeCollection("home:saved_views", nextViews, 25);
      setHomeToast(`View saved in ${getSaveTargetLabel()}. Open Saved Items to reapply it later.`);
    } catch (error) {
      console.warn("Home view save failed.", error);
      setHomeToast(`Could not sync the view: ${error?.message || "workspace save failed"}`);
    }
  };

  const handleMissingDataAction = (mode) => {
    const symbol = String(flowSelection?.symbol || "ASSET").toUpperCase();
    const issue = flowSelection?.issue || "Missing price data";
    runFlowProcessing(
      4,
      mode === "source" ? `Refreshing ${symbol} market data...` : `Saving manual review for ${symbol}...`,
      3,
      0,
      async () => {
        const nextTasks = await queueWorkspaceTask("missing-data", { mode, symbol, issue });
        setSavedHomeTasks(nextTasks);
        handleRefreshDashboard("");
        setFlowOutcome({
          title: mode === "source" ? "Refresh queued" : "Manual review saved",
          message: mode === "source"
            ? `${symbol} was saved to ${getSaveTargetLabel()} for refresh follow-up. You can review it from Saved Items.`
            : `${symbol} was saved to ${getSaveTargetLabel()} for manual follow-up. You can review it from Saved Items.`
        });
      }
    );
  };

  const handleQueueHomeRebalance = () => {
    const nextQueue = appendStoredRecord(HOME_REBALANCE_STORAGE_KEY, {
      id: `home-rebalance-${Date.now()}`,
      createdAt: new Date().toISOString(),
      drift: Number(rebalanceDriftPct.toFixed(2)),
      estimatedCost: Number(rebalancePlanRows.cost || 0),
      plan: rebalancePlanRows.rows
    }, 20);
    setSavedHomeRebalances(nextQueue);
    runFlowProcessing(4, `Saving rebalance plan to ${getSaveTargetLabel()}...`, 3, 0, async () => {
      await syncHomeCollection("home:rebalance_queue", nextQueue, 20);
      setHomeLastUpdatedAt(Date.now());
      setFlowOutcome({
        title: "Rebalance queued",
        message: `The rebalance plan was saved in ${getSaveTargetLabel()}. Open Saved Items when you want to revisit it.`
      });
    });
  };

  const handleVolatilityAction = (action) => {
    const symbol = String(flowSelection?.symbol || "ASSET").toUpperCase();
    if (action === "alert") {
      const nextAlerts = appendStoredRecord(HOME_ALERTS_STORAGE_KEY, {
        id: `vol-alert-${Date.now()}`,
        createdAt: new Date().toISOString(),
        symbol,
        type: "volatility",
        context: "action-center",
        message: `${symbol} volatility exceeded your recent baseline.`
      }, 50);
      setSavedHomeAlerts(nextAlerts);
    } else {
      // Persisted in the processing step so errors can be shown in the flow.
    }
    runFlowProcessing(4, `Saving ${symbol} ${action} workflow...`, 3, 0, async () => {
      if (action === "alert") {
        await syncHomeCollection("home:alerts", readStoredJson(HOME_ALERTS_STORAGE_KEY, []), 50);
      } else {
        const nextTasks = await queueWorkspaceTask(action === "hedge" ? "hedge-review" : "position-review", {
          symbol,
          context: "volatility",
          volatility24h: Number(flowSelection?.volatility24h || 0)
        });
        setSavedHomeTasks(nextTasks);
      }
      setFlowOutcome({
        title: action === "alert" ? "Alert saved" : action === "hedge" ? "Hedge task queued" : "Review queued",
        message: action === "alert"
          ? `${symbol} was saved to ${getSaveTargetLabel()} on your alert list. Open Saved Items to revisit it.`
          : action === "hedge"
            ? `${symbol} was saved to ${getSaveTargetLabel()} for hedge review. Open Saved Items to revisit it.`
            : `${symbol} was saved to ${getSaveTargetLabel()} for position review. Open Saved Items to revisit it.`
      });
    });
  };

  const handleResearchTriggerAction = (action) => {
    const triggerCard = flowSelection;
    const trigger = triggerCard?.trigger;
    const symbol = String(trigger?.symbol || "PORTFOLIO").toUpperCase();
    if (!trigger?.id) {
      setHomeToast("No trigger selected.");
      return;
    }

    if (action === "open-research") {
      closeAttentionFlow();
      onOpenResearch?.();
      return;
    }

    runFlowProcessing(4, `Saving ${symbol} trigger workflow...`, 3, 0, async () => {
      const nowIso = new Date().toISOString();
      const nextTriggers = (Array.isArray(researchTriggers) ? researchTriggers : []).map((item) => (
        String(item?.id) === String(trigger.id)
          ? { ...item, lastTriggeredAt: nowIso, updatedAt: nowIso }
          : item
      ));
      setResearchTriggers(nextTriggers);
      await syncResearchCollection(RESEARCH_TRIGGERS_NAMESPACE, RESEARCH_TRIGGERS_STORAGE_KEY, nextTriggers, 500);

      if (action === "promote") {
        const mappedDecisionAction = trigger.actionType === "sell"
          ? "exit"
          : trigger.actionType === "add"
            ? "buy"
            : trigger.actionType === "review"
              ? "watch"
              : trigger.actionType;
        const nextDecision = {
          id: `decision-trigger-${Date.now()}`,
          symbol,
          action: mappedDecisionAction,
          conviction: "Medium",
          rationale: `${trigger.rationale || trigger.title || "Research trigger fired."} · ${triggerCard?.triggerSummary || ""} · ${triggerCard?.currentValueLabel || ""}`.trim(),
          thesisId: trigger.linkedThesisId || "",
          createdAt: nowIso,
          updatedAt: nowIso
        };
        const nextDecisions = [nextDecision, ...(Array.isArray(researchDecisions) ? researchDecisions : [])].slice(0, 500);
        setResearchDecisions(nextDecisions);
        await syncResearchCollection(RESEARCH_DECISIONS_NAMESPACE, RESEARCH_DECISIONS_STORAGE_KEY, nextDecisions, 500);
      }

      setFlowOutcome({
        title: action === "promote" ? "Decision logged" : "Trigger reviewed",
        message: action === "promote"
          ? `${symbol} was promoted into Research Decisions and the trigger cooldown is active.`
          : `${symbol} trigger was marked reviewed and will stay quiet until its cooldown expires.`
      });
    });
  };

  useEffect(() => {
    if (!marketDetailOpen) return;

    const controller = new AbortController();
    const { signal } = controller;

    // Hydrate from resilient cache immediately so the page never flashes empty.
    const macroCache = readResilientCache("market-context", { source: "macro" });
    const eventsCache = readResilientCache("market-context", { source: "economic-calendar" });
    const equitiesCache = readResilientCache("market-context", { source: "equities" });

    if (macroCache?.payload) setMacroData(Array.isArray(macroCache.payload) ? macroCache.payload : []);
    if (eventsCache?.payload) setEventsData(Array.isArray(eventsCache.payload) ? eventsCache.payload : []);
    if (equitiesCache?.payload) setHomeEquitiesSnapshot(equitiesCache.payload);

    // If all three caches are present, mark health as "stale" while the network fetch runs.
    const hasAnyCache = macroCache?.payload || eventsCache?.payload || equitiesCache?.payload;
    if (hasAnyCache) {
      setMarketContextHealth({ status: "stale", staleSources: ["cached"], unavailableSources: [] });
    }

    const fetchData = async () => {
      setMarketDataLoading(true);

      try {
        const [macroRes, eventsRes, equitiesRes] = await Promise.allSettled([
          zeninFetchJson("/macro-indicators?country=USA", { signal }),
          zeninFetchJson("/economic-calendar", { signal }),
          zeninFetchJson("/analytics/equities", { signal })
        ]);

        if (signal.aborted) return;

        const staleSources = [];
        const unavailableSources = [];

        if (macroRes.status === "fulfilled" && macroRes.value) {
          const data = macroRes.value;
          const metrics = Array.isArray(data?.metrics) ? data.metrics : [];
          setMacroData(metrics);
          writeResilientCache("market-context", { source: "macro" }, metrics);
          if (data?.stale) staleSources.push("macro");
        } else {
          unavailableSources.push("macro");
        }

        if (eventsRes.status === "fulfilled" && eventsRes.value) {
          const data = eventsRes.value;
          const events = Array.isArray(data?.events) ? data.events : [];
          setEventsData(events);
          writeResilientCache("market-context", { source: "economic-calendar" }, events);
          if (data?.stale) staleSources.push("calendar");
        } else {
          unavailableSources.push("calendar");
        }

        if (equitiesRes.status === "fulfilled" && equitiesRes.value) {
          const data = equitiesRes.value;
          setHomeEquitiesSnapshot(data);
          writeResilientCache("market-context", { source: "equities" }, data);
          if (data?.stale) staleSources.push("equities");
        } else {
          unavailableSources.push("equities");
        }

        setMarketContextHealth({
          status: unavailableSources.length
            ? (hasAnyCache ? "stale" : "degraded")
            : staleSources.length
            ? "stale"
            : "live",
          staleSources,
          unavailableSources,
        });
      } catch (err) {
        if (signal.aborted) return;
        console.error("Market Context: Fetch failed", err);
        if (!hasAnyCache) {
          setMacroData([]);
          setEventsData([]);
          setHomeEquitiesSnapshot(null);
          setMarketContextHealth({
            status: "offline",
            staleSources: [],
            unavailableSources: ["macro", "calendar", "equities"],
          });
        }
        // When stale cache exists, keep showing it — the user sees the last-known-good state
        // with the existing "stale" health chip.
      } finally {
        if (!signal.aborted) setMarketDataLoading(false);
      }
    };

    fetchData();
    return () => controller.abort();
  }, [marketDetailOpen, marketRefreshNonce]);

  useEffect(() => {
    if (!openMarketContextOnMount) return;
    setMarketDetailOpen(true);
    onMarketContextOpened?.();
  }, [openMarketContextOnMount, onMarketContextOpened]);

  useEffect(() => {
    let cancelled = false;

    const applySavedView = (saved) => {
      if (!saved || typeof saved !== "object") return;
      if (saved.chartMode) setChartMode(saved.chartMode);
      if (saved.chartInterval) setChartInterval(saved.chartInterval);
      if (saved.moversHorizon) setMoversHorizon(saved.moversHorizon);
      if (saved.marketScope) setMarketScope(saved.marketScope);
      if (saved.marketDetailTab) setMarketDetailTab(saved.marketDetailTab);
      if (saved.marketRegion) setMarketRegion(saved.marketRegion);
      if (saved.marketSortBy) setMarketSortBy(saved.marketSortBy);
    };

    const hydrateViewState = async () => {
      const localSaved = readStoredJson(HOME_VIEW_STORAGE_KEY, null);
      applySavedView(localSaved);
      try {
        const remote = await loadWorkspaceDoc("home:view_state", localSaved);
        if (cancelled) return;
        applySavedView(remote?.document);
      } catch (error) {
        if (!cancelled) {
          console.warn("Home view sync unavailable.", error);
        }
      } finally {
        if (!cancelled) {
          homePrefsHydratedRef.current = true;
        }
      }
    };

    hydrateViewState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!homePrefsHydratedRef.current) return;
    const nextViewState = {
      chartMode,
      chartInterval,
      moversHorizon,
      marketScope,
      marketDetailTab,
      marketRegion,
      marketSortBy,
      updatedAt: new Date().toISOString()
    };
    localStorage.setItem(HOME_VIEW_STORAGE_KEY, JSON.stringify(nextViewState));
    saveWorkspaceDoc("home:view_state", nextViewState).catch((error) => {
      console.warn("Home view sync skipped.", error);
    });
  }, [chartMode, chartInterval, moversHorizon, marketScope, marketDetailTab, marketRegion, marketSortBy]);

  useEffect(() => {
    return () => {
      if (flowTimerRef.current) clearTimeout(flowTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!homeToast) return undefined;
    const timer = setTimeout(() => setHomeToast(""), 2400);
    return () => clearTimeout(timer);
  }, [homeToast]);

  useEffect(() => {
    const activeRows = Array.isArray(snoozedAttentionCards)
      ? snoozedAttentionCards.filter((entry) => {
        const until = new Date(entry?.snoozeUntil || 0).getTime();
        return Number.isFinite(until) && until > Date.now();
      })
      : [];
    if (activeRows.length !== (Array.isArray(snoozedAttentionCards) ? snoozedAttentionCards.length : 0)) {
      setSnoozedAttentionCards(activeRows);
    }
  }, [snoozedAttentionCards]);

  useEffect(() => {
    localStorage.setItem(HOME_SIGNAL_ARCHIVE_STORAGE_KEY, JSON.stringify(archivedAttentionCards));
    syncHomeCollection("home:signal_archive", archivedAttentionCards, 50).catch((error) => {
      console.warn("Signal archive sync skipped.", error);
    });
  }, [archivedAttentionCards]);

  useEffect(() => {
    localStorage.setItem(HOME_SIGNAL_SNOOZE_STORAGE_KEY, JSON.stringify(snoozedAttentionCards));
    syncHomeCollection("home:signal_snooze", snoozedAttentionCards, 50).catch((error) => {
      console.warn("Signal snooze sync skipped.", error);
    });
  }, [snoozedAttentionCards]);

  useEffect(() => {
    if (!activeAttentionFlow && !selectedHoldingDetail && !selectedActivityDetail && !showAllActivity && !marketDetailOpen) return;
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        setActiveAttentionFlow(null);
        setSelectedHoldingDetail(null);
        setSelectedActivityDetail(null);
        setShowAllActivity(false);
        setMarketDetailOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeAttentionFlow, selectedHoldingDetail, selectedActivityDetail, showAllActivity, marketDetailOpen]);

  const relativeAgeLabel = (raw, fallbackDays = 2) => {
    const ts = new Date(raw || 0).getTime();
    if (!Number.isFinite(ts) || ts <= 0) return `${fallbackDays} days ago`;
    const diffDays = Math.max(1, Math.round((Date.now() - ts) / (24 * 60 * 60 * 1000)));
    return `${diffDays} days ago`;
  };

  const missingFlowRows = useMemo(() => {
    const intervalCode = moversHorizons[moversHorizon]?.interval || "1D";
    const rows = (Array.isArray(moversUniverse) ? moversUniverse : []).reduce((acc, asset, idx) => {
      const symbol = String(asset?.symbol || "").toUpperCase();
      const moverType = asset?.__moverType === "crypto" ? "crypto" : "tradfi";
      const key = `${symbol}:${moverType}`;
      const perf = moversPerformanceByKey[key];
      const exactValue = Number(perf?.[intervalCode]);
      const unavailable = !Number.isFinite(exactValue);
      if (!unavailable) return acc;
      const inferredType = moverType === "crypto" ? "Crypto" : "Stock";
      const issue = idx % 2 === 0 ? "Price data missing" : "Reference data missing";
      acc.push({
        symbol,
        name: asset?.name || symbol,
        type: inferredType,
        issue,
        updatedAt: relativeAgeLabel(asset?.updatedAt || asset?.date_added, (idx % 6) + 1)
      });
      return acc;
    }, []);
    return rows.slice(0, 6);
  }, [moversHorizon, moversUniverse, moversPerformanceByKey]);

  const volatilityFlowRows = useMemo(() => {
    const rows = [...(Array.isArray(moversWithChange) ? moversWithChange : [])]
      .sort((a, b) => Math.abs(Number(b.__moverChange || 0)) - Math.abs(Number(a.__moverChange || 0)))
      .filter((row) => Math.abs(Number(row.__moverChange || 0)) >= 5)
      .slice(0, 5)
      .map((row, idx) => {
        const absMove = Math.abs(Number(row.__moverChange || 0));
        const volatility24h = Math.min(99, 20 + absMove * 8);
        return {
          symbol: String(row?.symbol || "ASSET").toUpperCase(),
          asset: row?.name || row?.symbol || "Asset",
          volatility24h,
          change: Number(row.__moverChange || 0),
          riskLabel: idx < 2 ? "High" : idx < 4 ? "Moderate" : "Watch"
        };
      });
    return rows;
  }, [moversWithChange]);

  const openAttentionFlow = (flowKind, selection = null, initialStep = 1) => {
    if (!flowKind) return;
    setActiveAttentionFlow(flowKind);
    setAttentionFlowStep(initialStep);
    setFlowBusy(false);
    setFlowActionLabel("");
    setFlowOutcome({ title: "", message: "", tone: "success" });
    if (selection) {
      setFlowSelection(selection);
    } else if (flowKind === "missing") {
      setFlowSelection(missingFlowRows[0] || null);
    } else if (flowKind === "rebalance") {
      setFlowSelection(rebalancePlanRows.rows[0] || null);
    } else if (flowKind === "research-trigger") {
      setFlowSelection(activeResearchTriggerRows[0] || null);
    } else {
      setFlowSelection(volatilityFlowRows[0] || null);
    }
  };

  const closeAttentionFlow = () => {
    setActiveAttentionFlow(null);
    setFlowBusy(false);
    setFlowActionLabel("");
    setFlowOutcome({ title: "", message: "", tone: "success" });
  };

  const runFlowProcessing = (nextStep, actionLabel, processingStep = 3, delayMs = 1300, onComplete = null) => {
    setFlowActionLabel(actionLabel || "");
    setFlowBusy(true);
    setAttentionFlowStep(processingStep);
    if (flowTimerRef.current) clearTimeout(flowTimerRef.current);
    flowTimerRef.current = setTimeout(async () => {
      try {
        await onComplete?.();
      } catch (error) {
        console.warn("Home workflow action failed.", error);
        setFlowOutcome({
          title: "Action not saved",
          message: error?.message || "Zenin could not save this action. Please try again.",
          tone: "error"
        });
      }
      setFlowBusy(false);
      setAttentionFlowStep(nextStep);
    }, delayMs);
  };

  const optionTimelineAdjustments = useMemo(() => {
    return (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : [])
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
  const isTreasuryAsset = (asset) => {
    const symbol = (asset?.symbol || "").toUpperCase();
    return asset?.market === "Treasury" || /^USTY?\d+Y$/.test(symbol);
  };
  const formatAssetPrice = (asset) => {
    const value = Number(asset?.price);
    if (!Number.isFinite(value)) return "—";
    if (isTreasuryAsset(asset)) return `${value.toFixed(2)}%`;
    const currency = inferAssetCurrency(asset);
    const symbol = getCurrencySymbol(currency);
    return `${symbol}${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

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
      { t: now, equity: totalAccountEquity }
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
      if (chartMode === "equity") return equity;
      if (chartMode === "percentage") return ((equity - initialBalance) / initialBalance) * 100;
      return equity - initialBalance;
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
  }, [chartInterval, chartMode, tradeTimeline, totalAccountEquity, optionTimelineAdjustments, initialBalance]);
  const isProfitable = totalAccountEquity >= initialBalance;

  const chartColor = chartMode === "pnl"
    ? (isProfitable ? "var(--color-success)" : "var(--color-danger)")
    : "var(--color-data-primary)";

  const yFormatter = (val) => {
    if (chartMode === "percentage") return `${val.toFixed(2)}%`;
    if (chartMode === "pnl") return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const performanceChartSeries = useMemo(() => [{
    name: chartMode === "percentage" ? "% Gain" : chartMode === "pnl" ? "Cash PnL" : "Equity Curve",
    type: "area",
    color: chartColor,
    data: chartData
      .map(([time, value]) => ({
        time: Math.floor(Number(time) / 1000),
        value: Number(value)
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value)),
    options: {
      priceFormat: {
        type: "custom",
        minMove: 0.01,
        formatter: yFormatter
      }
    }
  }], [chartColor, chartData, chartMode]);

  const performancePriceLines = useMemo(() => [{
    id: "performance-baseline",
    price: chartMode === "equity" ? initialBalance : 0,
    title: chartMode === "equity" ? "Start" : "Break-even",
    color: "rgba(148,163,184,0.72)"
  }], [chartMode, initialBalance]);

  const performanceChartOptions = useMemo(() => ({
    rightPriceScale: {
      borderVisible: false,
      scaleMargins: { top: 0.12, bottom: 0.12 }
    }
  }), []);

  const formatPerformanceTime = (time) => new Date(Number(time) * 1000).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });

  const formatMoney = (value, currency = "USD") => {
    return formatCurrency(value, currency);
  };

  const formatSignedMoney = (value, currency = "USD") => {
    return formatCurrency(value, currency, { sign: true });
  };

  const formatSignedPercent = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "0.00%";
    return `${num >= 0 ? "+" : ""}${num.toFixed(2)}%`;
  };

  const formatCompactMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "$0";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      notation: "compact",
      maximumFractionDigits: 1
    }).format(num);
  };

  const classifyMarketAsset = (asset) => {
    const type = String(asset?.type || asset?.marketType || "").toLowerCase();
    const symbol = String(asset?.symbol || "").toUpperCase();
    const name = String(asset?.name || "").toLowerCase();
    
    if (type.includes("option") || asset?.__marketType === "options") return "options";
    if (
      type.includes("crypto") || 
      ["BTC", "ETH", "SOL", "HYPE"].includes(symbol)
    ) return "crypto";
    
    if (
      type.includes("forex") || 
      type.includes("fx") || 
      symbol.includes("/") || 
      ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD", "USDCAD", "USDCHF"].includes(symbol)
    ) return "macro";
    
    if (
      type.includes("commodity") ||
      ["GLD", "GC", "CL", "WTI", "USO", "SLV", "NG"].includes(symbol) ||
      name.includes("gold") ||
      name.includes("crude") ||
      name.includes("oil")
    ) return "commodities";
    
    return "equities";
  };

  const regionMatchesMarketFilter = (asset) => {
    if (marketRegion === "global") return true;
    const region = String(asset?.region || asset?.country || asset?.market || "").toLowerCase();
    const symbol = String(asset?.symbol || "").toUpperCase();
    if (marketRegion === "us") return !region || region.includes("us") || region.includes("usa") || region.includes("united states");
    if (marketRegion === "international") return region && !region.includes("us") && !region.includes("usa") && !region.includes("united states");
    if (marketRegion === "crypto") return ["BTC", "ETH", "SOL", "HYPE"].includes(symbol) || String(asset?.type || "").toLowerCase().includes("crypto");
    return true;
  };

  const getSortMetric = (asset) => {
    if (marketSortBy === "daily") return Math.abs(Number(asset?.__moverChange || 0));
    if (marketSortBy === "exposure") return Number(asset?.__exposurePct || asset?.__positionValue || 0);
    return Number(asset?.marketCap || asset?.__positionValue || asset?.price || 0);
  };

  const marketDetailMovers = useMemo(() => {
    const optionRows = (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []).map((trade) => {
      const chain = multiChainCache?.[trade.asset];
      const spot = spotPrices?.[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      const symbol = `${String(trade?.asset || "OPT").toUpperCase()} ${String(trade?.strategy || "Option")}`;
      const price = Number(metrics?.currentMark || trade?.entryPrice || trade?.premium || 0);
      const pnl = Number(metrics?.pnl || 0);
      const basis = Math.max(1, Math.abs(Number(trade?.entryPrice || trade?.premium || price || 1)));
      return {
        id: `detail-opt-${trade.id || symbol}`,
        symbol,
        name: trade?.strategy || "Options position",
        type: "Option",
        price,
        __marketType: "options",
        __moverChange: (pnl / basis) * 100,
        __positionValue: Math.abs(price * Number(trade?.qty || trade?.quantity || 1)),
        __exposurePct: 0
      };
    });

    const rows = [...(Array.isArray(moversWithChange) ? moversWithChange : []), ...optionRows]
      .map((asset) => ({
        ...asset,
        __marketTab: classifyMarketAsset(asset)
      }))
      .filter((asset) => asset.__marketTab === marketDetailTab && regionMatchesMarketFilter(asset))
      .sort((a, b) => getSortMetric(b) - getSortMetric(a));

    return rows;
  }, [activeOptionsTrades, marketDetailTab, marketRegion, marketSortBy, moversWithChange, multiChainCache, spotPrices]);

  const marketDetailGainers = marketDetailMovers
    .filter((asset) => Number(asset.__moverChange || 0) >= 0)
    .sort((a, b) => Number(b.__moverChange || 0) - Number(a.__moverChange || 0))
    .slice(0, 5);

  const marketDetailLosers = marketDetailMovers
    .filter((asset) => Number(asset.__moverChange || 0) < 0)
    .sort((a, b) => Number(a.__moverChange || 0) - Number(b.__moverChange || 0))
    .slice(0, 5);

  const portfolioImpactRows = useMemo(() => {
    const spotRows = (Array.isArray(portfolio) ? portfolio : []).map((asset) => {
      const quantity = Number(asset?.quantity || 0);
      const price = Number(asset?.price || 0);
      const value = Number.isFinite(quantity * price) ? quantity * price : 0;
      const symbol = String(asset?.symbol || "").toUpperCase();
      const mover = moversWithChange.find((row) => String(row?.symbol || "").toUpperCase() === symbol);
      const dailyPct = Number(mover?.__moverChange ?? asset?.priceChangePercent ?? 0);
      const impact = value * (dailyPct / 100);
      return {
        id: `impact-${asset.id || symbol}`,
        symbol,
        name: asset?.name || symbol,
        type: (() => {
          const cat = classifyMarketAsset(asset);
          if (cat === "crypto") return "Crypto";
          if (cat === "commodities") return "Commodity";
          if (cat === "macro") return "Macro";
          return "Equity";
        })(),
        price,
        dailyPct,
        exposurePct: totalAccountEquity > 0 ? (value / totalAccountEquity) * 100 : 0,
        value,
        impact
      };
    });

    const optionRows = (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []).map((trade) => {
      const chain = multiChainCache?.[trade.asset];
      const spot = spotPrices?.[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      const price = Number(metrics?.currentMark || trade?.entryPrice || trade?.premium || 0);
      const quantity = Number(trade?.qty || trade?.quantity || 1);
      const value = Math.abs(price * quantity);
      const impact = Number(metrics?.pnl || 0);
      return {
        id: `impact-option-${trade.id || trade.asset}`,
        symbol: `${String(trade?.asset || "OPT").toUpperCase()} Option`,
        name: trade?.strategy || "Options position",
        type: "Option",
        price,
        dailyPct: value > 0 ? (impact / value) * 100 : 0,
        exposurePct: totalAccountEquity > 0 ? (value / totalAccountEquity) * 100 : 0,
        value,
        impact
      };
    });

    return [...spotRows, ...optionRows]
      .sort((a, b) => Math.abs(Number(b.impact || 0)) - Math.abs(Number(a.impact || 0)))
      .slice(0, 6);
  }, [activeOptionsTrades, moversWithChange, multiChainCache, portfolio, spotPrices, totalAccountEquity]);

  const macroContextRows = useMemo(() => {
    if (macroData.length > 0) {
      return macroData.map(m => {
        const val = Number(m.current);
        let displayValue = m.unit === "%" ? `${val.toFixed(2)}%` : val.toFixed(2);
        
        // Truncate large values like Balance of Trade
        if (m.label.toLowerCase().includes("balance of trade") || m.indicatorCode === "balance_of_trade") {
          const absVal = Math.abs(val);
          if (absVal >= 1e9) displayValue = `$${(val / 1e9).toFixed(2)}B`;
          else if (absVal >= 1e6) displayValue = `$${(val / 1e6).toFixed(2)}M`;
          else displayValue = `$${val.toLocaleString()}`;
        }

        return {
          indicator: m.label,
          value: displayValue,
          change: m.changePercent ? `${m.changePercent > 0 ? "+" : ""}${m.changePercent.toFixed(2)}%` : "—",
          tone: m.changePercent > 0 ? "positive" : m.changePercent < 0 ? "negative" : "neutral",
          series: m.series?.map(s => s.value) || []
        };
      }).slice(0, 6);
    }
    return [];
  }, [macroData]);

  const upcomingEvents = useMemo(() => {
    if (eventsData.length > 0) {
      return eventsData.slice(0, 8).map(e => {
        // Handle "Tuesday, May 14, 2024" or "May 14"
        const dateStr = String(e.date || "");
        const parts = dateStr.split(", ");
        const shortDate = parts.length > 1 ? parts[1] : dateStr;
        return {
          date: shortDate,
          title: e.title,
          time: e.time,
          impact: e.impact,
          country: e.country
        };
      });
    }
    const earningsSource = Array.isArray(eventRows) ? eventRows : [];
    return earningsSource.slice(0, 5).map((event) => ({
      date: event?.date || event?.reportDate || event?.start || "Upcoming",
      title: event?.title || event?.event || event?.symbol || "Earnings event",
      time: event?.time || event?.period || "",
      impact: event?.impact || "Watch",
      country: event?.country || "Earnings"
    }));
  }, [eventRows, eventsData]);

  const optionsTheta = (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []).reduce(
    (sum, trade) => sum + Number(trade?.theta || trade?.greeks?.theta || 0),
    0
  );

  const marketSignals = useMemo(() => {
    const strongestGainer = marketDetailGainers[0] || gainers[0];
    const strongestLoser = marketDetailLosers[0] || losers[0];
    const leadMacroMove = macroData
      .filter((row) => Number.isFinite(Number(row?.changePercent)))
      .sort((a, b) => Math.abs(Number(b?.changePercent || 0)) - Math.abs(Number(a?.changePercent || 0)))[0] || null;
    const nextEvent = upcomingEvents[0] || null;
    const rows = [
      strongestGainer ? {
        title: `${strongestGainer.symbol} Momentum`,
        text: `${strongestGainer.name || strongestGainer.symbol} is leading selected-market strength.`,
        type: classifyMarketAsset(strongestGainer),
        tone: "bullish",
        source: moversHorizons[moversHorizon]?.label || "Selected horizon"
      } : null,
      activeOptionsTrades.length ? {
        title: "Options Flow Spike",
        text: `${activeOptionsTrades.length} active options positions are contributing to portfolio sensitivity.`,
        type: "options",
        tone: optionsTheta >= 0 ? "bullish" : "watch",
        source: `${activeOptionsTrades.length} live positions`
      } : null,
      strongestLoser ? {
        title: `${strongestLoser.symbol} Pressure Watch`,
        text: `${strongestLoser.name || strongestLoser.symbol} is the weakest selected-market signal.`,
        type: classifyMarketAsset(strongestLoser),
        tone: "bearish",
        source: moversHorizons[moversHorizon]?.label || "Selected horizon"
      } : null,
      leadMacroMove ? {
        title: leadMacroMove.label,
        text: `${leadMacroMove.label} moved ${Number(leadMacroMove.changePercent || 0) >= 0 ? "higher" : "lower"} versus the previous reading.`,
        type: "macro",
        tone: Number(leadMacroMove.changePercent || 0) >= 0 ? "bullish" : "bearish",
        source: "Macro indicators"
      } : null,
      nextEvent ? {
        title: nextEvent.title,
        text: `${nextEvent.impact} event scheduled for ${nextEvent.date}${nextEvent.time ? ` • ${nextEvent.time}` : ""}.`,
        type: "macro",
        tone: String(nextEvent.impact || "").toLowerCase().includes("high") ? "watch" : "bullish",
        source: nextEvent.country || "Economic calendar"
      } : null
    ];
    return rows.filter(Boolean).slice(0, 5);
  }, [activeOptionsTrades.length, gainers, losers, macroData, marketDetailGainers, marketDetailLosers, moversHorizon, optionsTheta, upcomingEvents]);

  const stablecoinSymbols = new Set(["USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USDE", "USDD"]);
  const isCashLikeAsset = (asset) => {
    const symbol = String(asset?.symbol || "").toUpperCase();
    const type = String(asset?.type || "").toLowerCase();
    return stablecoinSymbols.has(symbol) || type === "stablecoin";
  };

  const topHoldingsRows = useMemo(() => {
    const spotRows = (Array.isArray(portfolio) ? portfolio : [])
      .map((item) => {
        const price = Number(item?.price) || 0;
        const quantity = Number(item?.quantity) || 0;
        const value = price * quantity;
        return { ...item, __positionValue: Number.isFinite(value) ? value : 0 };
      })
      .sort((a, b) => Number(b.__positionValue || 0) - Number(a.__positionValue || 0))
      .slice(0, 3);

    const totalSpotValue = spotRows.reduce((sum, row) => sum + Number(row.__positionValue || 0), 0);
    return spotRows.map((row) => {
      const alloc = totalSpotValue > 0 ? (Number(row.__positionValue || 0) / totalSpotValue) * 100 : 0;
      return {
        ...row,
        __allocationPercent: alloc
      };
    });
  }, [portfolio]);

  const allocationBreakdown = useMemo(() => {
    const spotRows = Array.isArray(portfolio) ? portfolio : [];
    let cryptoValue = 0;
    let stablecoinValue = 0;
    spotRows.forEach((item) => {
      const value = (Number(item?.price) || 0) * (Number(item?.quantity) || 0);
      if (!Number.isFinite(value) || value <= 0) return;
      if (isCashLikeAsset(item)) {
        stablecoinValue += value;
      } else {
        cryptoValue += value;
      }
    });

    const cashValue = Math.max(0, Number(liveAvailableBalance || 0)) + stablecoinValue;
    const total = cryptoValue + cashValue;
    const cryptoPercent = total > 0 ? (cryptoValue / total) * 100 : 0;
    const cashPercent = total > 0 ? (cashValue / total) * 100 : 0;
    return { cryptoValue, cashValue, total, cryptoPercent, cashPercent };
  }, [portfolio, liveAvailableBalance]);

  const rebalanceDriftPct = Math.abs(allocationBreakdown.cryptoPercent - 50);

  const liveAssetBySymbol = useMemo(() => {
    const map = new Map();
    [portfolio, watchlistAssets, assets, marketMovers, moversUniverse].forEach((collection) => {
      (Array.isArray(collection) ? collection : []).forEach((asset) => {
        const symbol = String(asset?.symbol || "").trim().toUpperCase();
        if (!symbol) return;
        if (!map.has(symbol)) map.set(symbol, asset);
      });
    });
    return map;
  }, [portfolio, watchlistAssets, assets, marketMovers, moversUniverse]);

  const portfolioWeightBySymbol = useMemo(() => {
    const map = new Map();
    (Array.isArray(portfolio) ? portfolio : []).forEach((asset) => {
      const symbol = String(asset?.symbol || "").trim().toUpperCase();
      if (!symbol) return;
      const currency = asset?.currency || asset?.quotedCurrency || "USD";
      const rawValue = (Number(asset?.price) || 0) * (Number(asset?.quantity) || 0);
      const value = convertToUSD(rawValue, currency, spotPrices);
      map.set(symbol, totalAccountEquity > 0 ? (value / totalAccountEquity) * 100 : 0);
    });
    return map;
  }, [portfolio, spotPrices, totalAccountEquity]);

  const activeResearchTriggerRows = useMemo(() => {
    const triggerRows = Array.isArray(researchTriggers) ? researchTriggers : [];
    const thesisById = new Map((Array.isArray(researchTheses) ? researchTheses : []).map((item) => [item?.id, item]));
    const catalystById = new Map((Array.isArray(researchCatalysts) ? researchCatalysts : []).map((item) => [item?.id, item]));
    const now = Date.now();

    function resolveLivePrice(symbol) {
      const asset = liveAssetBySymbol.get(symbol);
      const directSpot = spotPrices?.[symbol];
      const candidates = [
        typeof directSpot === "number" ? directSpot : null,
        Number(directSpot?.price),
        Number(directSpot?.usd),
        Number(asset?.price),
        Number(asset?.currentPrice),
        Number(asset?.lastPrice),
        Number(asset?.close),
        Number(asset?.mark)
      ];
      return candidates.find((value) => Number.isFinite(value)) ?? null;
    }

    function formatTriggerMoney(value) {
      return formatCurrency(Number(value || 0), "USD", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    return triggerRows.reduce((acc, rawTrigger) => {
      const trigger = rawTrigger && typeof rawTrigger === "object" ? rawTrigger : {};
      const status = String(trigger.status || "active").toLowerCase();
      if (status !== "active") return acc;

      const actionType = String(trigger.actionType || "review").toLowerCase();
      const conditionType = String(trigger.conditionType || "").toLowerCase();
      const symbol = String(trigger.symbol || "").trim().toUpperCase();
      const thresholdValue = Number(trigger.thresholdValue);
      if (!Number.isFinite(thresholdValue)) return acc;

      const cooldownHours = Math.max(1, Number(trigger.cooldownHours || 24));
      const lastTriggeredAt = new Date(trigger.lastTriggeredAt || 0).getTime();
      if (Number.isFinite(lastTriggeredAt) && lastTriggeredAt > 0 && (lastTriggeredAt + (cooldownHours * 60 * 60 * 1000)) > now) {
        return acc;
      }

      const linkedThesis = thesisById.get(trigger.linkedThesisId) || null;
      const linkedCatalyst = catalystById.get(trigger.linkedCatalystId)
        || (Array.isArray(researchCatalysts) ? researchCatalysts.find((item) => String(item?.symbol || "").toUpperCase() === symbol && String(item?.status || "").toLowerCase() === "upcoming") : null)
        || null;

      let triggered = false;
      let currentValueLabel = "Awaiting live state";
      let triggerSummary = "";

      if (conditionType === "price_above" || conditionType === "price_below") {
        const livePrice = resolveLivePrice(symbol);
        if (!Number.isFinite(livePrice)) return acc;
        triggered = conditionType === "price_above" ? livePrice >= thresholdValue : livePrice <= thresholdValue;
        currentValueLabel = `Live ${formatTriggerMoney(livePrice)}`;
        triggerSummary = `${conditionType === "price_above" ? "Above" : "Below"} ${formatTriggerMoney(thresholdValue)}`;
      } else if (conditionType === "position_weight_above") {
        const weight = portfolioWeightBySymbol.get(symbol);
        if (!Number.isFinite(weight)) return acc;
        triggered = weight >= thresholdValue;
        currentValueLabel = `Weight ${weight.toFixed(1)}%`;
        triggerSummary = `Limit ${thresholdValue.toFixed(1)}%`;
      } else if (conditionType === "catalyst_within_days") {
        const eventDate = new Date(linkedCatalyst?.eventDate || 0).getTime();
        if (!Number.isFinite(eventDate) || eventDate <= 0) return acc;
        const daysUntil = Math.ceil((eventDate - now) / (24 * 60 * 60 * 1000));
        triggered = daysUntil >= 0 && daysUntil <= thresholdValue;
        currentValueLabel = `${Math.max(0, daysUntil)} day${Math.max(0, daysUntil) === 1 ? "" : "s"} to event`;
        triggerSummary = linkedCatalyst?.title ? `${linkedCatalyst.title} within ${thresholdValue}d` : `Catalyst within ${thresholdValue}d`;
      } else {
        return acc;
      }

      if (!triggered) return acc;

      const variant = actionType === "sell" ? "risk" : actionType === "trim" ? "warn" : "info";
      const severity = actionType === "sell" ? "CRITICAL" : actionType === "trim" ? "WARNING" : "INFO";
      acc.push({
        id: `research-trigger:${trigger.id}`,
        triggerId: trigger.id,
        variant,
        severity,
        type: "research-trigger",
        title: trigger.title || `${symbol || "Portfolio"} ${toTitleLabel(actionType)} trigger`,
        text: trigger.rationale || `${toTitleLabel(actionType)} action is now in scope for ${symbol || "the portfolio"}.`,
        cta: "Review Flow",
        meta: `${symbol || "Portfolio"} · ${triggerSummary} · ${currentValueLabel}`,
        trigger,
        linkedThesis,
        linkedCatalyst,
        currentValueLabel,
        triggerSummary
      });
      return acc;
    }, []);
  }, [assets, liveAssetBySymbol, marketMovers, moversUniverse, portfolio, portfolioWeightBySymbol, researchCatalysts, researchTheses, researchTriggers, spotPrices]);

  const rebalancePlanRows = useMemo(() => {
    const planCost = Number((20 + rebalanceDriftPct * 0.65).toFixed(2));
    const sellValue = Math.max(0, Number((rebalanceDriftPct * 32).toFixed(2)));
    const buyCore = Number((sellValue * 0.42).toFixed(2));
    const buyDiversifier = Number((sellValue * 0.33).toFixed(2));
    const buyIncome = Number((sellValue * 0.25).toFixed(2));
    return {
      cost: planCost,
      rows: [
        { action: "Sell US Large Cap", amount: -sellValue, tag: "Overweight" },
        { action: "Buy Emerging Markets", amount: buyCore, tag: "Underweight" },
        { action: "Buy Bonds", amount: buyIncome, tag: "Underweight" },
        { action: "Buy International Equities", amount: buyDiversifier, tag: "Underweight" }
      ]
    };
  }, [rebalanceDriftPct]);

  const recentActivityRows = useMemo(() => {
    const rows = (Array.isArray(trades) ? trades : [])
      .map((trade) => ({
        ...trade,
        __ts: new Date(trade?.executedAt || trade?.date || 0).getTime()
      }))
      .filter((trade) => Number.isFinite(trade.__ts) && trade.__ts > 0)
      .sort((a, b) => b.__ts - a.__ts)
      .slice(0, 3);

    const now = Date.now();
    return rows.map((trade) => {
      const diffMs = Math.max(0, now - trade.__ts);
      const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
      const diffDays = Math.floor(diffHours / 24);
      const when = diffDays >= 1 ? `${diffDays}d ago` : diffHours >= 1 ? `${diffHours}h ago` : "just now";
      const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "Sell" : "Buy";
      const orderType = String(trade?.orderType || trade?.order_type || "MKT").trim().toUpperCase();
      const symbol = String(trade?.asset || trade?.symbol || "Asset").toUpperCase();
      const notional = Number(trade?.notional || (Number(trade?.price || 0) * Number(trade?.quantity || 0)));
      const stamp = new Date(trade.__ts);
      const timestampLabel = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, "0")}-${String(stamp.getDate()).padStart(2, "0")} ${String(stamp.getHours()).padStart(2, "0")}:${String(stamp.getMinutes()).padStart(2, "0")}`;
      return {
        id: trade.id || `${symbol}-${trade.__ts}`,
        title: `${side} ${symbol}`,
        action: side.toUpperCase(),
        instruction: `${side.toUpperCase()}_${orderType}`,
        symbol,
        when,
        timestampLabel,
        value: Number.isFinite(notional) ? notional : 0,
        status: String(trade?.status || "Filled").toUpperCase(),
        raw: trade,
        tone: side === "Sell" ? "sell" : "buy"
      };
    });
  }, [trades]);

  const dayRange = useMemo(() => {
    const now = Date.now();
    const oneDayAgo = now - 24 * 60 * 60 * 1000;
    const points = (Array.isArray(tradeTimeline) ? tradeTimeline : [])
      .filter((point) => Number(point?.t) >= oneDayAgo && Number.isFinite(Number(point?.equity)))
      .map((point) => Number(point.equity));
    points.push(totalAccountEquity);
    const low = Math.min(...points);
    const high = Math.max(...points);
    return {
      low: Number.isFinite(low) ? low : totalAccountEquity,
      high: Number.isFinite(high) ? high : totalAccountEquity
    };
  }, [tradeTimeline, totalAccountEquity]);

  const totalGainLoss = realizedPnl + unrealizedPnl;
  const totalReturnPct = initialBalance > 0 ? (totalGainLoss / initialBalance) * 100 : 0;
  const dailyChangePct = initialBalance > 0 ? (dailyChange / initialBalance) * 100 : 0;
  const chartModeButtons = [["equity", "Chart"], ["percentage", "Return"], ["pnl", "P&L"]];
  const heroIntervals = ["Today", "1W", "1M", "YTD", "1Y"];
  const chartValues = chartData.map((point) => Number(point?.[1])).filter(Number.isFinite);
  const bestDay = chartValues.length > 1 ? Math.max(...chartValues.slice(1).map((value, idx) => value - chartValues[idx])) : 0;
  const worstDay = chartValues.length > 1 ? Math.min(...chartValues.slice(1).map((value, idx) => value - chartValues[idx])) : 0;
  const chartPeak = chartValues.reduce((peak, value) => Math.max(peak, value), chartValues[0] || 0);
  const currentDrawdown = chartPeak ? chartValues[chartValues.length - 1] - chartPeak : 0;
  const maxDrawdown = chartValues.reduce((maxDd, value, idx) => {
    const peak = Math.max(...chartValues.slice(0, idx + 1));
    return Math.min(maxDd, value - peak);
  }, 0);
  const cashWeightPct = totalAccountEquity > 0 ? (allocationBreakdown.cashValue / totalAccountEquity) * 100 : 0;
  const positionsCount = (Array.isArray(portfolio) ? portfolio.length : 0) + (Array.isArray(activeOptionsTrades) ? activeOptionsTrades.length : 0);
  const betaProxy = Math.max(0, Math.min(1.5, (100 - cashWeightPct) / 100));
  const buyingPowerPct = totalAccountEquity > 0 ? (liveAvailableBalance / totalAccountEquity) * 100 : 0;
  const impliedVolDisplay = Number.isFinite(Number(todayView.vix))
    ? `${Number(todayView.vix).toFixed(1)}`
    : volatilityFlowRows.length
    ? `${(
      volatilityFlowRows.reduce((sum, row) => sum + Number(row?.volatility24h || 0), 0) /
      Math.max(1, volatilityFlowRows.length)
    ).toFixed(1)}`
    : "—";
  const executiveStatRows = [
    { label: "Beta Weight", value: `SPY ${betaProxy.toFixed(2)}`, tone: "neutral" },
    { label: "Theta", value: Math.abs(optionsTheta) > 0.01 ? formatSignedMoney(optionsTheta) : "—", tone: Math.abs(optionsTheta) > 0.01 ? "positive" : "neutral" },
    { label: "B/P %", value: `${buyingPowerPct.toFixed(2)}%`, tone: "neutral" },
    { label: "Imp. Vol", value: impliedVolDisplay === "—" ? "—" : `${impliedVolDisplay}%`, tone: Number(impliedVolDisplay) >= 25 ? "risk" : "neutral" }
  ];
  const rangeSpread = Math.max(1, Number(dayRange.high || 0) - Number(dayRange.low || 0));
  const rangeNeedlePct = Math.max(
    0,
    Math.min(100, ((Number(totalAccountEquity || 0) - Number(dayRange.low || 0)) / rangeSpread) * 100)
  );
  const marketContextAvailable = Boolean(
    needsAttention.length ||
    quickActionFeedback ||
    moversLoading ||
    gainers.length ||
    losers.length ||
    todayView.headlines.length ||
    eventRows.length ||
    quickActions.length
  );
  const marketContextPreviewRows = useMemo(() => {
    const combined = [...marketDetailGainers, ...marketDetailLosers]
      .sort((a, b) => Math.abs(Number(b?.__moverChange || 0)) - Math.abs(Number(a?.__moverChange || 0)));
    const seen = new Set();
    return combined.filter((row) => {
      const key = String(row?.symbol || "").toUpperCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 4);
  }, [marketDetailGainers, marketDetailLosers]);
  const nextMarketEvent = upcomingEvents[0] || null;

  const attentionCards = [
    ...(missingFlowRows.length ? [{
      id: "missing",
      variant: "warn",
      severity: "WARNING",
      title: `${missingFlowRows.length} asset${missingFlowRows.length === 1 ? "" : "s"} missing data`,
      text: "Review data gaps and queue the right follow-up without leaving the workspace.",
      cta: "Resolve",
      meta: `Affected assets: ${missingFlowRows.length} · Last checked: just now · Impact: Medium`
    }] : []),
    ...(rebalanceDriftPct >= 5 ? [{
      id: "rebalance",
      variant: "info",
      severity: "INFO",
      title: "Rebalancing suggested",
      text: `Your allocation is ${Math.abs(allocationBreakdown.cryptoPercent - 50).toFixed(1)}% away from target.`,
      cta: "Review Plan",
      meta: `Plan rows: ${rebalancePlanRows.rows.length} · Last checked: just now · Impact: Medium`
    }] : []),
    ...(volatilityFlowRows.length ? [{
      id: "volatility",
      variant: "risk",
      severity: "CRITICAL",
      title: "High volatility alert",
      text: `${volatilityFlowRows.length} symbol${volatilityFlowRows.length === 1 ? "" : "s"} moved beyond the current risk threshold.`,
      cta: "Review Alerts",
      meta: `Affected assets: ${volatilityFlowRows.length} · Last checked: just now · Impact: High`
    }] : []),
    ...activeResearchTriggerRows
  ];
  const archivedAttentionIds = new Set((Array.isArray(archivedAttentionCards) ? archivedAttentionCards : []).map((entry) => entry?.id));
  const snoozedAttentionIds = new Set(
    (Array.isArray(snoozedAttentionCards) ? snoozedAttentionCards : [])
      .filter((entry) => new Date(entry?.snoozeUntil || 0).getTime() > Date.now())
      .map((entry) => entry?.id)
  );
  const visibleAttentionCards = attentionCards.filter(
    (card) => !archivedAttentionIds.has(card.id) && !snoozedAttentionIds.has(card.id)
  );
  const signalArchiveCount = (Array.isArray(archivedAttentionCards) ? archivedAttentionCards.length : 0) +
    (Array.isArray(snoozedAttentionCards) ? snoozedAttentionCards.length : 0);
  const healthState = visibleAttentionCards.some((card) => card.variant === "risk")
    ? "Monitor"
    : visibleAttentionCards.length > 0
      ? "Watch"
      : "Optimal";
  const healthTone = healthState === "Optimal" ? "optimal" : healthState === "Watch" ? "watch" : "risk";

  const attentionFlowSteps = {
    missing: ["Missing Data List", "Asset Detail", "Updating", "Success"],
    rebalance: ["Overview", "Plan", "Confirm", "Success"],
    volatility: ["Volatility List", "Detail", "Insights", "Complete"],
    "research-trigger": ["Trigger", "Action", "Saving", "Complete"]
  };

  const renderAttentionFlow = () => {
    if (!activeAttentionFlow) return null;
    const steps = attentionFlowSteps[activeAttentionFlow] || [];

    const renderProgress = (
      <div className="home-v2-flow-progress">
        {steps.map((label, idx) => {
          const stepIndex = idx + 1;
          const state = stepIndex === attentionFlowStep ? "active" : stepIndex < attentionFlowStep ? "done" : "todo";
          return (
            <div key={`${activeAttentionFlow}-step-${stepIndex}`} className={`home-v2-flow-progress-item ${state}`}>
              <span>{stepIndex}</span>
              <strong>{label}</strong>
            </div>
          );
        })}
      </div>
    );

    const selectedSymbol = String(flowSelection?.symbol || "").toUpperCase();

    let flowBody = null;
    if (activeAttentionFlow === "missing") {
      if (attentionFlowStep === 1) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>Missing Data</h3><span>{missingFlowRows.length} Assets</span></div>
            <p>These assets are missing price or reference data.</p>
            <div className="home-v2-flow-list">
              {missingFlowRows.map((row) => (
                <div key={`miss-${row.symbol}`} className="home-v2-flow-list-row">
                  <div className="home-v2-flow-list-main"><strong>{row.symbol}</strong><span>{row.type}</span></div>
                  <div className="home-v2-flow-list-issue"><strong>{row.issue}</strong><span>{row.updatedAt}</span></div>
                  <button
                    type="button"
                    className="home-v2-flow-btn ghost"
                    onClick={() => {
                      setFlowSelection(row);
                      setAttentionFlowStep(2);
                    }}
                  >
                    Fix
                  </button>
                </div>
              ))}
            </div>
          </div>
        );
      } else if (attentionFlowStep === 2) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>{selectedSymbol || "Asset"} — Fix Data</h3><span>{flowSelection?.type || "Asset"}</span></div>
            <div className="home-v2-flow-detail-grid">
              <div><strong>What&apos;s missing?</strong><p>{flowSelection?.issue || "Real-time price data"}</p></div>
              <div><strong>How to fix</strong><p>Reconnect your data source or update this asset manually.</p></div>
            </div>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary warn" onClick={() => handleMissingDataAction("source")}>Queue Source Refresh</button>
              <button type="button" className="home-v2-flow-btn" onClick={() => handleMissingDataAction("manual")}>Save Manual Review</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={() => setAttentionFlowStep(1)}>Back</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 3 || flowBusy) {
        flowBody = (
          <div className="home-v2-flow-status-card">
            <div className="home-v2-flow-spinner" />
            <h3>Updating data...</h3>
            <p>{flowActionLabel || "This may take a few moments."}</p>
          </div>
        );
      } else {
        flowBody = (
          <div className={`home-v2-flow-status-card ${flowOutcome.tone === "error" ? "warning" : "success"}`}>
            <div className="home-v2-flow-success-mark">{flowOutcome.tone === "error" ? "!" : "✓"}</div>
            <h3>{flowOutcome.title || "Data task completed"}</h3>
            <p>{flowOutcome.message || `${selectedSymbol || "Asset"} follow-up was saved.`}</p>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn" onClick={() => setAttentionFlowStep(1)}>Back to Missing Data</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={closeAttentionFlow}>Close</button>
            </div>
          </div>
        );
      }
    } else if (activeAttentionFlow === "rebalance") {
      const buyCount = rebalancePlanRows.rows.filter((row) => row.amount > 0).length;
      const sellCount = rebalancePlanRows.rows.filter((row) => row.amount < 0).length;
      if (attentionFlowStep === 1) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>Rebalancing Suggested</h3><span>Drift: {rebalanceDriftPct.toFixed(1)}%</span></div>
            <p>Your portfolio has drifted from your target allocation.</p>
            <div className="home-v2-flow-metric-grid">
              <div><span>Current Drift</span><strong>{rebalanceDriftPct.toFixed(1)}%</strong></div>
              <div><span>Est. Impact (1Y)</span><strong>{formatSignedMoney(-(rebalanceDriftPct * 32))}</strong></div>
              <div><span>Rebalance Cost</span><strong>{formatMoney(rebalancePlanRows.cost)}</strong></div>
            </div>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={() => setAttentionFlowStep(2)}>View Rebalance Plan</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 2) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>Rebalance Plan</h3><span>{buyCount} Buys, {sellCount} Sell</span></div>
            <div className="home-v2-flow-list">
              {rebalancePlanRows.rows.map((row) => (
                <div key={`plan-${row.action}`} className="home-v2-flow-list-row">
                  <div className="home-v2-flow-list-main"><strong>{row.action}</strong><span>{row.tag}</span></div>
                  <div className={`home-v2-flow-money ${row.amount >= 0 ? "positive" : "negative"}`}>{formatSignedMoney(row.amount)}</div>
                </div>
              ))}
            </div>
            <div className="home-v2-flow-summary">Estimated cost: <strong>{formatMoney(rebalancePlanRows.cost)}</strong></div>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={() => setAttentionFlowStep(3)}>Continue</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={() => setAttentionFlowStep(1)}>Back</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 3 && !flowBusy) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>Confirm Rebalance</h3><span>{buyCount} Buys, {sellCount} Sell</span></div>
            <p>You are about to save this rebalance plan for review.</p>
            <div className="home-v2-flow-summary">This will reduce drift from <strong>{rebalanceDriftPct.toFixed(1)}%</strong> to <strong>{Math.max(0, rebalanceDriftPct * 0.08).toFixed(1)}%</strong>.</div>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={handleQueueHomeRebalance}>Queue Plan</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={() => setAttentionFlowStep(2)}>Cancel</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 3 && flowBusy) {
        flowBody = (
          <div className="home-v2-flow-status-card">
            <div className="home-v2-flow-spinner" />
            <h3>Saving rebalance...</h3>
            <p>{flowActionLabel || "Saving this plan now."}</p>
          </div>
        );
      } else {
        flowBody = (
          <div className={`home-v2-flow-status-card ${flowOutcome.tone === "error" ? "warning" : "success"}`}>
            <div className="home-v2-flow-success-mark">{flowOutcome.tone === "error" ? "!" : "✓"}</div>
            <h3>{flowOutcome.title || "Rebalance queued"}</h3>
            <p>{flowOutcome.message || "The rebalance plan was saved for review."}</p>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={() => { onViewAllPositions?.(); closeAttentionFlow(); }}>View Portfolio</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={closeAttentionFlow}>Close</button>
            </div>
          </div>
        );
      }
    } else if (activeAttentionFlow === "research-trigger") {
      const trigger = flowSelection?.trigger || {};
      const linkedThesis = flowSelection?.linkedThesis || null;
      const linkedCatalyst = flowSelection?.linkedCatalyst || null;
      if (attentionFlowStep === 1) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>{trigger.title || "Research Trigger"}</h3><span>{String(trigger.actionType || "review").toUpperCase()}</span></div>
            <p>{trigger.rationale || "A research-linked rule is ready for review."}</p>
            <div className="home-v2-flow-detail-grid">
              <div><strong>Current state</strong><p>{flowSelection?.currentValueLabel || "Awaiting live read"}</p></div>
              <div><strong>Trigger rule</strong><p>{flowSelection?.triggerSummary || "Condition not configured"}</p></div>
              <div><strong>Linked thesis</strong><p>{linkedThesis?.title || "No thesis linked"}</p></div>
              <div><strong>Linked catalyst</strong><p>{linkedCatalyst?.title || "No catalyst linked"}</p></div>
            </div>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={() => setAttentionFlowStep(2)}>Take Action</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={onOpenResearch}>Open Research</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 2) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>Action Routing</h3><span>{String(trigger.symbol || "Portfolio").toUpperCase()}</span></div>
            <ul className="home-v2-flow-bullets">
              <li>Promote this fired rule into the Research decision log.</li>
              <li>Mark it reviewed if the desk already acted elsewhere.</li>
              <li>Open Research if the thesis or catalyst needs editing first.</li>
            </ul>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={() => handleResearchTriggerAction("promote")}>Promote to Decision</button>
              <button type="button" className="home-v2-flow-btn" onClick={() => handleResearchTriggerAction("reviewed")}>Mark Reviewed</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={() => handleResearchTriggerAction("open-research")}>Open Research</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 3 && flowBusy) {
        flowBody = (
          <div className="home-v2-flow-status-card">
            <div className="home-v2-flow-spinner" />
            <h3>Saving trigger action...</h3>
            <p>{flowActionLabel || "Updating the trigger workflow."}</p>
          </div>
        );
      } else {
        flowBody = (
          <div className={`home-v2-flow-status-card ${flowOutcome.tone === "error" ? "warning" : "success"}`}>
            <div className="home-v2-flow-success-mark">{flowOutcome.tone === "error" ? "!" : "✓"}</div>
            <h3>{flowOutcome.title || "Trigger workflow saved"}</h3>
            <p>{flowOutcome.message || "The trigger state was updated."}</p>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={onOpenResearch}>Open Research</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={closeAttentionFlow}>Close</button>
            </div>
          </div>
        );
      }
    } else if (attentionFlowStep === 1) {
      flowBody = (
        <div className="home-v2-flow-card">
          <div className="home-v2-flow-headline"><h3>High Volatility Alert</h3><span>{volatilityFlowRows.length} Symbols</span></div>
          <p>Unusual volatility detected in your tracked assets.</p>
          <div className="home-v2-flow-list">
            {volatilityFlowRows.map((row) => (
              <div key={`vol-${row.symbol}`} className="home-v2-flow-list-row">
                <div className="home-v2-flow-list-main"><strong>{row.symbol}</strong><span>{row.asset}</span></div>
                <div className="home-v2-flow-list-issue"><strong>{row.volatility24h.toFixed(1)}%</strong><span className={row.change >= 0 ? "negative" : "positive"}>{row.change >= 0 ? "+" : ""}{row.change.toFixed(1)}%</span></div>
                <button type="button" className="home-v2-flow-btn ghost" onClick={() => { setFlowSelection(row); setAttentionFlowStep(2); }}>Analyze</button>
              </div>
            ))}
          </div>
        </div>
      );
    } else if (attentionFlowStep === 2) {
      flowBody = (
        <div className="home-v2-flow-card">
          <div className="home-v2-flow-headline"><h3>{selectedSymbol} — Analysis</h3><span>{flowSelection?.riskLabel || "Watch"}</span></div>
          <div className="home-v2-flow-vol-grid">
            <div><span>Volatility (24h)</span><strong>{Number(flowSelection?.volatility24h || 0).toFixed(1)}%</strong></div>
            <div><span>Price Change</span><strong className={Number(flowSelection?.change || 0) >= 0 ? "negative" : "positive"}>{Number(flowSelection?.change || 0) >= 0 ? "+" : ""}{Number(flowSelection?.change || 0).toFixed(1)}%</strong></div>
          </div>
          <div className="home-v2-flow-chart-mock">
            <span style={{ width: "18%" }} /><span style={{ width: "31%" }} /><span style={{ width: "47%" }} /><span style={{ width: "64%" }} /><span style={{ width: "52%" }} /><span style={{ width: "78%" }} />
          </div>
          <div className="home-v2-flow-actions">
            <button type="button" className="home-v2-flow-btn primary risk" onClick={() => setAttentionFlowStep(3)}>View Insights</button>
            <button type="button" className="home-v2-flow-btn ghost" onClick={() => setAttentionFlowStep(1)}>Back</button>
          </div>
        </div>
      );
    } else if (attentionFlowStep === 3) {
      flowBody = (
        <div className="home-v2-flow-card">
          <div className="home-v2-flow-headline"><h3>Insights</h3><span>{selectedSymbol}</span></div>
          <ul className="home-v2-flow-bullets">
            <li>Earnings event risk and unusual options activity detected.</li>
            <li>Momentum divergence suggests short-term mean reversion pressure.</li>
            <li>Position variance is above your rolling baseline.</li>
          </ul>
          <div className="home-v2-flow-actions">
            <button type="button" className="home-v2-flow-btn" onClick={() => handleVolatilityAction("review")}>Queue Review</button>
            <button type="button" className="home-v2-flow-btn" onClick={() => handleVolatilityAction("alert")}>Save Alert</button>
            <button type="button" className="home-v2-flow-btn" onClick={() => handleVolatilityAction("hedge")}>Queue Hedge Review</button>
          </div>
        </div>
      );
    } else {
      flowBody = (
        <div className={`home-v2-flow-status-card ${flowOutcome.tone === "error" ? "warning" : "success"}`}>
          <div className="home-v2-flow-success-mark">{flowOutcome.tone === "error" ? "!" : "✓"}</div>
          <h3>{flowOutcome.title || "Alert reviewed"}</h3>
          <p>{flowOutcome.message || "This action was saved for follow-up."}</p>
          <div className="home-v2-flow-actions">
            <button type="button" className="home-v2-flow-btn" onClick={() => setAttentionFlowStep(1)}>Back to Alerts</button>
            <button type="button" className="home-v2-flow-btn ghost" onClick={closeAttentionFlow}>Close</button>
          </div>
        </div>
      );
    }

    return (
      <div className="home-v2-flow-overlay" role="dialog" aria-modal="true" aria-label="Action Center user flow">
        <div className="home-v2-flow-shell">
          <div className="home-v2-flow-top">
            <h2>{activeAttentionFlow === "missing" ? "Missing Data Flow" : activeAttentionFlow === "rebalance" ? "Rebalancing Flow" : activeAttentionFlow === "research-trigger" ? "Research Trigger Flow" : "Volatility Alert Flow"}</h2>
            <button type="button" className="home-v2-flow-close" onClick={closeAttentionFlow} aria-label="Close flow">✕</button>
          </div>
          {renderProgress}
          <div className="home-v2-flow-body">{flowBody}</div>
        </div>
      </div>
    );
  };

  const marketBreadthPct = moversWithChange.length
    ? Math.round((moversWithChange.filter((asset) => Number(asset.__moverChange || 0) >= 0).length / moversWithChange.length) * 100)
    : null;
  const vixValue = Number.isFinite(Number(todayView.vix)) ? Number(todayView.vix) : null;
  const riskOn = Number.isFinite(vixValue) && Number.isFinite(marketBreadthPct) && vixValue < 20 && marketBreadthPct >= 50;
  const breadthScore = Number.isFinite(Number(marketBreadthPct)) ? Math.max(0, Math.min(100, Number(marketBreadthPct))) : 50;
  const vixScore = Number.isFinite(Number(vixValue)) ? Math.max(0, Math.min(100, 100 - (Number(vixValue) * 3))) : 50;
  const marketRegimeScore = Math.round((breadthScore * 0.55) + (vixScore * 0.45));
  const finvizDesk = homeEquitiesSnapshot?.finvizDesk || {};
  const finvizBreadth = homeEquitiesSnapshot?.marketBreadth || null;
  const finvizFactorLeader = finvizDesk?.factorLeader || null;
  const finvizRevisionSummary = finvizDesk?.revisionSummary || {};
  const finvizMoverLeader = Array.isArray(finvizDesk?.moversRows) ? finvizDesk.moversRows[0] : null;
  const finvizFlowRows = Array.isArray(homeEquitiesSnapshot?.fundFlows) ? homeEquitiesSnapshot.fundFlows : [];
  const largeCapFlow = finvizFlowRows.find((row) => row?.symbol === "SPY" && row?.period === "1M") || null;
  const marketSummaryCards = [
    {
      label: "Equities Breadth (S&P 500)",
      value: Number.isFinite(Number(finvizBreadth?.above50dmaPct))
        ? `${Math.round(Number(finvizBreadth.above50dmaPct))}%`
        : Number.isFinite(Number(marketBreadthPct))
        ? `${marketBreadthPct}%`
        : "—",
      change: Number.isFinite(Number(finvizBreadth?.adLine)) ? `${Number(finvizBreadth.adLine) >= 0 ? "+" : ""}${Number(finvizBreadth.adLine).toFixed(0)}` : "—",
      tone: Number.isFinite(Number(finvizBreadth?.adLine)) ? Number(finvizBreadth.adLine) >= 0 ? "positive" : "negative" : "neutral",
      caption: "Finviz breadth proxy",
      color: "var(--color-success)",
      seed: Number.isFinite(Number(finvizBreadth?.above50dmaPct)) ? Number(finvizBreadth.above50dmaPct) : Number(marketBreadthPct) || 0,
    },
    {
      label: "Factor Leader",
      value: finvizFactorLeader?.factor ? String(finvizFactorLeader.factor).toUpperCase() : "—",
      change: Number.isFinite(Number(finvizFactorLeader?.score)) ? `${Number(finvizFactorLeader.score) >= 0 ? "+" : ""}${Number(finvizFactorLeader.score).toFixed(2)}` : "—",
      tone: Number.isFinite(Number(finvizFactorLeader?.score)) ? Number(finvizFactorLeader.score) >= 0 ? "positive" : "negative" : "neutral",
      caption: "Finviz style rotation",
      color: "var(--color-data-secondary)",
      seed: Number(finvizFactorLeader?.score || 0) * 10,
    },
    {
      label: "Earnings Revision Breadth",
      value: Number.isFinite(Number(finvizRevisionSummary?.breadthPct)) ? `${Number(finvizRevisionSummary.breadthPct)}%` : "—",
      change: Number.isFinite(Number(finvizRevisionSummary?.positive)) || Number.isFinite(Number(finvizRevisionSummary?.negative))
        ? `${Number(finvizRevisionSummary?.positive || 0)} up / ${Number(finvizRevisionSummary?.negative || 0)} down`
        : "—",
      tone: Number.isFinite(Number(finvizRevisionSummary?.breadthPct)) ? Number(finvizRevisionSummary.breadthPct) >= 50 ? "positive" : "negative" : "neutral",
      caption: "Finviz ratings feed",
      color: "var(--color-data-muted)",
      seed: Number(finvizRevisionSummary?.breadthPct || 0),
    },
    {
      label: "US Large Cap Flow (1M)",
      value: Number.isFinite(Number(largeCapFlow?.netFlowUsdBn)) ? formatCompactMoney(Number(largeCapFlow.netFlowUsdBn) * 1e9) : "—",
      change: Number.isFinite(Number(largeCapFlow?.netFlowUsdBn)) ? `${Number(largeCapFlow.netFlowUsdBn) >= 0 ? "+" : ""}${Number(largeCapFlow.netFlowUsdBn).toFixed(2)}B` : "—",
      tone: Number.isFinite(Number(largeCapFlow?.netFlowUsdBn)) ? Number(largeCapFlow.netFlowUsdBn) >= 0 ? "positive" : "negative" : "neutral",
      caption: "SPY proxy flow",
      color: "var(--color-data-secondary)",
      seed: Number(largeCapFlow?.netFlowUsdBn || 0) * 10,
    },
    {
      label: "Top Equity Mover",
      value: String(finvizMoverLeader?.symbol || "—"),
      change: Number.isFinite(Number(finvizMoverLeader?.move)) ? formatSignedPercent(finvizMoverLeader.move) : "—",
      tone: Number.isFinite(Number(finvizMoverLeader?.move)) ? Number(finvizMoverLeader.move) >= 0 ? "positive" : "negative" : "neutral",
      caption: finvizMoverLeader?.company || "Finviz screener",
      color: "var(--color-warning)",
      seed: Number.isFinite(Number(finvizMoverLeader?.move)) ? Number(finvizMoverLeader.move) * 10 : 0,
    }
  ];

  const refreshMarketDetail = () => {
    moversPerfCacheRef.current.clear();
    setMoversPerformanceByKey({});
    setHomeLastUpdatedAt(Date.now());
    setMarketRefreshNonce((value) => value + 1);
    setHomeToast("Market context refreshed.");
  };

  const marketContextStatusText = marketDataLoading
    ? "Refreshing live feeds"
    : marketContextHealth.status === "live"
    ? "Live feeds connected"
    : marketContextHealth.status === "stale"
    ? `Using delayed ${marketContextHealth.staleSources.join(", ")} data`
    : marketContextHealth.status === "degraded"
    ? `Missing ${marketContextHealth.unavailableSources.join(", ")} feed${marketContextHealth.unavailableSources.length > 1 ? "s" : ""}`
    : marketContextHealth.status === "offline"
    ? "Backend feeds unavailable"
    : "Waiting for live feeds";

  const openMarketContextDetail = () => {
    setMarketDetailOpen(true);
  };

  const savedItemsCount =
    savedHomeViews.length +
    savedHomeAlerts.length +
    savedHomeTasks.length +
    savedHomeRebalances.length;

  const applySavedHomeView = (view) => {
    if (!view || typeof view !== "object") return;
    setChartMode(view.chartMode || "equity");
    setChartInterval(view.chartInterval || "1D");
    setMoversHorizon(view.moversHorizon || "daily");
    setMarketScope(view.marketScope || "all");
    setMarketDetailTab(view.marketDetailTab || "equities");
    setMarketRegion(view.marketRegion || "global");
    setMarketSortBy(view.marketSortBy || "marketCap");
    setShowSavedItemsDrawer(false);
    setHomeToast("View applied from Saved Items.");
  };

  const reviewSavedHomeItem = (kind, payload) => {
    setShowSavedItemsDrawer(false);
    if (kind === "rebalance") {
      openAttentionFlow("rebalance", payload?.plan?.[0] || payload || null, 2);
      return;
    }
    if (kind === "task") {
      const taskKind = String(payload?.kind || "").toLowerCase();
      const symbol = String(payload?.symbol || "").trim().toUpperCase();
      if (taskKind === "hedge-review" || taskKind === "position-review") {
        const match = volatilityFlowRows.find((row) => String(row?.symbol || "").trim().toUpperCase() === symbol);
        openAttentionFlow("volatility", match || payload || null, match ? 2 : 1);
      } else {
        const match = missingFlowRows.find((row) => String(row?.symbol || "").trim().toUpperCase() === symbol);
        openAttentionFlow("missing", match || payload || null, match ? 2 : 1);
      }
      return;
    }
    if (kind === "alert") {
      const symbol = String(payload?.symbol || "").trim().toUpperCase();
      const volatilityMatch = volatilityFlowRows.find((row) => String(row?.symbol || "").trim().toUpperCase() === symbol);
      if (volatilityMatch) {
        openAttentionFlow("volatility", volatilityMatch, 2);
        return;
      }
      const match = [portfolio, watchlistAssets, assets, moversUniverse]
        .flat()
        .find((entry) => String(entry?.symbol || "").trim().toUpperCase() === symbol);
      if (match) {
        onSelectAsset?.(match);
      } else {
        setHomeToast(symbol ? `Saved alert for ${symbol} is ready for review.` : "Saved alert is ready for review.");
      }
    }
  };

  const openAllActivityDrawer = () => {
    if (!recentActivityRows.length) {
      setHomeToast("No recent activity to export yet.");
      return;
    }
    downloadHomeCsv(
      `home-execution-log-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["timestamp", "symbol", "instruction", "notional_usd", "status", "relative_time"],
        ...recentActivityRows.map((row) => [
          row.timestampLabel,
          row.symbol,
          row.instruction,
          Number(row.value || 0).toFixed(2),
          row.status,
          row.when,
        ]),
      ]
    );
    setHomeToast("Execution log CSV downloaded.");
  };

  if (marketDetailOpen) {
    const totalPortfolioImpact = portfolioImpactRows.reduce((sum, row) => sum + Number(row.impact || 0), 0);
    return (
      <div className="view-container market-context-page">
        {homeToast ? <div className="home-v3-toast" role="status">{homeToast}</div> : null}
        <header className="market-context-detail-header">
          <div className="market-context-detail-copy">
            <button type="button" className="market-context-back" onClick={() => setMarketDetailOpen(false)}>Back to Overview</button>
            <div className="market-context-page-label">Home Intelligence</div>
            <div className="market-context-title-row">
              <h2>Market Context</h2>
              <span className={`market-context-status ${marketContextHealth.status}`}>{marketContextStatusText}</span>
            </div>
            <p>Cross-asset context for the positions, watchlist names, and macro releases shaping today&apos;s book.</p>
            <div className="market-context-snapshot">
              <span>Scope: {marketScope === "all" ? "All assets" : marketScope}</span>
              <span>Region: {marketRegion === "global" ? "Global" : marketRegion}</span>
              <span>Updated {new Date(homeLastUpdatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          </div>
          <div className="market-context-toolbar" aria-label="Market context controls">
            <label>
              <span>Timeframe</span>
              <select value={moversHorizon} onChange={(event) => setMoversHorizon(event.target.value)}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="quarterly">3M</option>
                <option value="ytd">YTD</option>
                <option value="yearly">1Y</option>
              </select>
            </label>
            <label>
              <span>Asset Scope</span>
              <select value={marketScope} onChange={(event) => setMarketScope(event.target.value)}>
                <option value="all">All Assets</option>
                <option value="holdings">Holdings</option>
                <option value="watchlist">Watchlist</option>
              </select>
            </label>
            <label>
              <span>Region</span>
              <select value={marketRegion} onChange={(event) => setMarketRegion(event.target.value)}>
                <option value="global">Global</option>
                <option value="us">United States</option>
                <option value="international">International</option>
                <option value="crypto">Crypto</option>
              </select>
            </label>
            <label>
              <span>Sort By</span>
              <select value={marketSortBy} onChange={(event) => setMarketSortBy(event.target.value)}>
                <option value="marketCap">Market Cap</option>
                <option value="daily">Daily Move</option>
                <option value="exposure">Exposure</option>
              </select>
            </label>
            <button type="button" className="market-context-refresh" onClick={refreshMarketDetail}>
              <span aria-hidden="true">↻</span>
              <strong>Refresh</strong>
              <em>{marketContextStatusText}</em>
            </button>
          </div>
        </header>

        <section className="market-context-panel market-summary-panel">
          <div className="market-panel-head">
            <div>
              <h3>Market Summary</h3>
              <p>Live desk snapshot pulled from equities breadth, flows, movers, and portfolio telemetry.</p>
            </div>
          </div>
          <div className="market-summary-grid">
            {marketSummaryCards.map((card) => (
              <MarketSummaryCard key={card.label} {...card} />
            ))}
            <div className="market-summary-card market-regime-card">
              <span>Market Regime</span>
              <div className={riskOn ? "market-regime-value positive" : "market-regime-value negative"}>{riskOn ? "Risk-On" : "Risk-Off"}</div>
              <p>{riskOn ? "Breadth and volatility favour risk participation." : "Volatility or breadth still argue for defensive positioning."}</p>
              <MarketRegimeGauge value={marketRegimeScore} />
            </div>
          </div>
        </section>

        <section className="market-context-main-grid">
          <div className="market-context-panel market-impact-panel">
            <div className="market-panel-head">
              <div>
                <h3>Portfolio Impact</h3>
                <p>Holdings and option overlays ranked by live contribution to book movement.</p>
              </div>
              <button type="button" onClick={() => onViewAllPositions?.()}>View holdings</button>
            </div>
            <div className="market-impact-table">
              <div className="market-impact-row market-impact-header">
                <span>Asset</span>
                <span>Type</span>
                <span>Price</span>
                <span>Daily %</span>
                <span>Exposure</span>
                <span>Position Value</span>
                <span>Portfolio Impact</span>
              </div>
              {portfolioImpactRows.length ? portfolioImpactRows.map((row) => (
                <div key={row.id} className="market-impact-row">
                  <div className="market-asset-cell">
                    <MarketAssetLogo symbol={row.symbol} type={row.type} />
                    <div><strong>{row.symbol}</strong><span>{row.name}</span></div>
                  </div>
                  <span><MarketTypeBadge type={row.type} /></span>
                  <span>{formatAssetPrice(row)}</span>
                  <span className={Number(row.dailyPct || 0) >= 0 ? "positive" : "negative"}>{formatSignedPercent(row.dailyPct)}</span>
                  <span>{Number(row.exposurePct || 0).toFixed(2)}%</span>
                  <span>{formatMoney(row.value)}</span>
                  <span className={Number(row.impact || 0) >= 0 ? "positive" : "negative"}>{formatSignedMoney(row.impact)}</span>
                </div>
              )) : (
                <div className="market-empty-row">Add holdings to see portfolio impact.</div>
              )}
            </div>
            <div className="market-impact-total">
              <span>Total Portfolio Value</span>
              <strong>{formatMoney(totalAccountEquity)}</strong>
              <em className={totalPortfolioImpact >= 0 ? "positive" : "negative"}>{formatSignedMoney(totalPortfolioImpact)} ({formatSignedPercent(totalAccountEquity > 0 ? (totalPortfolioImpact / totalAccountEquity) * 100 : 0)})</em>
            </div>
          </div>

          <div className="market-context-panel market-top-movers-panel">
            <div className="market-panel-head">
              <div>
                <h3>Top Movers</h3>
                <p>Fastest moving names inside the selected desk scope.</p>
              </div>
              <button type="button" onClick={() => onOpenWatchlist?.()}>Open watchlist</button>
            </div>
            <div className="market-mover-tabs">
              {["equities", "crypto", "options", "commodities", "macro"].map((tab) => (
                <button key={tab} type="button" className={marketDetailTab === tab ? "active" : ""} onClick={() => setMarketDetailTab(tab)} style={{ textTransform: "capitalize" }}>{tab}</button>
              ))}
            </div>
            <div className="market-movers-columns">
              <MarketMoverList title="Top Gainers" rows={marketDetailGainers} formatAssetPrice={formatAssetPrice} onSelectAsset={onSelectAsset} />
              <MarketMoverList title="Top Losers" rows={marketDetailLosers} formatAssetPrice={formatAssetPrice} onSelectAsset={onSelectAsset} />
            </div>
          </div>
        </section>

        <section className="market-context-bottom-grid">
          <div className="market-context-panel">
            <div className="market-panel-head">
              <div><h3>Market Signals</h3><p>Signals assembled from live movers, macro releases, calendar events, and options exposure.</p></div>
              <button type="button" onClick={() => onOpenAnalytics?.()}>Open analytics</button>
            </div>
            <div className="market-signal-list">
              {marketSignals.length ? marketSignals.map((signal) => (
                <div key={signal.title} className="market-signal-row">
                  <MarketAssetLogo symbol={signal.title} type={signal.type} />
                  <div><strong>{signal.title}</strong><span>{signal.text}</span></div>
                  <MarketTypeBadge type={signal.type} />
                  <span className={`market-signal-tone ${signal.tone}`}>{signal.tone}</span>
                  <em>{signal.source}</em>
                </div>
              )) : (
                <div className="market-empty-row">No live cross-market signals are available for this scope yet.</div>
              )}
            </div>
            <div className="market-powered-by">Signals update from the same feeds driving movers, macro context, and event coverage.</div>
          </div>

          <div className="market-context-panel">
            <div className="market-panel-head">
              <div><h3>Macro Context</h3><p>Country-level macro indicators from the live backend feed.</p></div>
              <button type="button" onClick={() => onOpenAnalytics?.()}>Open analytics</button>
            </div>
            <div className="market-macro-table">
              {macroContextRows.length ? macroContextRows.map((row) => (
                <div key={row.indicator} className="market-macro-row">
                  <span>{row.indicator}</span>
                  <strong>{row.value}</strong>
                  <em className={row.tone}>{row.change}</em>
                  <MiniSparkline values={row.series} color={row.color || (row.tone === "negative" ? "var(--color-danger)" : "var(--color-data-primary")} />
                </div>
              )) : (
                <div className="market-empty-row">Macro indicators are unavailable right now. Refresh once the backend feed is healthy.</div>
              )}
            </div>
            <p className="market-context-footnote">Change values reflect the backend&apos;s latest available previous-reading comparison.</p>
          </div>

          <div className="market-context-panel">
            <div className="market-panel-head">
              <div>
                <h3>Upcoming Events</h3>
                <p>Economic calendar first, then earnings events when macro calendar rows are sparse.</p>
              </div>
              <button type="button" onClick={() => onOpenAnalytics?.()}>Open calendar</button>
            </div>
            <div className="market-event-list">
              {upcomingEvents.length ? upcomingEvents.map((event) => (
                <div key={`${event.date}-${event.title}`} className="market-event-row">
                  <span className="market-event-date">{String(event.date).slice(0, 8)}</span>
                  <div><strong>{event.title}</strong><span>{event.time}</span></div>
                  <em className={`market-event-impact ${String(event.impact).toLowerCase().split(" ")[0]}`}>{event.impact}</em>
                </div>
              )) : (
                <div className="market-empty-row">No upcoming live events were returned by the backend feed.</div>
              )}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="view-container home-dashboard home-exec">
      {homeToast ? <div className="home-v3-toast" role="status">{homeToast}</div> : null}
      <header className="home-exec-page-header">
        <div className="home-exec-heading">
          <div className="home-exec-eyebrow">Portfolio</div>
          <h2>Portfolio Overview</h2>
          <p>Compact command deck for monitoring portfolio value, exposures, signals, and recent execution.</p>
          <div className="home-exec-header-meta" aria-label="Portfolio overview metadata">
            <span>{positionsCount} tracked positions</span>
            <span>{cashWeightPct.toFixed(1)}% cash weight</span>
            <span>{visibleAttentionCards.length} active signals</span>
          </div>
        </div>
        <div className="home-exec-command-bar">
          <div className="home-exec-sync-block home-exec-command-chip">
            <span>Sync State</span>
            <strong>{new Date(homeLastUpdatedAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</strong>
          </div>
          <div className="home-exec-header-actions">
            <button type="button" className="home-exec-btn secondary" onClick={() => setShowSavedItemsDrawer(true)}>
              Saved Items{savedItemsCount ? ` (${savedItemsCount})` : ""}
            </button>
            <button type="button" className="home-exec-btn secondary" onClick={() => handleRefreshDashboard("Dashboard refreshed.")}>Refresh</button>
            <button type="button" className="home-exec-btn primary" onClick={handleSaveHomeView}>Save View</button>
          </div>
        </div>
      </header>

      <div className="home-exec-stage">
        <section className="home-exec-top-grid">
        <section className="home-exec-hero-panel home-exec-command-deck">
          <div className="home-exec-command-head">
            <div>
              <div className="home-exec-label">Total Portfolio Value</div>
              <div className="home-exec-hero-value-row home-exec-command-value-row">
                <span className="home-exec-hero-value">{formatMoney(totalAccountEquity)}</span>
                <span className={`home-exec-hero-chip ${dailyChange >= 0 ? "positive" : "negative"}`}>
                  {dailyChange >= 0 ? "+" : ""}{dailyChangePct.toFixed(2)}%
                </span>
              </div>
              <div className="home-exec-command-subline">
                <span>Account equity live</span>
                <span>Total return {totalReturnPct >= 0 ? "+" : ""}{totalReturnPct.toFixed(2)}%</span>
                <span>{positionsCount} positions in scope</span>
              </div>
            </div>
            <div className="home-exec-timeframe-strip home-exec-command-strip">
              {heroIntervals.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={item === (chartInterval === "1D" ? "Today" : chartInterval) ? "active" : ""}
                  onClick={() => setChartInterval(item === "Today" ? "1D" : item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="home-exec-command-metrics">
              <div className="home-exec-hero-side-metric home-exec-command-metric">
                <span>Today&apos;s P&amp;L</span>
                <strong className={dailyChange >= 0 ? "positive" : "negative"}>
                  {formatSignedMoney(dailyChange)}
                </strong>
              </div>
              <div className="home-exec-hero-side-metric home-exec-command-metric">
                <span>Total G/L</span>
                <strong className={totalGainLoss >= 0 ? "positive" : "negative"}>
                  {formatSignedMoney(totalGainLoss)}
                </strong>
              </div>
              <div className="home-exec-hero-side-metric home-exec-command-metric">
                <span>Buying Power</span>
                <strong>{formatMoney(liveAvailableBalance)}</strong>
                <em>{buyingPowerPct.toFixed(1)}% of equity</em>
              </div>
              <div className="home-exec-hero-side-metric home-exec-command-metric range">
                <span>Day&apos;s Range</span>
                <div className="home-exec-range-row">
                  <strong>{`${formatCompactMoney(dayRange.low)} - ${formatCompactMoney(dayRange.high)}`}</strong>
                  <div className="home-exec-range-track" aria-hidden="true">
                    <span className="home-exec-range-fill" style={{ width: `${Math.max(14, rangeNeedlePct)}%` }} />
                    <span className="home-exec-range-needle" style={{ left: `${rangeNeedlePct}%` }} />
                  </div>
                </div>
                <em>Needle at {rangeNeedlePct.toFixed(0)}% of session range</em>
              </div>
          </div>
        </section>

        <aside className="home-exec-panel home-exec-monitor-panel">
          <div className="home-exec-section-head home-exec-monitor-head">
            <div className="home-exec-section-title-row">
              <h2>Risk Monitor</h2>
              <p>Exposure, optionality, and portfolio posture at a glance.</p>
            </div>
          </div>
          <div className="home-exec-monitor-stack">
            {executiveStatRows.map((row) => (
              <div key={row.label} className={`home-exec-monitor-row ${row.tone}`}>
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
            <div className={`home-exec-health-card ${healthTone}`}>
              <div>
                <span>Health</span>
                <strong>{healthState}</strong>
              </div>
              <em>{visibleAttentionCards.length ? `${visibleAttentionCards.length} active signals` : "No urgent issues"}</em>
            </div>
          </div>
        </aside>
      </section>

        <section className="home-exec-signal-tape">
        <div className="home-exec-section-head">
          <div className="home-exec-section-title-row">
            <h2>Signal Tape</h2>
            <p>Operational alerts compressed into a faster scan surface.</p>
          </div>
          <button type="button" className="home-exec-link" onClick={() => setShowSignalArchiveDrawer(true)}>Archive ({signalArchiveCount})</button>
        </div>
        <div className="home-exec-signal-list">
          {visibleAttentionCards.map((card) => (
            <article key={card.id} className={`home-exec-signal-row ${card.variant}`}>
              <div className="home-exec-signal-main">
                <div className="home-exec-signal-head">
                  <span className={`home-exec-severity ${card.variant}`}>{card.severity}</span>
                  <h3>{card.title}</h3>
                </div>
                <p>{card.text}</p>
                <div className="home-exec-signal-meta">{card.meta}</div>
              </div>
              <div className="home-exec-signal-actions">
                  <button
                    type="button"
                    className="home-exec-btn secondary small"
                    onClick={() => openAttentionFlow(card.type === "research-trigger" ? "research-trigger" : card.id, card)}
                  >
                    {card.cta}
                  </button>
                  <div className="home-exec-triage-tools">
                    <button type="button" onClick={() => { snoozeAttentionCard(card, 24); setHomeToast("Signal snoozed for 24 hours."); }}>Snooze</button>
                    <button type="button" onClick={() => setPendingDismissCard(card)}>Dismiss</button>
                  </div>
                </div>
              </article>
          ))}
          {visibleAttentionCards.length === 0 ? (
            <article className="home-exec-signal-row empty">
              <span className="home-v2-empty-icon">✓</span>
              <h3>All clear</h3>
              <p>No urgent portfolio issues are active right now.</p>
              <button type="button" className="home-exec-link" onClick={() => {
                setArchivedAttentionCards([]);
                setSnoozedAttentionCards([]);
              }}>Restore alerts</button>
            </article>
          ) : null}
        </div>
      </section>

        <section className="home-exec-main-grid">
        <div className="home-exec-primary-col">
          <section className="home-exec-panel home-exec-performance-panel">
            <div className="home-exec-section-head">
              <div className="home-exec-performance-head-left">
                <div className="home-exec-section-title-row">
                  <h2>Performance Curve</h2>
                  <p>Primary performance plane with benchmark context and drawdown stats.</p>
                </div>
                <div className="home-exec-toggle-row home-exec-toggle-row-compact">
                  {chartModeButtons.map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      className={`home-exec-toggle ${chartMode === mode ? "active" : ""}`}
                      onClick={() => setChartMode(mode)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="home-exec-performance-legend" aria-label="Chart legend">
                <span><i className="home-exec-dot portfolio" />Portfolio</span>
                <span><i className="home-exec-dot benchmark" />SP500_REF</span>
              </div>
            </div>
            <TradingViewChart
              options={performanceChartOptions}
              series={performanceChartSeries}
              priceLines={performancePriceLines}
              valueFormatter={(value) => yFormatter(Number(value))}
              timeFormatter={formatPerformanceTime}
              height={360}
              width="100%"
            />
            <div className="home-exec-performance-foot">
              <div className="home-exec-toggle-row home-exec-toggle-row-right">
                {displayIntervals.map((int) => (
                  <button
                    key={int}
                    type="button"
                    className={`home-exec-toggle ${chartInterval === int ? "active" : ""}`}
                    onClick={() => setChartInterval(int)}
                  >
                    {int}
                  </button>
                ))}
              </div>
            </div>
            <div className="home-exec-chart-stats">
              <div><span>Best Period</span><strong className={bestDay >= 0 ? "positive" : "negative"}>{formatSignedMoney(bestDay)}</strong></div>
              <div><span>Worst Period</span><strong className="negative">{formatSignedMoney(worstDay)}</strong></div>
              <div><span>Max DD</span><strong className="negative">{formatSignedMoney(maxDrawdown)}</strong></div>
              <div><span>Current DD</span><strong className={currentDrawdown >= 0 ? "positive" : "negative"}>{formatSignedMoney(currentDrawdown)}</strong></div>
            </div>
          </section>

          <section className="home-exec-panel home-exec-log-panel">
            <div className="home-exec-section-head">
              <div className="home-exec-section-title-row">
                <h2>Execution Log</h2>
                <p>Recent orders and fills, compressed into a terminal-style ledger.</p>
              </div>
              <button type="button" className="home-exec-link" onClick={openAllActivityDrawer}>CSV Export</button>
            </div>
            {recentActivityRows.length ? (
              <div className="home-exec-log-table-wrap">
                <DataTable
                  columns={[
                    { key: "timestampLabel", header: "Timestamp", sortable: false, cell: (row) => <span className="home-exec-log-stamp">{row.timestampLabel}</span> },
                    { key: "symbol", header: "Asset_Ticker", sortable: false, cell: (row) => <strong>{row.symbol}</strong> },
                    { key: "instruction", header: "Instruction", sortable: false, cell: (row) => <span className="home-exec-log-instruction">{row.instruction}</span> },
                    { key: "value", header: "Notional_Amt", sortable: false, cell: (row) => <span className="home-exec-log-notional">{row.value > 0 ? formatMoney(row.value) : "--"}</span> },
                    { key: "status", header: "Status", sortable: false, cell: (row) => <span className={`home-exec-status ${row.tone}`}>{row.status}</span> },
                  ]}
                  data={recentActivityRows}
                  getRowId={(row) => row.id}
                  onRowClick={(row) => setSelectedActivityDetail(row)}
                  className="home-exec-log-table"
                />
              </div>
            ) : (
              <HomeEmptyState title="No recent activity yet" description="Trades and portfolio updates will appear here." />
            )}
          </section>
        </div>

        <aside className="home-exec-secondary-col">
          <section className="home-exec-panel home-exec-market-context-card">
            <div className="home-exec-section-head">
              <div className="home-exec-section-title-row">
                <h2>Market Context</h2>
                <p>Live macro, breadth, and mover signals affecting today&apos;s book.</p>
              </div>
              <div className="home-exec-market-context-actions">
                <button type="button" className="home-exec-link" onClick={refreshMarketDetail}>Refresh</button>
                <button type="button" className="home-exec-btn secondary small" onClick={openMarketContextDetail}>Open Full Page</button>
              </div>
            </div>
            {marketContextAvailable ? (
              <div className="home-exec-market-preview">
                <div className="home-exec-market-preview-strip">
                  <div className="home-exec-market-preview-chip">
                    <span>Regime</span>
                    <strong className={riskOn ? "positive" : "negative"}>{riskOn ? "Risk-On" : "Risk-Off"}</strong>
                  </div>
                  <div className="home-exec-market-preview-chip">
                    <span>VIX</span>
                    <strong>{Number.isFinite(vixValue) ? vixValue.toFixed(2) : "—"}</strong>
                  </div>
                  <div className="home-exec-market-preview-chip">
                    <span>Breadth</span>
                    <strong>{Number.isFinite(marketBreadthPct) ? `${marketBreadthPct}%` : "—"}</strong>
                  </div>
                  <div className="home-exec-market-preview-chip">
                    <span>Next Event</span>
                    <strong>{nextMarketEvent?.title || "No event feed"}</strong>
                  </div>
                </div>
                <div className="home-exec-market-preview-grid">
                  <div className="home-exec-market-preview-block">
                    <div className="home-exec-market-preview-head">
                      <strong>Top Movers</strong>
                      <span>{moversHorizons[moversHorizon]?.label || "Daily"}</span>
                    </div>
                    <div className="home-exec-market-preview-list">
                      {marketContextPreviewRows.length ? marketContextPreviewRows.map((row) => {
                        const change = Number(row?.__moverChange || 0);
                        return (
                          <button
                            type="button"
                            key={`market-preview-${row.id || row.symbol}`}
                            className="home-exec-market-preview-row"
                            onClick={openMarketContextDetail}
                          >
                            <div className="home-exec-market-preview-symbol">
                              <MarketAssetLogo symbol={row.symbol} type={row.__marketTab || row.type} />
                              <div>
                                <strong>{row.symbol}</strong>
                                <span>{row.name || row.symbol}</span>
                              </div>
                            </div>
                            <em className={change >= 0 ? "positive" : "negative"}>
                              {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%
                            </em>
                          </button>
                        );
                      }) : (
                        <div className="market-empty-row">No live movers yet.</div>
                      )}
                    </div>
                  </div>

                  <div className="home-exec-market-preview-block">
                    <div className="home-exec-market-preview-head">
                      <strong>Macro Pulse</strong>
                      <span>{upcomingEvents.length} events tracked</span>
                    </div>
                    <div className="home-exec-market-preview-macro">
                      {marketSummaryCards.slice(0, 3).map((card) => (
                        <div key={`preview-${card.label}`} className="home-exec-market-preview-macro-row">
                          <span>{card.label}</span>
                          <strong>{card.value}</strong>
                        </div>
                      ))}
                      <div className="home-exec-market-preview-event">
                        <span>{nextMarketEvent?.impact || "Watch"}</span>
                        <strong>{nextMarketEvent?.title || "Macro feed updating"}</strong>
                        <em>{nextMarketEvent?.date ? `${nextMarketEvent.date} · ${nextMarketEvent.time || "Scheduled"}` : "Upcoming catalyst"}</em>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <HomeEmptyState
                title="Market context is warming up"
                description="Add holdings or watchlist assets to populate live movers and macro signals."
                cta="Open Market Context"
                onAction={openMarketContextDetail}
              />
            )}
          </section>

          <section className="home-exec-panel home-exec-holdings-panel">
            <div className="home-exec-section-head">
              <div className="home-exec-section-title-row">
                <h2>Key Positions</h2>
                <p>Largest exposures ranked by value, allocation, and concentration risk.</p>
              </div>
              <button
                type="button"
                className="home-exec-link"
                onClick={() => onViewAllPositions?.()}
              >
                Full Portfolio Detail
              </button>
            </div>
            <div className="home-exec-holdings-list">
              {topHoldingsRows.length ? (
                topHoldingsRows.map((asset) => {
                  const symbol = String(asset?.symbol || "").toUpperCase();
                  const change = Number(asset?.priceChangePercent || 0);
                  const concentrated = Number(asset.__allocationPercent || 0) >= 50;
                  return (
                    <button
                      type="button"
                      key={`home-hold-${asset.id || symbol}`}
                      className="home-exec-holding-row home-exec-holding-table-row"
                      onClick={() => setSelectedHoldingDetail(asset)}
                    >
                      <div className="home-exec-holding-top">
                        <strong>{symbol || "N/A"}</strong>
                        <span>{formatMoney(asset.__positionValue)}</span>
                      </div>
                      <div className="home-exec-holding-bar" aria-hidden="true">
                        <span style={{ width: `${Math.max(8, Math.min(100, Number(asset.__allocationPercent || 0)))}%` }} />
                      </div>
                      <div className="home-exec-holding-meta">
                        <span>{asset?.name || symbol || "Asset"}</span>
                        <span>
                          {asset.__allocationPercent.toFixed(1)}% allocation
                          {Number.isFinite(change) ? ` · ${change > 0 ? "+" : ""}${change.toFixed(1)}%` : ""}
                          {concentrated ? " · Concentrated" : ""}
                        </span>
                      </div>
                    </button>
                  );
                })
              ) : (
                <HomeEmptyState title="No holdings yet" description="Add your first position to start tracking allocation and performance." cta="Add Position" onAction={() => onViewAllPositions?.()} />
              )}
            </div>
          </section>

          <section className="home-exec-panel home-exec-allocation-panel">
            <div className="home-exec-section-head">
              <div className="home-exec-section-title-row">
                <h2>Capital Mix</h2>
                <p>Portfolio composition between deployed crypto exposure and liquid reserve.</p>
              </div>
              <button type="button" className="home-exec-link" onClick={() => onViewAllPositions?.()}>View Breakdown</button>
            </div>
            {allocationBreakdown.total > 0 ? (
              <>
                <div className="home-exec-allocation-chart">
                  <ReactApexChart
                    options={{
                      chart: { type: "donut", background: "transparent" },
                      labels: ["Crypto", "Cash"],
                      legend: { show: false },
                      stroke: { width: 2, colors: [chartColors.surface()] },
                      colors: [chartColors.info(), chartColors.success()],
                      dataLabels: { enabled: false },
                      tooltip: { y: { formatter: (val) => `${Number(val).toFixed(1)}%` } },
                      plotOptions: { pie: { donut: { size: "70%" } } }
                    }}
                    series={[
                      Number(allocationBreakdown.cryptoPercent.toFixed(2)),
                      Number(allocationBreakdown.cashPercent.toFixed(2))
                    ]}
                    type="donut"
                    height={184}
                  />
                  <div className="home-exec-donut-center"><span>Total</span><strong>{formatCompactMoney(allocationBreakdown.total)}</strong></div>
                </div>
                <div className="home-exec-allocation-legend">
                  <div className="home-exec-legend-row">
                    <div className="home-exec-legend-left">
                      <span className="dot crypto" />
                      <span>Crypto</span>
                    </div>
                    <strong>{allocationBreakdown.cryptoPercent.toFixed(0)}% / {formatMoney(allocationBreakdown.cryptoValue)}</strong>
                  </div>
                  <div className="home-exec-legend-row">
                    <div className="home-exec-legend-left">
                      <span className="dot cash" />
                      <span>Cash</span>
                    </div>
                    <strong>{allocationBreakdown.cashPercent.toFixed(0)}% / {formatMoney(allocationBreakdown.cashValue)}</strong>
                  </div>
                </div>
                {allocationBreakdown.cashPercent >= 80 ? <div className="home-exec-warning">Cash concentration is high.</div> : null}
              </>
            ) : (
              <HomeEmptyState title="No allocation data" description="Add holdings to see portfolio allocation." cta="Add Position" onAction={() => onViewAllPositions?.()} />
            )}
          </section>
        </aside>
        </section>
      </div>
      {renderAttentionFlow()}
      <HomeDetailDrawer
        title={selectedHoldingDetail ? String(selectedHoldingDetail.symbol || "Holding").toUpperCase() : ""}
        open={!!selectedHoldingDetail}
        onClose={() => setSelectedHoldingDetail(null)}
        rows={selectedHoldingDetail ? [
          ["Name", selectedHoldingDetail.name || selectedHoldingDetail.symbol || "Asset"],
          ["Quantity", Number(selectedHoldingDetail.quantity || 0).toLocaleString()],
          ["Price", formatMoney(selectedHoldingDetail.price || 0)],
          ["Value", formatMoney(selectedHoldingDetail.__positionValue || 0)],
          ["Allocation", `${Number(selectedHoldingDetail.__allocationPercent || 0).toFixed(1)}%`]
        ] : []}
      />
      <HomeDetailDrawer
        title={selectedActivityDetail?.title || ""}
        open={!!selectedActivityDetail}
        onClose={() => setSelectedActivityDetail(null)}
        rows={selectedActivityDetail ? [
          ["Action", selectedActivityDetail.action],
          ["Symbol", selectedActivityDetail.symbol],
          ["Time", selectedActivityDetail.when],
          ["Amount", formatMoney(selectedActivityDetail.value)],
          ["Status", selectedActivityDetail.status]
        ] : []}
      />
      <HomeDetailDrawer
        title="Recent Activity"
        open={showAllActivity}
        onClose={() => setShowAllActivity(false)}
        rows={showAllActivity ? recentActivityRows.map((row) => [
          row.when,
          `${row.action} ${row.symbol} · ${formatMoney(row.value)} · ${row.status}`
        ]) : []}
      />
      <HomeSavedItemsDrawer
        open={showSavedItemsDrawer}
        onClose={() => setShowSavedItemsDrawer(false)}
        savedViews={savedHomeViews}
        savedAlerts={savedHomeAlerts}
        savedTasks={savedHomeTasks}
        savedRebalances={savedHomeRebalances}
        onApplyView={applySavedHomeView}
        onReviewItem={reviewSavedHomeItem}
      />
      <HomeSignalArchiveDrawer
        open={showSignalArchiveDrawer}
        onClose={() => setShowSignalArchiveDrawer(false)}
        archivedItems={archivedAttentionCards}
        snoozedItems={snoozedAttentionCards}
        onRestore={(id) => {
          setArchivedAttentionCards((prev) => (Array.isArray(prev) ? prev.filter((entry) => entry?.id !== id) : []));
          setSnoozedAttentionCards((prev) => (Array.isArray(prev) ? prev.filter((entry) => entry?.id !== id) : []));
        }}
        onClear={(id) => {
          setArchivedAttentionCards((prev) => (Array.isArray(prev) ? prev.filter((entry) => entry?.id !== id) : []));
          setSnoozedAttentionCards((prev) => (Array.isArray(prev) ? prev.filter((entry) => entry?.id !== id) : []));
        }}
      />
      <HomeSignalDismissModal
        card={pendingDismissCard}
        onClose={() => setPendingDismissCard(null)}
        onConfirm={() => {
          if (!pendingDismissCard) return;
          archiveAttentionCard(pendingDismissCard, "dismissed");
          setPendingDismissCard(null);
          setHomeToast("Signal archived.");
        }}
      />
    </div>
  );
}

function HomeEmptyState({ title, description, cta, onAction }) {
  return (
    <div className="home-exec-empty">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {cta ? <button type="button" className="home-exec-btn secondary" onClick={onAction}>{cta}</button> : null}
    </div>
  );
}

function HomeDetailDrawer({ open, title, rows, onClose }) {
  if (!open) return null;
  return (
    <div className="home-v3-drawer-overlay" onMouseDown={onClose}>
      <aside className="home-v3-detail-drawer" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="home-v3-drawer-head">
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div className="home-v3-drawer-rows">
          {rows.map(([label, value]) => (
            <div key={label}><span>{label}</span><strong>{value}</strong></div>
          ))}
        </div>
      </aside>
    </div>
  );
}

function HomeSavedItemsDrawer({
  open,
  onClose,
  savedViews,
  savedAlerts,
  savedTasks,
  savedRebalances,
  onApplyView,
  onReviewItem
}) {
  if (!open) return null;

  const sections = [
    {
      title: "Saved Views",
      rows: savedViews,
      empty: "No saved Home views yet.",
      renderRow: (view) => (
        <SavedWorkspaceRow
          key={view.id}
          title={`${view.chartMode || "equity"} · ${view.chartInterval || "1D"}`}
          subtitle={`${view.moversHorizon || "daily"} movers · ${formatSavedTimestamp(view.createdAt)}`}
          actionLabel="Apply"
          onAction={() => onApplyView(view)}
        />
      )
    },
    {
      title: "Alerts",
      rows: savedAlerts,
      empty: "No saved alerts yet.",
      renderRow: (alert) => (
        <SavedWorkspaceRow
          key={alert.id}
          title={alert.symbol || "Saved alert"}
          subtitle={`${alert.message || "Alert saved"} · ${formatSavedTimestamp(alert.createdAt)}`}
          actionLabel="Open"
          onAction={() => onReviewItem("alert", alert)}
        />
      )
    },
    {
      title: "Workspace Tasks",
      rows: savedTasks,
      empty: "No saved follow-up tasks yet.",
      renderRow: (task) => (
        <SavedWorkspaceRow
          key={task.id}
          title={task.symbol ? `${task.symbol} · ${task.kind}` : task.kind || "Task"}
          subtitle={`${task.issue || task.context || "Saved from Action Center"} · ${formatSavedTimestamp(task.createdAt)}`}
          actionLabel="Open"
          onAction={() => onReviewItem("task", task)}
        />
      )
    },
    {
      title: "Queued Rebalances",
      rows: savedRebalances,
      empty: "No queued rebalances yet.",
      renderRow: (rebalance) => (
        <SavedWorkspaceRow
          key={rebalance.id}
          title={`Drift ${Number(rebalance.drift || 0).toFixed(1)}%`}
          subtitle={`${Array.isArray(rebalance.plan) ? rebalance.plan.length : 0} planned trades · ${formatSavedTimestamp(rebalance.createdAt)}`}
          actionLabel="Open"
          onAction={() => onReviewItem("rebalance", rebalance)}
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
        style={{ maxWidth: 720 }}
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

function HomeSignalArchiveDrawer({
  open,
  onClose,
  archivedItems,
  snoozedItems,
  onRestore,
  onClear
}) {
  if (!open) return null;

  const activeSnoozedItems = (Array.isArray(snoozedItems) ? snoozedItems : []).filter(
    (item) => new Date(item?.snoozeUntil || 0).getTime() > Date.now()
  );

  const sections = [
    {
      title: "Snoozed Signals",
      rows: activeSnoozedItems,
      empty: "No snoozed signals.",
      renderRow: (item) => (
        <SavedWorkspaceRow
          key={`snoozed-${item.id}`}
          title={item.title || item.id || "Snoozed signal"}
          subtitle={`Returns ${formatSavedTimestamp(item.snoozeUntil)} · ${item.severity || "Signal"}`}
          actionLabel="Restore"
          onAction={() => onRestore(item.id)}
        />
      )
    },
    {
      title: "Archived Signals",
      rows: Array.isArray(archivedItems) ? archivedItems : [],
      empty: "No archived signals.",
      renderRow: (item) => (
        <SavedWorkspaceRow
          key={`archived-${item.id}`}
          title={item.title || item.id || "Archived signal"}
          subtitle={`${item.reason || "dismissed"} · ${formatSavedTimestamp(item.archivedAt)}`}
          actionLabel="Restore"
          onAction={() => onRestore(item.id)}
          secondaryActionLabel="Remove"
          onSecondaryAction={() => onClear(item.id)}
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
        aria-label="Signal archive"
        style={{ maxWidth: 720 }}
      >
        <div className="home-v3-drawer-head">
          <h2>Signal Archive</h2>
          <button type="button" onClick={onClose} aria-label="Close drawer">×</button>
        </div>
        <div style={{ display: "grid", gap: 18 }}>
          {sections.map((section) => (
            <section key={section.title} style={{ display: "grid", gap: 10 }}>
              <div>
                <strong style={{ display: "block", marginBottom: 4 }}>{section.title}</strong>
                <span style={{ color: "var(--color-text-secondary)", fontSize: 12 }}>
                  {section.rows.length ? `${section.rows.length} item${section.rows.length === 1 ? "" : "s"}` : section.empty}
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

function HomeSignalDismissModal({ card, onClose, onConfirm }) {
  if (!card) return null;
  return (
    <div className="home-v3-drawer-overlay home-signal-modal-overlay" onMouseDown={onClose}>
      <div
        className="home-signal-modal"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Archive signal"
      >
        <div className="home-signal-modal-head">
          <span className={`home-exec-severity ${card.variant || "info"}`}>{card.severity || "Signal"}</span>
          <h2>Archive this signal?</h2>
        </div>
        <p>
          <strong>{card.title}</strong>
          {" "}
          will move into Signal Archive and stop appearing in the live tape until you restore it.
        </p>
        <div className="home-signal-modal-actions">
          <button type="button" className="home-exec-btn secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="home-exec-btn" onClick={onConfirm}>Archive signal</button>
        </div>
      </div>
    </div>
  );
}

function SavedWorkspaceRow({ title, subtitle, actionLabel, onAction, secondaryActionLabel, onSecondaryAction }) {
  return (
    <div className="saved-items-row">
      <div className="saved-items-row-copy">
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="saved-items-row-actions">
        {secondaryActionLabel ? (
          <button type="button" className="home-v3-btn secondary" onClick={onSecondaryAction}>
            {secondaryActionLabel}
          </button>
        ) : null}
        {actionLabel ? (
          <button type="button" className="home-v3-btn secondary" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function MiniSparkline({ values = [], color = "var(--color-data-primary)" }) {
  const series = Array.isArray(values) ? values.filter((value) => Number.isFinite(Number(value))).map(Number) : [];
  if (!series.length) {
    return <div className="market-sparkline-empty" aria-hidden="true" />;
  }
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = Math.max(1, max - min);
  const points = series.map((value, idx) => {
    const x = (idx / Math.max(1, series.length - 1)) * 100;
    const y = 32 - ((value - min) / range) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
  return (
    <svg className="market-sparkline" viewBox="0 0 100 36" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MarketSummaryCard({ label, value, change, tone, caption }) {
  return (
    <div className="market-summary-card">
      <span>{label}</span>
      <div className="market-summary-value">
        <strong>{value}</strong>
        {change && change !== "—" ? (
          <em className={tone}>{tone === "positive" ? "▲" : tone === "negative" ? "▼" : "•"} {change}</em>
        ) : null}
      </div>
      <p>{caption}</p>
    </div>
  );
}

function MarketRegimeGauge({ value = 70 }) {
  const clamped = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className="market-regime-gauge" style={{ "--gauge-value": `${clamped}%` }}>
      <span />
      <i />
    </div>
  );
}

function MarketAssetLogo({ symbol = "", type = "" }) {
  const label = String(symbol || type || "?").trim().slice(0, 2).toUpperCase();
  const tone = String(type || "").toLowerCase();
  return <span className={`market-asset-logo ${tone}`}>{label}</span>;
}

function MarketTypeBadge({ type = "Equity" }) {
  const normalized = String(type || "Equity").toLowerCase();
  return <span className={`market-type-badge ${normalized}`}>{type}</span>;
}

function MarketMoverList({ title, rows, formatAssetPrice, onSelectAsset }) {
  return (
    <div className="market-mover-list">
      <h4>{title}</h4>
      {rows.length ? rows.map((row) => {
        const change = Number(row.__moverChange || 0);
        const type = row.__marketTab || row.type || "Equity";
        return (
          <button key={`${title}-${row.id || row.symbol}`} type="button" className="market-mover-detail-row" onClick={() => onSelectAsset?.(row)}>
            <MarketAssetLogo symbol={row.symbol} type={type} />
            <div><strong>{row.symbol}</strong></div>
            <span>{formatAssetPrice(row)}</span>
            <em className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%</em>
          </button>
        );
      }) : <div className="market-empty-row">No movers for this filter.</div>}
    </div>
  );
}
