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
    const pointCountMap = { "1D": 24, "1W": 7, "3M": 90, "1Y": 52, "YTD": 52, "5Y": 60, "MAX": 120 };
    const points = pointCountMap[chartInterval] || 24;
    const now = Date.now();
    const start = (() => {
      if (chartInterval === "1D") return now - 24 * 60 * 60 * 1000;
      if (chartInterval === "1W") return now - 7 * 24 * 60 * 60 * 1000;
      if (chartInterval === "3M") return now - 90 * 24 * 60 * 60 * 1000;
      if (chartInterval === "1Y") return now - 365 * 24 * 60 * 60 * 1000;
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

  const INTERVALS = ["1D", "1W", "3M", "1Y", "YTD", "5Y", "MAX"];

  return (
    <div className="view-container home-dashboard">
      <div className="portfolio-analytics-row">
        <div className="metric-card glass">
          <label>Total Account Equity</label>
          <div className="value">${totalAccountEquity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className={`change ${dailyChange >= 0 ? "positive" : "negative"}`}>
            {dailyChange >= 0 ? "▲" : "▼"} ${Math.abs(dailyChange).toFixed(2)} Today
          </div>
        </div>

        <div className="metric-card glass">
          <label>Cash & Buying Power</label>
          <div className="value">${liveAvailableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className="change positive">Available to deploy</div>
        </div>

        <div className="metric-card glass">
          <label>PnL Snapshot</label>
          <div className="value">${(realizedPnl + unrealizedPnl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className={`change ${unrealizedPnl >= 0 ? "positive" : "negative"}`}>
            Unrealized {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
          </div>
        </div>
        <div className="metric-card glass">
          <label>Change Tracker</label>
          <div className="value">
            {weeklyChange >= 0 ? "+" : ""}${weeklyChange.toFixed(2)}
          </div>
          <div className={`change ${ytdChange >= 0 ? "positive" : "negative"}`}>
            YTD {ytdChange >= 0 ? "+" : ""}${ytdChange.toFixed(2)}
          </div>
        </div>
      </div>

      <div className="watchlist-panel glass" style={{ marginBottom: "16px" }}>
        <div className="section-header">
          <h2>Today View</h2>
          <div className="asset-count">{todayView.sentiment}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "10px", marginBottom: "10px" }}>
          <div className="journal-stat-card"><span className="journal-stat-label">VIX</span><span className="journal-stat-value">{Number.isFinite(todayView.vix) ? todayView.vix.toFixed(2) : "—"}</span></div>
          <div className="journal-stat-card"><span className="journal-stat-label">Rates</span><span className="journal-stat-value">{Number.isFinite(todayView.rates) ? todayView.rates.toFixed(2) : "—"}</span></div>
          <div className="journal-stat-card"><span className="journal-stat-label">Breadth</span><span className="journal-stat-value">{Number.isFinite(todayView.breadth) ? todayView.breadth.toFixed(2) : "—"}</span></div>
          <div className="journal-stat-card"><span className="journal-stat-label">Counts</span><span className="journal-stat-value">{(portfolio || []).length} pos · {(watchlistAssets || []).length} watch · {alerts.length} alerts</span></div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {(todayView.headlines.length ? todayView.headlines : ["No headline feed yet."]).map((item, idx) => (
            <div key={`head-${idx}`} style={{ fontSize: "12px", color: "#cbd5e1" }}>• {item}</div>
          ))}
        </div>
      </div>

      <div className="watchlist-panel glass" style={{ marginBottom: "16px" }}>
        <div className="section-header">
          <h2>Alerts Tray</h2>
          <div className="asset-count">{alerts.length} Active</div>
        </div>
        {alerts.length ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "8px" }}>
            {alerts.map((alert) => (
              <div key={alert.id} style={{ border: "1px solid rgba(148,163,184,0.18)", borderRadius: "10px", padding: "8px 10px", background: "rgba(15,23,42,0.45)", fontSize: "12px", color: "#cbd5e1" }}>
                <span style={{ color: "#7dd3fc", textTransform: "uppercase", fontSize: "10px", marginRight: "6px" }}>{alert.type}</span>
                {alert.text}
              </div>
            ))}
          </div>
        ) : (
          <div className="loading-state">No active alerts.</div>
        )}
      </div>

      <div className="watchlist-panel glass" style={{ marginBottom: "16px" }}>
        <div className="section-header">
          <h2>Quick Actions</h2>
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {quickActions.map((item) => (
            <button
              key={item.id}
              type="button"
              className="pagination-button"
              onClick={() => {
                item.action();
                if (item.id === "trade") {
                  setQuickActionFeedback("Opening selected asset for a new trade.");
                }
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
        {quickActionFeedback ? (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#94a3b8" }}>{quickActionFeedback}</div>
        ) : null}
      </div>

      <div className="watchlist-panel glass" style={{ marginBottom: "16px" }}>
        <div className="section-header">
          <h2>Needs Attention</h2>
        </div>
        {needsAttention.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {needsAttention.map((item, idx) => (
              <div key={`need-${idx}`} style={{ color: "#fbbf24", fontSize: "12px", border: "1px solid rgba(245,158,11,0.25)", borderRadius: "8px", padding: "8px 10px", background: "rgba(120,53,15,0.2)" }}>
                {item}
              </div>
            ))}
          </div>
        ) : (
          <div className="loading-state">No immediate attention flags.</div>
        )}
      </div>

      {/* Portfolio Chart */}
      <div className="watchlist-panel glass" style={{ marginBottom: "16px" }}>
        <div className="section-header" style={{ marginBottom: "8px" }}>
          <h2>Portfolio Performance</h2>
          <div style={{ display: "flex", gap: "6px" }}>
            {[["equity", "Equity Curve"], ["percentage", "% Gain"], ["pnl", "Cash PnL"]].map(([mode, label]) => (
              <button
                key={mode}
                onClick={() => setChartMode(mode)}
                style={{
                  padding: "4px 10px", fontSize: "12px", borderRadius: "6px", cursor: "pointer",
                  background: chartMode === mode ? "rgba(56,189,248,0.15)" : "transparent",
                  border: `0.5px solid ${chartMode === mode ? "#38bdf8" : "rgba(255,255,255,0.1)"}`,
                  color: chartMode === mode ? "#38bdf8" : "var(--color-text-secondary)"
                }}
              >{label}</button>
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
          height={220}
          width="100%"
        />

        <div style={{ display: "flex", gap: "6px", marginTop: "8px", justifyContent: "center" }}>
          {INTERVALS.map(int => (
            <button
              key={int}
              onClick={() => setChartInterval(int)}
              style={{
                padding: "4px 10px", fontSize: "12px", borderRadius: "6px", cursor: "pointer",
                background: chartInterval === int ? "rgba(56,189,248,0.15)" : "transparent",
                border: `0.5px solid ${chartInterval === int ? "#38bdf8" : "rgba(255,255,255,0.1)"}`,
                color: chartInterval === int ? "#38bdf8" : "var(--color-text-secondary)"
              }}
            >{int}</button>
          ))}
        </div>
      </div>

      <div className="home-grid">
        {/* Top Positions */}
        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2 className="home-subsection-title">Top Positions</h2>
            <div className="asset-count">By Value</div>
          </div>
          <div className="home-asset-list">
            {topPositions.length > 0 ? (
              topPositions.map((asset) => {
                const value = Number(asset.__positionValue || ((asset.price || 0) * (asset.quantity || 0)));
                const isOptionRow = Boolean(asset.__isOptionPosition);
                return (
                  <div
                    key={asset.id}
                    className={`home-asset-item ${isOptionRow ? "" : "clickable"}`}
                    onClick={() => {
                      if (!isOptionRow) onSelectAsset(asset);
                    }}
                  >
                    <div className="symbol-info">
                      <span className="symbol">{asset.symbol}</span>
                      {isOptionRow ? (
                        <div className="meta" style={{ fontSize: "11px" }}>{asset.strategy}</div>
                      ) : null}
                    </div>
                    <div className="value-info">
                      <div className="price">
                        {isOptionRow
                          ? `${asset.__optionPnl >= 0 ? "+" : ""}$${Number(asset.__optionPnl || 0).toFixed(2)}`
                          : isTreasuryAsset(asset)
                          ? `${Number(asset.price || 0).toFixed(2)}%`
                          : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </div>
                      <div className="qty">
                        {isOptionRow ? `${Number(asset.quantity || 0).toFixed(2)} opt` : asset.quantity}
                      </div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="meta" style={{ padding: "20px" }}>No positions yet.</p>
            )}
          </div>
        </div>

        {/* Gainers & Losers */}
        <div className="watchlist-panel glass">
          <div className="section-header" style={{ marginBottom: "8px" }}>
            <h2 className="home-subsection-title">Top Movers</h2>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              {moversLoading ? (
                <span className="asset-count">Loading...</span>
              ) : null}
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
            </div>
          </div>

          <div className="home-movers-split" style={{ display: "flex", gap: "0" }}>
            
            <div className="home-movers-col home-movers-col-left" style={{ flex: 1, borderRight: "0.5px solid rgba(255,255,255,0.1)" }}>
              <div className="section-header" style={{ padding: "0 0 8px" }}>
                <h2 className="home-subsection-title">Gainers</h2>
              </div>
              <div className="home-asset-list">
                {gainers.length > 0 ? gainers.map((asset) => (
                  <div key={asset.symbol} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info">
                      <span className="symbol">{asset.symbol}</span>
                    </div>
                    <div className="value-info">
                      <div className="price">{formatAssetPrice(asset)}</div>
                      <div className="change positive">+{(asset.__moverChange || 0).toFixed(2)}%</div>
                    </div>
                  </div>
                )) : <p className="meta" style={{ padding: "12px" }}>No data yet.</p>}
              </div>
            </div>

            <div className="home-movers-col home-movers-col-right" style={{ flex: 1, paddingLeft: "12px" }}>
              <div className="section-header" style={{ padding: "0 0 8px" }}>
                <h2 className="home-subsection-title">Losers</h2>
              </div>
              <div className="home-asset-list">
                {losers.length > 0 ? losers.map((asset) => (
                  <div key={asset.symbol} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info">
                      <span className="symbol">{asset.symbol}</span>
                    </div>
                    <div className="value-info">
                      <div className="price">{formatAssetPrice(asset)}</div>
                      <div className="change negative">{(asset.__moverChange || 0).toFixed(2)}%</div>
                    </div>
                  </div>
                )) : <p className="meta" style={{ padding: "12px" }}>No data yet.</p>}
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
