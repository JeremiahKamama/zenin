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
  balance = 0
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
  const moversPerfCacheRef = useRef(new Map());

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
          <button type="button" className="home-v2-link-btn">View All</button>
        </div>
        <div className="home-v2-attention-grid">
          {attentionCards.map((card) => (
            <article key={card.id} className={`home-v2-attention-card ${card.variant}`}>
              <h3>{card.title}</h3>
              <p>{card.text}</p>
              <button type="button" className="home-v2-link-btn">{card.cta}</button>
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
              <button type="button" className="home-v2-link-btn">View All Positions</button>
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
    </div>
  );
}
