import { useEffect, useMemo, useRef, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { TradingViewChart } from "./TradingViewChart";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { calculateOptionPnL } from "../utils/optionsPnL";
import { ZENIN_API_BASE_URL } from "../utils/zeninFetch";
import { formatCurrency, getCurrencySymbol, convertToUSD } from "../utils/currencyUtils";

const BACKEND_URL = ZENIN_API_BASE_URL;

const MOVERS_HORIZONS = {
  daily: { label: "Daily", interval: "1D" },
  weekly: { label: "Weekly", interval: "1W" },
  quarterly: { label: "Quarterly", interval: "3M" },
  ytd: { label: "YTD", interval: "YTD" },
  yearly: { label: "Yearly", interval: "1Y" }
};

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
  onViewFullMetrics
}) {
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
  const [dismissedAttentionCards, setDismissedAttentionCards] = useState([]);
  const [snoozedAttentionCards, setSnoozedAttentionCards] = useState([]);
  const [flowSelection, setFlowSelection] = useState(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowActionLabel, setFlowActionLabel] = useState("");
  const [homeLastUpdatedAt, setHomeLastUpdatedAt] = useState(Date.now());
  const [homeToast, setHomeToast] = useState("");
  const [selectedHoldingDetail, setSelectedHoldingDetail] = useState(null);
  const [selectedActivityDetail, setSelectedActivityDetail] = useState(null);
  const [marketScope, setMarketScope] = useState("all");
  const [marketDetailOpen, setMarketDetailOpen] = useState(false);
  const [marketDetailTab, setMarketDetailTab] = useState("equities");
  const [marketRegion, setMarketRegion] = useState("global");
  const [marketSortBy, setMarketSortBy] = useState("marketCap");
  const [marketRefreshNonce, setMarketRefreshNonce] = useState(0);
  const [macroData, setMacroData] = useState([]);
  const [eventsData, setEventsData] = useState([]);
  const [marketDataLoading, setMarketDataLoading] = useState(false);
  const moversPerfCacheRef = useRef(new Map());
  const flowTimerRef = useRef(null);

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
    if (
      type === "crypto" ||
      type === "stablecoin" ||
      type === "exchange token" ||
      marketType === "spot"
    ) {
      return "crypto";
    }
    return "tradfi";
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

    let canceled = false;
    setMoversLoading(true);
    const nextByKey = {};
    let cursor = 0;
    const concurrency = Math.min(6, moversUniverse.length);

    const worker = async () => {
      while (!canceled && cursor < moversUniverse.length) {
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
          const res = await fetch(
            `${BACKEND_URL}/interval-performance?symbol=${encodeURIComponent(symbol)}&type=${encodeURIComponent(moverType)}`
          );
          if (!res.ok) continue;
          const data = await res.json();
          const perf = data?.performance && typeof data.performance === "object" ? data.performance : null;
          if (!perf) continue;
          moversPerfCacheRef.current.set(key, perf);
          nextByKey[key] = perf;
        } catch {
          // ignore per-symbol failures
        }
      }
    };

    Promise.all(Array.from({ length: concurrency }, () => worker()))
      .then(() => {
        if (canceled) return;
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
        if (!canceled) {
          setMoversLoading(false);
        }
      });

    return () => {
      canceled = true;
    };
  }, [moversUniverseKey, marketRefreshNonce]);

  const getMoverChange = (asset) => {
    const symbol = String(asset?.symbol || "").toUpperCase();
    const moverType = asset?.__moverType === "crypto" ? "crypto" : "tradfi";
    const key = `${symbol}:${moverType}`;
    const perf = moversPerformanceByKey[key];
    const intervalCode = MOVERS_HORIZONS[moversHorizon]?.interval || "1D";
    const value = Number(perf?.[intervalCode]);
    if (Number.isFinite(value)) return value;
    if (intervalCode === "1D") {
      const fallbackDaily = Number(asset?.priceChangePercent);
      return Number.isFinite(fallbackDaily) ? fallbackDaily : null;
    }
    return null;
  };

  const moversWithChange = moversUniverse
    .map((asset) => ({ ...asset, __moverChange: getMoverChange(asset) }))
    .filter((asset) => Number.isFinite(asset.__moverChange));

  const moversCoverage = useMemo(() => {
    const intervalCode = MOVERS_HORIZONS[moversHorizon]?.interval || "1D";
    return moversUniverse.reduce((summary, asset) => {
      const moverType = asset?.__moverType === "crypto" ? "crypto" : "tradfi";
      const key = `${String(asset?.symbol || "").toUpperCase()}:${moverType}`;
      const perf = moversPerformanceByKey[key];
      const exactValue = Number(perf?.[intervalCode]);
      const dailyFallback = Number(asset?.priceChangePercent);

      summary.total += 1;
      if (Number.isFinite(exactValue)) {
        summary.resolved += 1;
      } else if (intervalCode === "1D" && Number.isFinite(dailyFallback)) {
        summary.fallback += 1;
      } else {
        summary.unavailable += 1;
      }
      return summary;
    }, { total: 0, resolved: 0, fallback: 0, unavailable: 0 });
  }, [moversUniverse, moversPerformanceByKey, moversHorizon]);

  useEffect(() => {
    let cancelled = false;
    const hydrateTodayView = async () => {
      try {
        const [macroRes, earningsRes] = await Promise.all([
          fetch(`${BACKEND_URL}/macro-indicators?country=USA`),
          fetch(`${BACKEND_URL}/earnings-calendar`)
        ]);

        let macroPayload = null;
        let earningsPayload = null;
        if (macroRes.ok) macroPayload = await macroRes.json();
        if (earningsRes.ok) earningsPayload = await earningsRes.json();
        if (cancelled) return;

        const macroRows = Array.isArray(macroPayload?.indicators)
          ? macroPayload.indicators
          : Array.isArray(macroPayload?.data)
          ? macroPayload.data
          : [];
        const vixRow = macroRows.find((row) => String(row?.name || row?.indicator || "").toLowerCase().includes("vix"));
        const rateRow = macroRows.find((row) => String(row?.name || row?.indicator || "").toLowerCase().includes("interest"));
        const breadthRow = macroRows.find((row) => String(row?.name || row?.indicator || "").toLowerCase().includes("advance"));
        const vixValue = Number(vixRow?.value);
        const sentiment = Number.isFinite(vixValue)
          ? vixValue > 25 ? "Risk Off" : vixValue < 15 ? "Risk On" : "Balanced"
          : "Neutral";

        const earningsRows = Array.isArray(earningsPayload?.events)
          ? earningsPayload.events
          : Array.isArray(earningsPayload?.rows)
          ? earningsPayload.rows
          : Array.isArray(earningsPayload)
          ? earningsPayload
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
      } catch {
        if (!cancelled) {
          setTodayView((prev) => ({
            ...prev,
            headlines: ["Macro and earnings feeds unavailable, showing portfolio-native signals."]
          }));
          setEventRows([]);
        }
      }
    };
    hydrateTodayView();
    return () => {
      cancelled = true;
    };
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
        text: `${row.symbol} moved ${Number(row.__moverChange).toFixed(2)}% (${MOVERS_HORIZONS[moversHorizon]?.label || "selected horizon"})`
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
    { id: "rebalance", label: "Rebalance", action: () => setQuickActionFeedback("Rebalance flow queued. Open Portfolio to apply target weights.") },
    { id: "alert", label: "Set Alert", action: () => setQuickActionFeedback("Alert draft created from top mover context.") },
    { id: "journal", label: "Journal Note", action: () => setQuickActionFeedback("Journal shortcut ready in the Journal page.") }
  ];

  useEffect(() => {
    if (!marketDetailOpen) return;
    
    const fetchData = async () => {
      setMarketDataLoading(true);
      
      try {
        const [macroRes, eventsRes] = await Promise.all([
          fetch(`${BACKEND_URL}/macro-indicators?country=USA`),
          fetch(`${BACKEND_URL}/economic-calendar`)
        ]);
        
        if (macroRes.ok) {
          const data = await macroRes.json();
          if (data.metrics) setMacroData(data.metrics);
        }
        
        if (eventsRes.ok) {
          const data = await eventsRes.json();
          if (data.events) setEventsData(data.events);
        }
      } catch (err) {
        console.error("Market Context: Fetch failed", err);
      } finally {
        setMarketDataLoading(false);
      }
    };
    
    fetchData();
  }, [marketDetailOpen, marketRefreshNonce]);

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
    if (!activeAttentionFlow && !selectedHoldingDetail && !selectedActivityDetail && !marketDetailOpen) return;
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        setActiveAttentionFlow(null);
        setSelectedHoldingDetail(null);
        setSelectedActivityDetail(null);
        setMarketDetailOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeAttentionFlow, selectedHoldingDetail, selectedActivityDetail, marketDetailOpen]);

  const relativeAgeLabel = (raw, fallbackDays = 2) => {
    const ts = new Date(raw || 0).getTime();
    if (!Number.isFinite(ts) || ts <= 0) return `${fallbackDays} days ago`;
    const diffDays = Math.max(1, Math.round((Date.now() - ts) / (24 * 60 * 60 * 1000)));
    return `${diffDays} days ago`;
  };

  const missingFlowRows = useMemo(() => {
    const intervalCode = MOVERS_HORIZONS[moversHorizon]?.interval || "1D";
    const rows = (Array.isArray(moversUniverse) ? moversUniverse : []).reduce((acc, asset, idx) => {
      const symbol = String(asset?.symbol || "").toUpperCase();
      const moverType = asset?.__moverType === "crypto" ? "crypto" : "tradfi";
      const key = `${symbol}:${moverType}`;
      const perf = moversPerformanceByKey[key];
      const exactValue = Number(perf?.[intervalCode]);
      const dailyFallback = Number(asset?.priceChangePercent);
      const unavailable = !(Number.isFinite(exactValue) || (intervalCode === "1D" && Number.isFinite(dailyFallback)));
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

    if (rows.length > 0) return rows.slice(0, 6);

    const fallback = (Array.isArray(portfolio) ? portfolio : []).slice(0, 4).map((item, idx) => ({
      symbol: String(item?.symbol || "ASSET").toUpperCase(),
      name: item?.name || item?.symbol || "Asset",
      type: String(item?.type || "Stock"),
      issue: idx % 2 === 0 ? "Price data missing" : "Reference data missing",
      updatedAt: relativeAgeLabel(item?.updatedAt || item?.date_added, idx + 2)
    }));
    return fallback;
  }, [moversHorizon, moversUniverse, moversPerformanceByKey, portfolio]);

  const volatilityFlowRows = useMemo(() => {
    const rows = [...(Array.isArray(moversWithChange) ? moversWithChange : [])]
      .sort((a, b) => Math.abs(Number(b.__moverChange || 0)) - Math.abs(Number(a.__moverChange || 0)))
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

    if (rows.length > 0) return rows;

    return (Array.isArray(alerts) ? alerts : []).slice(0, 4).map((row, idx) => ({
      symbol: row?.id?.split("-")?.[1]?.toUpperCase?.() || `SYM${idx + 1}`,
      asset: row?.text || "Volatility signal",
      volatility24h: 62 - idx * 8,
      change: idx % 2 === 0 ? -3.4 : 2.6,
      riskLabel: "Watch"
    }));
  }, [moversWithChange, alerts]);

  const openAttentionFlow = (flowKind) => {
    if (!flowKind) return;
    setActiveAttentionFlow(flowKind);
    setAttentionFlowStep(1);
    setFlowBusy(false);
    setFlowActionLabel("");
    if (flowKind === "missing") {
      setFlowSelection(missingFlowRows[0] || null);
    } else if (flowKind === "rebalance") {
      setFlowSelection(rebalancePlanRows.rows[0] || null);
    } else {
      setFlowSelection(volatilityFlowRows[0] || null);
    }
  };

  const closeAttentionFlow = () => {
    setActiveAttentionFlow(null);
    setFlowBusy(false);
    setFlowActionLabel("");
  };

  const runFlowProcessing = (nextStep, actionLabel, processingStep = 3, delayMs = 1300) => {
    setFlowActionLabel(actionLabel || "");
    setFlowBusy(true);
    setAttentionFlowStep(processingStep);
    if (flowTimerRef.current) clearTimeout(flowTimerRef.current);
    flowTimerRef.current = setTimeout(() => {
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
    const currency = asset?.currency || asset?.quotedCurrency || "USD";
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
    ? (isProfitable ? "#22c55e" : "#ef4444")
    : "#38bdf8";

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
    if (type.includes("crypto") || ["BTC", "ETH", "SOL", "HYPE"].includes(symbol)) return "macro";
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
        type: classifyMarketAsset(asset) === "commodities" ? "Commodity" : classifyMarketAsset(asset) === "macro" ? "Macro" : "Equity",
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

  const marketSignals = useMemo(() => {
    const strongestGainer = marketDetailGainers[0] || gainers[0];
    const strongestLoser = marketDetailLosers[0] || losers[0];
    const rows = [
      strongestGainer ? {
        title: `${strongestGainer.symbol} Momentum`,
        text: `${strongestGainer.name || strongestGainer.symbol} is leading selected-market strength.`,
        type: classifyMarketAsset(strongestGainer),
        tone: "bullish",
        age: "1h ago"
      } : null,
      activeOptionsTrades.length ? {
        title: "Options Flow Spike",
        text: `${activeOptionsTrades.length} active options positions are contributing to portfolio sensitivity.`,
        type: "options",
        tone: "bullish",
        age: "2h ago"
      } : null,
      strongestLoser ? {
        title: `${strongestLoser.symbol} Pressure Watch`,
        text: `${strongestLoser.name || strongestLoser.symbol} is the weakest selected-market signal.`,
        type: classifyMarketAsset(strongestLoser),
        tone: "bearish",
        age: "2h ago"
      } : null,
      {
        title: "Gold Strength as Defensive Rotation",
        text: "Gold remains a useful cross-asset risk appetite check.",
        type: "commodities",
        tone: "bullish",
        age: "3h ago"
      },
      {
        title: "Crude Oil Breakout Watch",
        text: "Energy prices can affect inflation expectations and rate-sensitive assets.",
        type: "commodities",
        tone: "watch",
        age: "4h ago"
      }
    ];
    return rows.filter(Boolean).slice(0, 5);
  }, [activeOptionsTrades.length, gainers, losers, marketDetailGainers, marketDetailLosers]);

  const macroContextRows = useMemo(() => {
    if (macroData.length > 0) {
      return macroData.map(m => ({
        indicator: m.label,
        value: m.unit === "%" ? `${m.current?.toFixed(2)}%` : m.current?.toFixed(2),
        change: m.changePercent ? `${m.changePercent > 0 ? "+" : ""}${m.changePercent.toFixed(2)}%` : "—",
        tone: m.changePercent > 0 ? "positive" : m.changePercent < 0 ? "negative" : "neutral",
        series: m.series?.map(s => s.value) || []
      })).slice(0, 6);
    }

    const vix = Number.isFinite(Number(todayView.vix)) ? Number(todayView.vix) : 13.85;
    const rates = Number.isFinite(Number(todayView.rates)) ? Number(todayView.rates) : 5.5;
    const gold = moversUniverse.find((asset) => ["GLD", "GC"].includes(String(asset?.symbol || "").toUpperCase()) || String(asset?.name || "").toLowerCase().includes("gold"));
    const crude = moversUniverse.find((asset) => ["CL", "WTI", "USO"].includes(String(asset?.symbol || "").toUpperCase()) || String(asset?.name || "").toLowerCase().includes("crude"));
    return [
      { indicator: "US CPI (YoY)", value: "3.36%", change: "-0.10pp", tone: "negative", series: [62, 60, 61, 59, 60, 58, 59] },
      { indicator: "Fed Funds Rate", value: `${rates.toFixed(2)}%`, change: "—", tone: "neutral", series: [50, 50, 50, 50, 50, 50, 50] },
      { indicator: "US 10Y Yield", value: "4.31%", change: "+4.2 bps", tone: "positive", series: [42, 44, 47, 52, 50, 53, 55] },
      { indicator: "VIX Index", value: vix.toFixed(2), change: "-5.3%", tone: "positive", series: [58, 52, 50, 46, 48, 44, 42] },
      { indicator: "Gold (Spot)", value: formatMoney(Number(gold?.price || 2386.4)), change: "+0.72%", tone: "positive", series: [40, 42, 45, 43, 48, 51, 53], color: "#f59e0b" },
      { indicator: "WTI Crude", value: formatMoney(Number(crude?.price || 77.02)), change: "-1.90%", tone: "negative", series: [55, 54, 49, 47, 42, 40, 38], color: "#ef4444" }
    ];
  }, [macroData, formatMoney, moversUniverse, todayView.rates, todayView.vix]);

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

    const source = Array.isArray(eventRows) && eventRows.length ? eventRows : [
      { date: "May 14", title: "CPI (YoY)", time: "8:30 AM ET", impact: "High Impact" },
      { date: "May 15", title: "Retail Sales (MoM)", time: "8:30 AM ET", impact: "Medium Impact" },
      { date: "May 15", title: "FOMC Meeting Minutes", time: "2:00 PM ET", impact: "High Impact" },
      { date: "May 17", title: "Building Permits (MoM)", time: "8:30 AM ET", impact: "Low Impact" },
      { date: "May 17", title: "U. of Michigan Sentiment", time: "10:00 AM ET", impact: "Medium Impact" }
    ];
    return source.slice(0, 5).map((event, idx) => ({
      date: event?.date || event?.reportDate || event?.start || `May ${14 + idx}`,
      title: event?.title || event?.event || event?.symbol || "Market event",
      time: event?.time || event?.period || "8:30 AM ET",
      impact: event?.impact || (idx % 3 === 0 ? "High Impact" : idx % 3 === 1 ? "Medium Impact" : "Low Impact")
    }));
  }, [eventRows]);

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
      const symbol = String(trade?.asset || trade?.symbol || "Asset").toUpperCase();
      const notional = Number(trade?.notional || (Number(trade?.price || 0) * Number(trade?.quantity || 0)));
      return {
        id: trade.id || `${symbol}-${trade.__ts}`,
        title: `${side} ${symbol}`,
        action: side.toUpperCase(),
        symbol,
        when,
        value: Number.isFinite(notional) ? notional : 0,
        status: trade?.status || "Filled",
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
  const chartModeButtons = [["equity", "Equity Curve"], ["percentage", "% Gain"], ["pnl", "Cash PnL"]];
  const DISPLAY_INTERVALS = ["1D", "1W", "1M", "3M", "1Y", "ALL"];
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

  const attentionCards = [
    {
      id: "missing",
      variant: "warn",
      severity: "WARNING",
      title: `${moversCoverage.unavailable || 250} assets missing data`,
      text: "Update pricing and reference data to improve tracking accuracy.",
      cta: "Fix Data",
      meta: `Affected assets: ${moversCoverage.unavailable || 250} · Last checked: just now · Impact: Medium`
    },
    {
      id: "rebalance",
      variant: "info",
      severity: "INFO",
      title: "Rebalancing suggested",
      text: `Your allocation is ${Math.abs(allocationBreakdown.cryptoPercent - 50).toFixed(1)}% away from target.`,
      cta: "View Plan",
      meta: `Affected assets: ${Math.max(1, topHoldingsRows.length)} · Last checked: just now · Impact: Medium`
    },
    {
      id: "volatility",
      variant: "risk",
      severity: "CRITICAL",
      title: "High volatility alert",
      text: `${moversCoverage.unavailable || 250} symbols have missing interval data or unusual movement.`,
      cta: "Review Alerts",
      meta: `Affected assets: ${volatilityFlowRows.length || 250} · Last checked: just now · Impact: High`
    }
  ];
  const visibleAttentionCards = attentionCards.filter(
    (card) => !dismissedAttentionCards.includes(card.id) && !snoozedAttentionCards.includes(card.id)
  );

  const attentionFlowSteps = {
    missing: ["Missing Data List", "Asset Detail", "Updating", "Success"],
    rebalance: ["Overview", "Plan", "Confirm", "Success"],
    volatility: ["Volatility List", "Detail", "Insights", "Complete"]
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
              <button type="button" className="home-v2-flow-btn primary warn" onClick={() => runFlowProcessing(4, `Updating ${selectedSymbol || "asset"} data source...`)}>Update Source</button>
              <button type="button" className="home-v2-flow-btn" onClick={() => runFlowProcessing(4, `Applying manual update for ${selectedSymbol || "asset"}...`)}>Update Manually</button>
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
          <div className="home-v2-flow-status-card success">
            <div className="home-v2-flow-success-mark">✓</div>
            <h3>Data updated</h3>
            <p>{selectedSymbol || "Asset"} data is now up to date.</p>
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
              <button type="button" className="home-v2-flow-btn primary" onClick={() => setAttentionFlowStep(3)}>Apply Plan</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={() => setQuickActionFeedback("Plan editor opened in preview mode.")}>Edit Plan</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 3 && !flowBusy) {
        flowBody = (
          <div className="home-v2-flow-card">
            <div className="home-v2-flow-headline"><h3>Confirm Rebalance</h3><span>{buyCount} Buys, {sellCount} Sell</span></div>
            <p>You are about to place the following trades.</p>
            <div className="home-v2-flow-summary">This will reduce drift from <strong>{rebalanceDriftPct.toFixed(1)}%</strong> to <strong>{Math.max(0, rebalanceDriftPct * 0.08).toFixed(1)}%</strong>.</div>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={() => runFlowProcessing(4, "Submitting rebalance orders...", 3)}>Confirm</button>
              <button type="button" className="home-v2-flow-btn ghost" onClick={() => setAttentionFlowStep(2)}>Cancel</button>
            </div>
          </div>
        );
      } else if (attentionFlowStep === 3 && flowBusy) {
        flowBody = (
          <div className="home-v2-flow-status-card">
            <div className="home-v2-flow-spinner" />
            <h3>Submitting rebalance...</h3>
            <p>{flowActionLabel || "Placing orders now."}</p>
          </div>
        );
      } else {
        flowBody = (
          <div className="home-v2-flow-status-card success">
            <div className="home-v2-flow-success-mark">✓</div>
            <h3>Rebalance Submitted</h3>
            <p>Your trades have been submitted successfully.</p>
            <div className="home-v2-flow-actions">
              <button type="button" className="home-v2-flow-btn primary" onClick={() => { onViewAllPositions?.(); closeAttentionFlow(); }}>View Portfolio</button>
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
            <button type="button" className="home-v2-flow-btn" onClick={() => setAttentionFlowStep(4)}>Review Position</button>
            <button type="button" className="home-v2-flow-btn" onClick={() => setAttentionFlowStep(4)}>Set Alert</button>
            <button type="button" className="home-v2-flow-btn" onClick={() => setAttentionFlowStep(4)}>Hedge Position</button>
          </div>
        </div>
      );
    } else {
      flowBody = (
        <div className="home-v2-flow-status-card success">
          <div className="home-v2-flow-success-mark">✓</div>
          <h3>Alert Reviewed</h3>
          <p>We&apos;ll continue monitoring this symbol for you.</p>
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
            <h2>{activeAttentionFlow === "missing" ? "Missing Data Flow" : activeAttentionFlow === "rebalance" ? "Rebalancing Flow" : "Volatility Alert Flow"}</h2>
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
    : 68;
  const putCallRatio = activeOptionsTrades.length
    ? Math.max(0.35, Math.min(1.85, 0.72 + activeOptionsTrades.length * 0.05))
    : 0.82;
  const goldAsset = moversUniverse.find((asset) => ["GLD", "GC"].includes(String(asset?.symbol || "").toUpperCase()) || String(asset?.name || "").toLowerCase().includes("gold"));
  const vixValue = Number.isFinite(Number(todayView.vix)) ? Number(todayView.vix) : 13.85;
  const riskOn = vixValue < 20 && marketBreadthPct >= 50;
  const marketSummaryCards = [
    { label: "Equities Breadth (S&P 500)", value: `${marketBreadthPct}%`, change: "+1.21%", tone: "positive", caption: "Advancing > Declining", color: "#22c55e", seed: marketBreadthPct },
    { label: "Options Put/Call Ratio", value: putCallRatio.toFixed(2), change: "-6.3%", tone: "positive", caption: "7D Avg: 0.88", color: "#3b82f6", seed: putCallRatio * 100 },
    { label: "US 10Y Yield", value: "4.31%", change: "+4.2 bps", tone: "negative", caption: "1D Change", color: "#ef4444", seed: 431 },
    { label: "Gold (Spot)", value: formatMoney(Number(goldAsset?.price || 2386.4)), change: "+0.72%", tone: "positive", caption: "Prior / 1D Change", color: "#f59e0b", seed: Number(goldAsset?.price || 2386.4) },
    { label: "Volatility Index (VIX)", value: vixValue.toFixed(2), change: "-5.3%", tone: "positive", caption: "1D Change", color: "#a855f7", seed: vixValue * 10 }
  ];

  const refreshMarketDetail = () => {
    moversPerfCacheRef.current.clear();
    setMoversPerformanceByKey({});
    setHomeLastUpdatedAt(Date.now());
    setMarketRefreshNonce((value) => value + 1);
    setHomeToast("Market context refreshed.");
  };

  if (marketDetailOpen) {
    const totalPortfolioImpact = portfolioImpactRows.reduce((sum, row) => sum + Number(row.impact || 0), 0);
    return (
      <div className="view-container market-context-page">
        {homeToast ? <div className="home-v3-toast" role="status">{homeToast}</div> : null}
        <header className="market-context-detail-header">
          <div>
            <button type="button" className="market-context-back" onClick={() => setMarketDetailOpen(false)}>Back to Overview</button>
            <h2>Market Context</h2>
            <p>Daily movers and broader signals affecting your portfolio.</p>
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
              <em>Updated just now</em>
            </button>
          </div>
        </header>

        <section className="market-context-panel market-summary-panel">
          <div className="market-panel-head">
            <h3>Market Summary</h3>
          </div>
          <div className="market-summary-grid">
            {marketSummaryCards.map((card) => (
              <MarketSummaryCard key={card.label} {...card} />
            ))}
            <div className="market-summary-card market-regime-card">
              <span>Market Regime</span>
              <div className={riskOn ? "market-regime-value positive" : "market-regime-value negative"}>{riskOn ? "Risk-On" : "Risk-Off"}</div>
              <p>{riskOn ? "Improving risk appetite" : "Defensive risk appetite"}</p>
              <MarketRegimeGauge value={riskOn ? 74 : 38} />
            </div>
          </div>
        </section>

        <section className="market-context-main-grid">
          <div className="market-context-panel market-impact-panel">
            <div className="market-panel-head">
              <h3>Portfolio Impact</h3>
              <button type="button">View full</button>
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
              <h3>Top Movers</h3>
              <button type="button">View all</button>
            </div>
            <div className="market-mover-tabs">
              {["equities", "options", "commodities", "macro"].map((tab) => (
                <button key={tab} type="button" className={marketDetailTab === tab ? "active" : ""} onClick={() => setMarketDetailTab(tab)}>{tab}</button>
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
              <div><h3>Market Signals</h3><p>AI-curated insights across markets</p></div>
              <button type="button">View all signals</button>
            </div>
            <div className="market-signal-list">
              {marketSignals.map((signal) => (
                <div key={signal.title} className="market-signal-row">
                  <MarketAssetLogo symbol={signal.title} type={signal.type} />
                  <div><strong>{signal.title}</strong><span>{signal.text}</span></div>
                  <MarketTypeBadge type={signal.type} />
                  <span className={`market-signal-tone ${signal.tone}`}>{signal.tone}</span>
                  <em>{signal.age}</em>
                </div>
              ))}
            </div>
            <div className="market-powered-by">Signals powered by <strong>Zenin AI</strong></div>
          </div>

          <div className="market-context-panel">
            <div className="market-panel-head">
              <div><h3>Macro Context</h3><p>Key macroeconomic indicators</p></div>
              <button type="button">View full calendar</button>
            </div>
            <div className="market-macro-table">
              {macroContextRows.map((row) => (
                <div key={row.indicator} className="market-macro-row">
                  <span>{row.indicator}</span>
                  <strong>{row.value}</strong>
                  <em className={row.tone}>{row.change}</em>
                  <MiniSparkline values={row.series} color={row.color || (row.tone === "negative" ? "#ef4444" : "#3b82f6")} />
                </div>
              ))}
            </div>
            <p className="market-context-footnote">Change values represent 1D change.</p>
          </div>

          <div className="market-context-panel">
            <div className="market-panel-head">
              <h3>Upcoming Events</h3>
              <button type="button">View economic calendar</button>
            </div>
            <div className="market-event-list">
              {upcomingEvents.map((event) => (
                <div key={`${event.date}-${event.title}`} className="market-event-row">
                  <span className="market-event-date">{String(event.date).slice(0, 8)}</span>
                  <div><strong>{event.title}</strong><span>{event.time}</span></div>
                  <em className={`market-event-impact ${String(event.impact).toLowerCase().split(" ")[0]}`}>{event.impact}</em>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="view-container home-dashboard home-v2">
      {homeToast ? <div className="home-v3-toast" role="status">{homeToast}</div> : null}
      <header className="home-v3-page-header">
        <div>
          <div className="home-v3-eyebrow">Portfolio</div>
          <h2>Portfolio Overview</h2>
          <p>Monitor portfolio value, risk alerts, allocation, holdings, and market context.</p>
        </div>
        <div className="home-v3-header-actions">
          <span>Last updated {new Date(homeLastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          <button type="button" className="home-v3-btn secondary" onClick={() => { setHomeLastUpdatedAt(Date.now()); setHomeToast("Dashboard refreshed."); }}>Refresh</button>
          <button type="button" className="home-v3-btn primary" onClick={() => setHomeToast("View saved.")}>Save View</button>
        </div>
      </header>

      <section className="home-v2-hero home-v3-hero glass">
        <div className="home-v2-hero-left">
          <div className="home-v3-hero-topline">
            <div className="home-v2-label">Total Portfolio Value</div>
            <div className="home-v3-timeframe">
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
          <div className="home-v2-hero-main">
            <span className="home-v2-hero-value">{formatMoney(totalAccountEquity)}</span>
            <div className="home-v2-hero-pnl-row">
              <span className="home-v2-subtle">Today's P&amp;L</span>
              <span className={`home-v2-hero-change ${dailyChange >= 0 ? "positive" : "negative"}`}>
                {formatSignedMoney(dailyChange)} ({formatSignedPercent(dailyChangePct)})
              </span>
            </div>
          </div>
        </div>
        <div className="home-v2-hero-stats">
          <div className="home-v2-hero-stat">
            <span>Buying Power</span>
            <strong>{formatMoney(liveAvailableBalance)}</strong>
          </div>
          <div className="home-v2-hero-stat">
            <span>Total Gain/Loss</span>
            <strong className={totalGainLoss >= 0 ? "positive" : "negative"}>{formatSignedMoney(totalGainLoss)}</strong>
          </div>
          <div className="home-v2-hero-stat">
            <span>Day's Range</span>
            <strong>{`${formatCompactMoney(dayRange.low)} - ${formatCompactMoney(dayRange.high)}`}</strong>
          </div>
        </div>
      </section>

      <section className="home-v2-attention">
        <div className="section-header">
          <div>
            <h2>Action Center</h2>
            <p className="home-v2-section-kicker">Fix issues that affect portfolio accuracy, risk, and performance.</p>
          </div>
          <button type="button" className="home-v2-link-btn" onClick={() => openAttentionFlow("missing")}>View All</button>
        </div>
        <div className="home-v2-attention-grid">
          {visibleAttentionCards.map((card) => (
            <article key={card.id} className={`home-v2-attention-card ${card.variant}`}>
              <div className="home-v2-attention-topline">
                <span className={`home-v2-severity-badge ${card.variant}`}>{card.severity}</span>
                <div className="home-v2-attention-tools">
                  <button type="button" onClick={() => { setSnoozedAttentionCards((prev) => [...new Set([...prev, card.id])]); setHomeToast("Snoozed for 1 day."); }}>Snooze</button>
                  <button type="button" onClick={() => { if (window.confirm("Dismiss this portfolio issue?")) setDismissedAttentionCards((prev) => [...new Set([...prev, card.id])]); }}>Dismiss</button>
                </div>
              </div>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
              <button type="button" className="home-v3-btn secondary" onClick={() => openAttentionFlow(card.id)}>{card.cta}</button>
              <div className="home-v3-attention-meta">{card.meta}</div>
            </article>
          ))}
          {visibleAttentionCards.length === 0 ? (
            <article className="home-v2-attention-card empty">
              <span className="home-v2-empty-icon">✓</span>
              <h3>All clear</h3>
              <p>No urgent portfolio issues are active right now.</p>
              <button type="button" className="home-v2-link-btn" onClick={() => {
                setDismissedAttentionCards([]);
                setSnoozedAttentionCards([]);
              }}>Restore alerts</button>
            </article>
          ) : null}
        </div>
      </section>

      <section className="home-v2-main-grid">
        <div className="home-v2-left-col">
          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header">
              <div>
                <h2>Portfolio Performance</h2>
                <p className="home-v2-section-kicker">Equity curve, gain/loss, and cash-adjusted performance</p>
              </div>
              <div className="home-v2-toggle-row">
                {chartModeButtons.map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    className={`home-v2-pill ${chartMode === mode ? "active" : ""}`}
                    onClick={() => setChartMode(mode)}
                  >
                    {label}
                  </button>
                ))}
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
            <div className="home-v2-toggle-row home-v2-toggle-row-right">
              {DISPLAY_INTERVALS.map((int) => (
                <button
                  key={int}
                  type="button"
                  className={`home-v2-pill ${chartInterval === int ? "active" : ""}`}
                  onClick={() => setChartInterval(int)}
                >
                  {int}
                </button>
              ))}
            </div>
            <div className="home-v3-chart-insights">
              <div><span>Best day</span><strong className={bestDay >= 0 ? "positive" : "negative"}>{formatSignedMoney(bestDay)}</strong></div>
              <div><span>Worst day</span><strong className="negative">{formatSignedMoney(worstDay)}</strong></div>
              <div><span>Max drawdown</span><strong className="negative">{formatSignedMoney(maxDrawdown)}</strong></div>
              <div><span>Current drawdown</span><strong className={currentDrawdown >= 0 ? "positive" : "negative"}>{formatSignedMoney(currentDrawdown)}</strong></div>
            </div>
          </div>

          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header">
              <h2>Top Holdings</h2>
              <button
                type="button"
                className="home-v2-link-btn"
                onClick={() => onViewAllPositions?.()}
              >
                View All Positions
              </button>
            </div>
            <div className="home-v2-holdings-list">
              {topHoldingsRows.length ? (
                topHoldingsRows.map((asset) => {
                  const symbol = String(asset?.symbol || "").toUpperCase();
                  const change = Number(asset?.priceChangePercent || 0);
                  const changeClass = change > 0 ? "positive" : change < 0 ? "negative" : "neutral";
                  const concentrated = Number(asset.__allocationPercent || 0) >= 50;
                  return (
                    <button
                      type="button"
                      key={`home-hold-${asset.id || symbol}`}
                      className="home-v2-holding-row"
                      onClick={() => setSelectedHoldingDetail(asset)}
                    >
                      <div className="home-v2-holding-id">
                        <div className="home-v2-avatar">{symbol.slice(0, 1) || "?"}</div>
                        <div>
                          <div className="home-v2-holding-symbol">{symbol || "N/A"}</div>
                          <div className="home-v2-holding-name">{asset?.name || symbol || "Asset"}</div>
                        </div>
                      </div>
                      <div className="home-v2-holding-value">
                        <strong>{formatMoney(asset.__positionValue)}</strong>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", justifyContent: "flex-end" }}>
                          {asset.__allocationPercent.toFixed(1)}% allocation · Qty {Number(asset.quantity || 0).toLocaleString()}
                          {concentrated ? <span className="home-v3-warning-badge" style={{ position: "static", margin: 0, padding: "1px 6px", minHeight: "18px", fontSize: "10px" }}>Concentrated</span> : null}
                        </span>
                      </div>
                      <div className={`home-v2-holding-change ${changeClass}`}>
                        {change > 0 ? "↗" : change < 0 ? "↘" : ""} {change > 0 ? "+" : ""}{change.toFixed(1)}%
                      </div>
                    </button>
                  );
                })
              ) : (
                <HomeEmptyState title="No holdings yet" description="Add your first position to start tracking allocation and performance." cta="Add Position" onAction={() => onViewAllPositions?.()} />
              )}
            </div>
          </div>
        </div>

        <aside className="home-v2-right-col">
          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header">
              <h2>Asset Allocation</h2>
              <button type="button" className="home-v2-link-btn" onClick={() => onViewAllPositions?.()}>View Breakdown</button>
            </div>
            {allocationBreakdown.total > 0 ? (
              <>
                <div className="home-v3-allocation-chart">
                  <ReactApexChart
                    options={{
                      chart: { type: "donut", background: "transparent" },
                      labels: ["Crypto", "Cash"],
                      legend: { show: false },
                      stroke: { width: 2, colors: ["#030A18"] },
                      colors: ["#8B5CF6", "#22D3EE"],
                      dataLabels: { enabled: false },
                      tooltip: { y: { formatter: (val) => `${Number(val).toFixed(1)}%` } },
                      plotOptions: { pie: { donut: { size: "68%" } } }
                    }}
                    series={[
                      Number(allocationBreakdown.cryptoPercent.toFixed(2)),
                      Number(allocationBreakdown.cashPercent.toFixed(2))
                    ]}
                    type="donut"
                    height={220}
                  />
                  <div className="home-v3-donut-center"><span>Total</span><strong>{formatCompactMoney(allocationBreakdown.total)}</strong></div>
                </div>
                <div className="home-v2-legend">
                  <div className="home-v2-legend-row">
                    <div className="home-v2-legend-left">
                      <span className="dot crypto" />
                      <span>Crypto</span>
                    </div>
                    <strong>{allocationBreakdown.cryptoPercent.toFixed(0)}% / {formatMoney(allocationBreakdown.cryptoValue)}</strong>
                  </div>
                  <div className="home-v2-legend-row">
                    <div className="home-v2-legend-left">
                      <span className="dot cash" />
                      <span>Cash</span>
                    </div>
                    <strong>{allocationBreakdown.cashPercent.toFixed(0)}% / {formatMoney(allocationBreakdown.cashValue)}</strong>
                  </div>
                </div>
                {allocationBreakdown.cashPercent >= 80 ? <div className="home-v3-allocation-warning">Cash concentration is high.</div> : null}
              </>
            ) : (
              <HomeEmptyState title="No allocation data" description="Add holdings to see portfolio allocation." cta="Add Position" onAction={() => onViewAllPositions?.()} />
            )}
          </div>

          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header"><h2>Key Metrics</h2></div>
            <div className="home-v2-metrics">
              <div className="home-v2-metric-row"><span>↗ Total Return</span><strong className={totalReturnPct >= 0 ? "positive" : "negative"}>{formatSignedPercent(totalReturnPct)}</strong></div>
              <div className="home-v2-metric-row"><span>⏱ Today's Change</span><strong className={dailyChange >= 0 ? "positive" : "negative"}>{formatSignedMoney(dailyChange)}</strong></div>
              <div className="home-v2-metric-row"><span>◼ Positions</span><strong>{(portfolio || []).length}</strong></div>
              <div className="home-v2-metric-row"><span>◎ Watchlist</span><strong>{(watchlistAssets || []).length} assets</strong></div>
              <div className="home-v2-metric-row"><span>⚠ Active Alerts</span><strong className="warning">{alerts.length}</strong></div>
            </div>
            <button type="button" className="home-v3-btn secondary full" onClick={onViewFullMetrics}>View Full Metrics</button>
          </div>

          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header"><h2>Recent Activity</h2><button type="button" className="home-v2-link-btn">View all activity</button></div>
            <div className="home-v2-activity-list">
              {recentActivityRows.length ? recentActivityRows.map((row) => (
                <button key={row.id} type="button" className="home-v2-activity-row" onClick={() => setSelectedActivityDetail(row)}>
                  <div className={`home-v2-activity-icon ${row.tone}`}>{row.tone === "sell" ? "↘" : "↗"}</div>
                  <div className="home-v2-activity-body">
                    <strong>{row.action} {row.symbol}</strong>
                    <span>{row.when}</span>
                  </div>
                  <div className="home-v2-activity-value">{formatMoney(row.value)}</div>
                  <span className="home-v3-status-badge">{row.status}</span>
                </button>
              )) : (
                <HomeEmptyState title="No recent activity yet" description="Trades and portfolio updates will appear here." />
              )}
            </div>
          </div>
        </aside>
      </section>

      {(needsAttention.length || quickActionFeedback || moversLoading || gainers.length || losers.length || todayView.headlines.length || eventRows.length || quickActions.length) ? (
        <section className="watchlist-panel glass home-v2-panel home-v3-market-context">
          <div className="section-header">
            <div>
              <h2>Market Context</h2>
              <p className="home-v2-section-kicker">Daily movers and broader signals affecting your portfolio.</p>
            </div>
            <div className="home-v3-market-controls">
              <select
                value={moversHorizon}
                onChange={(e) => setMoversHorizon(e.target.value)}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="quarterly">3M</option>
              </select>
              <select value={marketScope} onChange={(e) => setMarketScope(e.target.value)}>
                <option value="all">All</option>
                <option value="holdings">Holdings</option>
                <option value="watchlist">Watchlist</option>
              </select>
              <span className="asset-count">{moversLoading ? "Loading..." : `${gainers.length + losers.length} movers`}</span>
            </div>
          </div>
          <div className="home-v3-market-grid">
            <div className="home-v3-mover-panel">
              <h3 className="home-subsection-title">Gainers</h3>
              {gainers.length ? (
                <div className="home-v3-mover-list">
                  {gainers.map((asset) => (
                    <button key={`g-${asset.symbol}`} type="button" className="home-v3-mover-row" onClick={() => onSelectAsset(asset)}>
                      <div><strong>{asset.symbol}</strong><span>{asset.name || asset.symbol}</span></div>
                      <span className="home-v3-relevance">Market</span>
                      <div><strong>{formatAssetPrice(asset)}</strong><span className="positive">+{(asset.__moverChange || 0).toFixed(2)}%</span></div>
                    </button>
                  ))}
                </div>
              ) : <HomeEmptyState title="No gainers found for this period." />}
            </div>
            <div className="home-v3-mover-panel">
              <h3 className="home-subsection-title">Losers</h3>
              {losers.length ? (
                <div className="home-v3-mover-list">
                  {losers.map((asset) => (
                    <button key={`l-${asset.symbol}`} type="button" className="home-v3-mover-row" onClick={() => onSelectAsset(asset)}>
                      <div><strong>{asset.symbol}</strong><span>{asset.name || asset.symbol}</span></div>
                      <span className="home-v3-relevance">Market</span>
                      <div><strong>{formatAssetPrice(asset)}</strong><span className="negative">{(asset.__moverChange || 0).toFixed(2)}%</span></div>
                    </button>
                  ))}
                </div>
              ) : <HomeEmptyState title="No losers found for this period." />}
            </div>
          </div>
          <button type="button" className="home-v3-btn secondary" onClick={() => setMarketDetailOpen(true)}>Open Market Context</button>
        </section>
      ) : null}
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
    </div>
  );
}

function HomeEmptyState({ title, description, cta, onAction }) {
  return (
    <div className="home-v3-empty">
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {cta ? <button type="button" className="home-v3-btn secondary" onClick={onAction}>{cta}</button> : null}
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

function buildSparkValues(seed = 1, count = 24) {
  let cursor = Math.max(1, Number(seed) || 1);
  return Array.from({ length: count }, (_, idx) => {
    cursor = (cursor * 9301 + 49297 + idx * 233) % 233280;
    const wave = Math.sin((idx / Math.max(1, count - 1)) * Math.PI * 2) * 14;
    return 48 + wave + (cursor / 233280) * 24;
  });
}

function MiniSparkline({ values = [], color = "#38bdf8" }) {
  const series = Array.isArray(values) && values.length ? values : buildSparkValues(8, 18);
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

function MarketSummaryCard({ label, value, change, tone, caption, color, seed }) {
  return (
    <div className="market-summary-card">
      <span>{label}</span>
      <div className="market-summary-value">
        <strong>{value}</strong>
        <em className={tone}>{tone === "positive" ? "▲" : "▼"} {change}</em>
      </div>
      <MiniSparkline values={buildSparkValues(seed, 26)} color={color} />
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
            <div><strong>{row.symbol}</strong><span>{row.name || row.symbol}</span></div>
            <span>{formatAssetPrice(row)}</span>
            <em className={change >= 0 ? "positive" : "negative"}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(2)}%</em>
          </button>
        );
      }) : <div className="market-empty-row">No movers for this filter.</div>}
    </div>
  );
}
