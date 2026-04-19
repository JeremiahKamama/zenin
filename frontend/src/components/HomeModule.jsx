import { useEffect, useMemo, useRef, useState } from "react";
import { TradingViewChart } from "./TradingViewChart";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";

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
  const moversPerfCacheRef = useRef(new Map());

  const topPositions = [...portfolio]
    .sort((a, b) => ((b.price || 0) * (b.quantity || 0)) - ((a.price || 0) * (a.quantity || 0)))
    .slice(0, 8);

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

    const anchors = [
      { t: start, equity: startEquity },
      ...inRangeTrades.map((trade) => ({ t: trade.t, equity: trade.equity })),
      { t: now, equity: totalAccountEquity }
    ].sort((a, b) => a.t - b.t);

    let anchorIdx = 0;
    const step = points > 1 ? (now - start) / (points - 1) : 0;

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
      const equity = Number(anchors[anchorIdx]?.equity ?? initialBalance);
      return {
        time: Math.floor(t / 1000),
        value: Number(toSeriesValue(equity).toFixed(2))
      };
    });
  }, [chartInterval, chartMode, tradeTimeline, totalAccountEquity]);
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
          <div className={`change ${calculatePortfolioGain() >= 0 ? "positive" : "negative"}`}>
            {calculatePortfolioGain() >= 0 ? "▲" : "▼"} ${Math.abs(calculatePortfolioGain()).toFixed(2)} Today
          </div>
        </div>

        <div className="metric-card glass">
          <label>Market Sentiment</label>
          <div className="value">Risk On</div>
          <div className="change positive">High Volatility Alpha</div>
        </div>

        <div className="metric-card glass">
          <label>Available Balance</label>
          <div className="value">${liveAvailableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
        </div>
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
        <TradingViewChart 
          series={[{ 
            name: chartMode === "percentage" ? "% Gain" : chartMode === "pnl" ? "Cash PnL" : "Equity Curve", 
            data: chartData,
            type: "area",
            color: "#38bdf8"
          }]}
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
                const value = (asset.price || 0) * (asset.quantity || 0);
                return (
                  <div key={asset.id} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info">
                      <span className="symbol">{asset.symbol}</span>
                    </div>
                    <div className="value-info">
                      <div className="price">
                        {isTreasuryAsset(asset)
                          ? `${Number(asset.price || 0).toFixed(2)}%`
                          : `$${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                      </div>
                      <div className="qty">{asset.quantity}</div>
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
