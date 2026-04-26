import { useEffect, useMemo, useRef, useState } from "react";
import ReactApexChart from "react-apexcharts";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { calculateOptionPnL } from "../utils/optionsPnL";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");

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
  onViewAllPositions
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
  const [flowSelection, setFlowSelection] = useState(null);
  const [flowBusy, setFlowBusy] = useState(false);
  const [flowActionLabel, setFlowActionLabel] = useState("");
  const moversPerfCacheRef = useRef(new Map());
  const flowTimerRef = useRef(null);

  const topPositions = useMemo(() => {
    const spotPositions = (Array.isArray(portfolio) ? portfolio : []).map((asset) => ({
      ...asset,
      __isOptionPosition: false,
      __positionValue: (Number(asset?.price) || 0) * (Number(asset?.quantity) || 0)
    }));

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
    const source = watchlistAssets.length > 0
      ? watchlistAssets
      : (marketMovers.length > 0 ? marketMovers : assets);

    const priceMap = new Map();
    [...marketMovers, ...assets].forEach((asset) => {
      const symbol = String(asset?.symbol || "").toUpperCase();
      if (!symbol || priceMap.has(symbol)) return;
      priceMap.set(symbol, {
        price: Number.isFinite(Number(asset?.price)) ? Number(asset.price) : null,
        name: asset?.name || symbol
      });
    });

    const deduped = new Map();
    source.forEach((asset) => {
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
  }, [watchlistAssets, marketMovers, assets]);

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
  }, [moversUniverseKey]);

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
    return () => {
      if (flowTimerRef.current) clearTimeout(flowTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!activeAttentionFlow) return;
    const handleKeydown = (event) => {
      if (event.key === "Escape") {
        setActiveAttentionFlow(null);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [activeAttentionFlow]);

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
    return `$${value.toFixed(2)}`;
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

  const chartOptions = {
    chart: { type: "area", toolbar: { show: false }, background: "transparent", animations: { enabled: true }, sparkline: { enabled: false } },
    theme: { mode: "dark" },
    stroke: { curve: "smooth", width: 2, colors: [chartColor] },
    fill: {
      type: "gradient",
      gradient: {
        shadeIntensity: 1,
        opacityFrom: 0.3,
        opacityTo: 0.0,
        stops: [0, 100],
        colorStops: [{ offset: 0, color: chartColor, opacity: 0.3 }, { offset: 100, color: chartColor, opacity: 0 }]
      }
    },
    xaxis: { type: "datetime", labels: { style: { colors: "#64748b", fontSize: "10px" } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: "#94a3b8", fontSize: "11px" }, formatter: yFormatter }, opposite: false },
    grid: { borderColor: "rgba(255,255,255,0.05)", strokeDashArray: 4, xaxis: { lines: { show: false } } },
    tooltip: { theme: "dark", x: { format: "dd MMM yyyy HH:mm" }, y: { formatter: yFormatter } },
    dataLabels: { enabled: false },
    markers: { size: 0 }
  };

  const formatMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "$0.00";
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatSignedMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "$0.00";
    return `${num >= 0 ? "+" : "-"}$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
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
        when,
        value: Number.isFinite(notional) ? notional : 0,
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
  const chartModeButtons = [["equity", "Equity Curve"], ["percentage", "% Gain"], ["pnl", "Cash PnL"]];
  const DISPLAY_INTERVALS = ["1D", "1W", "1M", "3M", "1Y", "ALL"];

  const attentionCards = [
    {
      id: "missing",
      variant: "warn",
      title: `${moversCoverage.unavailable || 0} assets missing data`,
      text: "Update required for accurate tracking",
      cta: "Review"
    },
    {
      id: "rebalance",
      variant: "info",
      title: "Rebalancing suggested",
      text: `Portfolio drift detected: ${Math.abs(allocationBreakdown.cryptoPercent - 50).toFixed(1)}% from target`,
      cta: "View Plan"
    },
    {
      id: "volatility",
      variant: "risk",
      title: "High volatility alert",
      text: alerts[0]?.text || "Macro/market volatility signal detected",
      cta: "Analyze"
    }
  ];

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
      <div className="home-v2-flow-overlay" role="dialog" aria-modal="true" aria-label="Needs Attention user flow">
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

  return (
    <div className="view-container home-dashboard home-v2">
      <section className="home-v2-hero glass">
        <div className="home-v2-hero-left">
          <div className="home-v2-label">Total Portfolio Value</div>
          <div className="home-v2-hero-main">
            <span className="home-v2-hero-value">{formatMoney(totalAccountEquity)}</span>
            <span className={`home-v2-hero-change ${dailyChange >= 0 ? "positive" : "negative"}`}>
              {dailyChange >= 0 ? "↗" : "↘"} {formatSignedMoney(dailyChange)} ({formatSignedPercent(initialBalance > 0 ? (dailyChange / initialBalance) * 100 : 0)})
            </span>
          </div>
          <div className="home-v2-subtle">Today's P&amp;L</div>
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
          <h2>Needs Attention</h2>
          <button type="button" className="home-v2-link-btn" onClick={() => openAttentionFlow("missing")}>View All</button>
        </div>
        <div className="home-v2-attention-grid">
          {attentionCards.map((card) => (
            <article key={card.id} className={`home-v2-attention-card ${card.variant}`}>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
              <button type="button" className="home-v2-link-btn" onClick={() => openAttentionFlow(card.id)}>{card.cta}</button>
            </article>
          ))}
        </div>
      </section>

      <section className="home-v2-main-grid">
        <div className="home-v2-left-col">
          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header">
              <h2>Portfolio Performance</h2>
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
            <ReactApexChart
              options={chartOptions}
              series={[{
                name: chartMode === "percentage" ? "% Gain" : chartMode === "pnl" ? "Cash PnL" : "Equity Curve",
                data: chartData
              }]}
              type="area"
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
                  return (
                    <button
                      type="button"
                      key={`home-hold-${asset.id || symbol}`}
                      className="home-v2-holding-row"
                      onClick={() => onSelectAsset?.(asset)}
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
                        <span>{asset.__allocationPercent.toFixed(1)}% allocation</span>
                      </div>
                      <div className={`home-v2-holding-change ${changeClass}`}>
                        {change > 0 ? "↗" : change < 0 ? "↘" : ""} {change > 0 ? "+" : ""}{change.toFixed(1)}%
                      </div>
                    </button>
                  );
                })
              ) : (
                <div className="loading-state">No holdings yet.</div>
              )}
            </div>
          </div>
        </div>

        <aside className="home-v2-right-col">
          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header"><h2>Asset Allocation</h2></div>
            <ReactApexChart
              options={{
                chart: { type: "donut", background: "transparent" },
                labels: ["Crypto", "Cash"],
                legend: { show: false },
                stroke: { width: 2, colors: ["#d1d5db"] },
                colors: ["#f5a524", "#2ecf9e"],
                dataLabels: { enabled: false },
                plotOptions: { pie: { donut: { size: "66%" } } }
              }}
              series={[
                Number(allocationBreakdown.cryptoPercent.toFixed(2)),
                Number(allocationBreakdown.cashPercent.toFixed(2))
              ]}
              type="donut"
              height={250}
            />
            <div className="home-v2-legend">
              <div className="home-v2-legend-row">
                <div className="home-v2-legend-left">
                  <span className="dot crypto" />
                  <span>Crypto</span>
                </div>
                <strong>{allocationBreakdown.cryptoPercent.toFixed(0)}%</strong>
              </div>
              <div className="home-v2-legend-row">
                <div className="home-v2-legend-left">
                  <span className="dot cash" />
                  <span>Cash</span>
                </div>
                <strong>{allocationBreakdown.cashPercent.toFixed(0)}%</strong>
              </div>
            </div>
          </div>

          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header"><h2>Key Metrics</h2></div>
            <div className="home-v2-metrics">
              <div className="home-v2-metric-row"><span>Total Return</span><strong className={totalReturnPct >= 0 ? "positive" : "negative"}>{formatSignedPercent(totalReturnPct)}</strong></div>
              <div className="home-v2-metric-row"><span>Today's Change</span><strong className={dailyChange >= 0 ? "positive" : "negative"}>{formatSignedMoney(dailyChange)}</strong></div>
              <div className="home-v2-metric-row"><span># of Positions</span><strong>{(portfolio || []).length}</strong></div>
              <div className="home-v2-metric-row"><span>Watchlist</span><strong>{(watchlistAssets || []).length} assets</strong></div>
              <div className="home-v2-metric-row"><span>Active Alerts</span><strong className="warning">{alerts.length}</strong></div>
            </div>
          </div>

          <div className="watchlist-panel glass home-v2-panel">
            <div className="section-header"><h2>Recent Activity</h2></div>
            <div className="home-v2-activity-list">
              {recentActivityRows.length ? recentActivityRows.map((row) => (
                <div key={row.id} className="home-v2-activity-row">
                  <div className={`home-v2-activity-icon ${row.tone}`}>{row.tone === "sell" ? "↘" : "↗"}</div>
                  <div className="home-v2-activity-body">
                    <strong>{row.title}</strong>
                    <span>{row.when}</span>
                  </div>
                  <div className="home-v2-activity-value">{formatMoney(row.value)}</div>
                </div>
              )) : (
                <div className="loading-state">No recent trades yet.</div>
              )}
            </div>
          </div>
        </aside>
      </section>

      {(needsAttention.length || quickActionFeedback || moversLoading || gainers.length || losers.length || todayView.headlines.length || eventRows.length || quickActions.length) ? (
        <section className="watchlist-panel glass home-v2-panel">
          <div className="section-header">
            <h2>Market Context</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <select
                value={moversHorizon}
                onChange={(e) => setMoversHorizon(e.target.value)}
                style={{
                  background: "rgba(15,23,42,0.7)",
                  color: "var(--color-text-primary)",
                  border: "0.5px solid rgba(148,163,184,0.35)",
                  borderRadius: "6px",
                  padding: "4px 8px",
                  fontSize: "12px"
                }}
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="quarterly">Quarterly</option>
                <option value="ytd">YTD</option>
                <option value="yearly">Yearly</option>
              </select>
              <span className="asset-count">{moversLoading ? "Loading..." : `${gainers.length + losers.length} movers`}</span>
            </div>
          </div>
          <div className="home-grid">
            <div>
              <h3 className="home-subsection-title">Gainers</h3>
              <div className="home-asset-list">
                {gainers.map((asset) => (
                  <div key={`g-${asset.symbol}`} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info"><span className="symbol">{asset.symbol}</span></div>
                    <div className="value-info"><div className="price">{formatAssetPrice(asset)}</div><div className="change positive">+{(asset.__moverChange || 0).toFixed(2)}%</div></div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="home-subsection-title">Losers</h3>
              <div className="home-asset-list">
                {losers.map((asset) => (
                  <div key={`l-${asset.symbol}`} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info"><span className="symbol">{asset.symbol}</span></div>
                    <div className="value-info"><div className="price">{formatAssetPrice(asset)}</div><div className="change negative">{(asset.__moverChange || 0).toFixed(2)}%</div></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      ) : null}
      {renderAttentionFlow()}
    </div>
  );
}
