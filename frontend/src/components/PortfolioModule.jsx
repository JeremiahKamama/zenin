import { useState, useMemo } from "react";
import Chart from "react-apexcharts";

export function PortfolioModule({
  portfolio,
  trades = [],
  balance = 0,
  calculatePortfolioValue,
  calculatePortfolioGain,
  onRemove,
  onSellAsset,
  onSelectAsset
}){
  const [chartMode, setChartMode] = useState("equity");
  const [chartInterval, setChartInterval] = useState("1D");
  const [showDiversificationModal, setShowDiversificationModal] = useState(false);
  const INTERVALS = ["1D", "1W", "3M", "1Y", "YTD", "5Y", "MAX"];
  const initialBalance = 10000;
  const portfolioValue = calculatePortfolioValue();
  const tradeTimeline = useMemo(() => {
    return (Array.isArray(trades) ? trades : [])
      .map((trade, idx) => {
        const timestamp = new Date(trade?.executedAt || trade?.date || 0).getTime();
        if (!Number.isFinite(timestamp)) return null;
        const accountEquityAfter = Number(trade?.accountEquityAfter ?? trade?.account_equity_after);
        const balanceAfter = Number(trade?.balanceAfter ?? trade?.balance_after);
        const portfolioValueAfter = Number(trade?.portfolioValueAfter ?? trade?.portfolio_value_after);
        const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
        const notional = Number(trade?.notional);
        const fallbackNotional = Number(trade?.price) * Math.abs(Number(trade?.quantity));
        return {
          id: trade?.id ?? `trade-${idx}`,
          t: timestamp,
          side,
          notional: Number.isFinite(notional) ? Math.abs(notional) : (Number.isFinite(fallbackNotional) ? Math.abs(fallbackNotional) : 0),
          equity: Number.isFinite(accountEquityAfter)
            ? accountEquityAfter
            : Number.isFinite(balanceAfter) && Number.isFinite(portfolioValueAfter)
              ? balanceAfter + portfolioValueAfter
              : null,
          balanceAfter: Number.isFinite(balanceAfter) ? balanceAfter : null
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
  }, [trades]);

  const inferredCashBalance = useMemo(() => {
    const latestWithBalance = [...tradeTimeline].reverse().find((trade) => Number.isFinite(trade.balanceAfter));
    if (latestWithBalance) return latestWithBalance.balanceAfter;
    return tradeTimeline.reduce((cash, trade) => {
      if (!Number.isFinite(trade.notional)) return cash;
      return trade.side === "sell" ? cash + trade.notional : cash - trade.notional;
    }, initialBalance);
  }, [tradeTimeline]);

  const liveAvailableBalance = Number.isFinite(Number(balance)) ? Number(balance) : inferredCashBalance;
  const currentAccountEquity = liveAvailableBalance + portfolioValue;
  const isProfitable = currentAccountEquity >= initialBalance;
  const chartColor = chartMode === "pnl" ? (isProfitable ? "#22c55e" : "#ef4444") : "#38bdf8";

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
      { t: now, equity: currentAccountEquity }
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
      return [Math.round(t), Number(toSeriesValue(equity).toFixed(2))];
    });
  }, [chartInterval, chartMode, tradeTimeline, currentAccountEquity]);
  const yFormatter = (val) => {
    if (chartMode === "percentage") return `${val.toFixed(2)}%`;
    if (chartMode === "pnl") return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const chartOptions = {
    chart: { type: "area", toolbar: { show: false }, background: "transparent", animations: { enabled: false } },
    theme: { mode: "dark" },
    stroke: { curve: "smooth", width: 2, colors: [chartColor] },
    fill: {
      type: "gradient",
      gradient: {
        colorStops: [{ offset: 0, color: chartColor, opacity: 0.3 }, { offset: 100, color: chartColor, opacity: 0 }]
      }
    },
    xaxis: { type: "datetime", labels: { style: { colors: "#64748b", fontSize: "10px" } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: "#94a3b8", fontSize: "11px" }, formatter: yFormatter } },
    grid: { borderColor: "rgba(255,255,255,0.05)", strokeDashArray: 4, xaxis: { lines: { show: false } } },
    tooltip: { theme: "dark", x: { format: "dd MMM yyyy HH:mm" }, y: { formatter: yFormatter } },
    dataLabels: { enabled: false },
    markers: { size: 0 }
  };

  // Theme breakdown for pie chart
  const themeMap = {};
  portfolio.forEach(item => {
    const theme = item.theme || item.type || "Other";
    const val = (item.price || 0) * (item.quantity || 0);
    themeMap[theme] = (themeMap[theme] || 0) + val;
  });
  const themeLabels = Object.keys(themeMap);
  const themeSeries = Object.values(themeMap).map(v => parseFloat(v.toFixed(2)));

  const pieOptions = {
    chart: { type: "donut", background: "transparent" },
    theme: { mode: "dark" },
    labels: themeLabels,
    stroke: { show: false },
    legend: { position: "right", fontSize: "11px", labels: { colors: "#94a3b8" } },
    dataLabels: { enabled: true, style: { fontSize: "11px" } },
    plotOptions: { pie: { donut: { size: "65%" } } },
    tooltip: { y: { formatter: v => `$${v.toLocaleString(undefined, { minimumFractionDigits: 2 })}` } }
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

  return (
    <div className="portfolio-module" style={{ borderBottom: "1px solid rgba(255,255,255,0.15)", paddingBottom: "8px" }}>
        <div className="portfolio-analytics-row" style={{ marginBottom: "16px" }}>
                <div className="metric-card glass">
                  <label>Account Value</label>
                  <div className="value">${calculatePortfolioValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className={`change ${calculatePortfolioGain() >= 0 ? "positive" : "negative"}`}>
                    {calculatePortfolioGain() >= 0 ? "▲" : "▼"} ${Math.abs(calculatePortfolioGain()).toFixed(2)}
                  </div>
                </div>

                <div className="metric-card glass">
                  <label>Best Performing</label>
                  {portfolio.length > 0 ? (() => {
                    const best = [...portfolio].sort((a, b) => (b.priceChangePercent || 0) - (a.priceChangePercent || 0))[0];
                    return <>
                      <div className="value">{best.symbol}</div>
                      <div className="change positive">+{best.priceChangePercent?.toFixed(2)}%</div>
                    </>;
                  })() : <div className="value">N/A</div>}
                </div>

                <div
                  className="metric-card glass clickable"
                  style={{ overflow: "hidden", cursor: "pointer" }}
                  onClick={() => setShowDiversificationModal(true)}
                  title="View diversification by theme"
                >
                  <label>Diversification</label>
                  {themeSeries.length > 0 ? (
                    <Chart
                      options={{
                        ...pieOptions,
                        chart: { ...pieOptions.chart, sparkline: { enabled: false } },
                        legend: { show: false },
                        dataLabels: { enabled: false },
                        plotOptions: { pie: { donut: { size: "70%" } } },
                      }}
                      series={themeSeries}
                      type="donut"
                      height={80}
                      width="100%"
                    />
                  ) : (
                    <div className="value" style={{ fontSize: "14px" }}>No holdings</div>
                  )}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" }}>
                    {themeLabels.slice(0, 4).map((label, i) => (
                      <span key={label} style={{
                        fontSize: "10px", padding: "2px 6px", borderRadius: "4px",
                        background: "rgba(255,255,255,0.06)", color: "var(--color-text-secondary)"
                      }}>{label}</span>
                    ))}
                    {themeLabels.length > 4 && (
                      <span style={{ fontSize: "10px", color: "var(--color-text-secondary)" }}>+{themeLabels.length - 4} more</span>
                    )}
                  </div>
                </div>
              </div>

      <div className="portfolio-chart-section" style={{ marginBottom: "16px" }}>
        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h2>Performance Chart</h2>
        </div>
        <div className="watchlist-panel glass portfolio-performance-card">
          <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
            {[["equity", "Equity Curve"], ["percentage", "% Gain"], ["pnl", "Cash PnL"]].map(([mode, label]) => (
              <button key={mode} onClick={() => setChartMode(mode)} style={{
                padding: "4px 10px", fontSize: "12px", borderRadius: "6px", cursor: "pointer",
                background: chartMode === mode ? "rgba(56,189,248,0.15)" : "transparent",
                border: `0.5px solid ${chartMode === mode ? "#38bdf8" : "rgba(255,255,255,0.1)"}`,
                color: chartMode === mode ? "#38bdf8" : "var(--color-text-secondary)"
              }}>{label}</button>
            ))}
          </div>
          <Chart
            options={chartOptions}
            series={[{ name: chartMode === "percentage" ? "% Gain" : chartMode === "pnl" ? "Cash PnL" : "Equity Curve", data: chartData }]}
            type="area" height={200} width="100%"
          />
          <div style={{ display: "flex", gap: "6px", marginTop: "8px", justifyContent: "center", flexWrap: "wrap" }}>
            {INTERVALS.map(int => (
              <button key={int} onClick={() => setChartInterval(int)} style={{
                padding: "4px 10px", fontSize: "12px", borderRadius: "6px", cursor: "pointer",
                background: chartInterval === int ? "rgba(56,189,248,0.15)" : "transparent",
                border: `0.5px solid ${chartInterval === int ? "#38bdf8" : "rgba(255,255,255,0.1)"}`,
                color: chartInterval === int ? "#38bdf8" : "var(--color-text-secondary)"
              }}>{int}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="portfolio-holdings-section" style={{ marginBottom: "16px" }}>
        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h2>Holdings &amp; Performance Metrics</h2>
        </div>
        <div className="portfolio-holdings-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

          <div className="watchlist-panel glass">
            <div className="section-header">
              <h2>Holdings</h2>
              <div className="asset-count">{portfolio.length} Positions</div>
            </div>
            {portfolio.length === 0 ? (
              <p style={{ padding: "20px", color: "var(--color-text-secondary)" }}>No holdings yet.</p>
            ) : (
              <>
                <div className="portfolio-list">
                  {portfolio.map((item) => {
                    const positionValue = (item.price || 0) * (item.quantity || 0);
                    const entryPrice = Number(item.entryPrice);
                    const basisPrice = Number.isFinite(entryPrice) ? entryPrice : Number(item.price) || 0;
                    const positionGain = (item.price || 0) * (item.quantity || 0) - basisPrice * (item.quantity || 0);
                    const gainPercent = item.priceChangePercent || 0;
                    return (
                      <div
                        key={item.id}
                        className="portfolio-card clickable"
                        onClick={() => onSelectAsset?.({ ...item, _fromHoldings: true })}
                      >
                        <div className="portfolio-left">
                          <div>
                            <strong>{item.symbol}</strong>
                          </div>
                        </div>
                        <div className="portfolio-center">
                          <div className="price-info">
                            <div className={`change ${gainPercent >= 0 ? "positive" : "negative"}`}>
                              {gainPercent >= 0 ? "+" : ""}{gainPercent.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                        <div className="portfolio-quantity">
                          <div className="quantity-readonly">{Number(item.quantity || 0).toFixed(2)}</div>
                        </div>
                        <div className="portfolio-value">
                          <div className="position-value">${positionValue.toFixed(2)}</div>
                          <div className={`position-gain ${positionGain >= 0 ? "positive" : "negative"}`}>
                            {positionGain >= 0 ? "+" : ""}${positionGain.toFixed(2)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="portfolio-summary">
                  <div className="summary-item"><span>Total Value:</span><strong>${calculatePortfolioValue().toFixed(2)}</strong></div>
                  <div className="summary-item">
                    <span>Total Gain/Loss:</span>
                    <strong className={calculatePortfolioGain() >= 0 ? "positive" : "negative"}>
                      ${calculatePortfolioGain().toFixed(2)}
                    </strong>
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="watchlist-panel glass">
            <div className="section-header" style={{ marginBottom: "16px" }}>
              <h2>Performance Metrics</h2>
            </div>
            {metrics ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {[
                  {
                    key: "sharpe",
                    label: "Sharpe Ratio",
                    value: metrics.sharpe,
                    color: Number.isFinite(Number(metrics.sharpe))
                      ? (Number(metrics.sharpe) >= 1 ? "#22c55e" : Number(metrics.sharpe) >= 0 ? "#f59e0b" : "#ef4444")
                      : "#94a3b8"
                  },
                  {
                    key: "sortino",
                    label: "Sortino Ratio",
                    value: metrics.sortino,
                    color: Number.isFinite(Number(metrics.sortino))
                      ? (Number(metrics.sortino) >= 1 ? "#22c55e" : Number(metrics.sortino) >= 0 ? "#f59e0b" : "#ef4444")
                      : "#94a3b8"
                  },
                  {
                    key: "maxDrawdown",
                    label: "Max Drawdown",
                    value: `${metrics.maxDrawdown}%`,
                    color: Number.isFinite(Number(metrics.maxDrawdown))
                      ? (Number(metrics.maxDrawdown) < 5 ? "#22c55e" : Number(metrics.maxDrawdown) < 15 ? "#f59e0b" : "#ef4444")
                      : "#94a3b8"
                  },
                  {
                    key: "alpha",
                    label: "Alpha (Jensen's)",
                    value: Number.isFinite(Number(metrics.alpha)) ? `${metrics.alpha}%` : metrics.alpha,
                    color: Number.isFinite(Number(metrics.alpha))
                      ? (Number(metrics.alpha) >= 0 ? "#22c55e" : "#ef4444")
                      : "#94a3b8"
                  },
                  {
                    key: "beta",
                    label: "Beta",
                    value: metrics.beta,
                    color: Number.isFinite(Number(metrics.beta))
                      ? (Math.abs(Number(metrics.beta) - 1) < 0.3 ? "#38bdf8" : "#f59e0b")
                      : "#94a3b8"
                  }
                ].map(({ key, label, value, color }) => (
                  <div key={key} style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)", paddingBottom: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{label}</span>
                      <span style={{ fontSize: "18px", fontWeight: 500, color }}>{value}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ padding: "20px", color: "var(--color-text-secondary)" }}>Add holdings to see performance metrics.</p>
            )}
          </div>

        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header" style={{ marginBottom: "12px" }}>
          <h2>Prediction Markets</h2>
          <div className="asset-count">{predictionMarketRows.length} Markets</div>
        </div>
        {predictionMarketRows.length === 0 ? (
          <p style={{ padding: "20px", color: "var(--color-text-secondary)" }}>
            No prediction market trades yet.
          </p>
        ) : (
          <div style={{ display: "grid", gap: "10px" }}>
            {predictionMarketRows.map((row) => (
              <div
                key={row.market}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  background: "rgba(15,23,42,0.3)"
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {row.market}
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: row.pnl >= 0 ? "#22c55e" : "#ef4444", marginLeft: "12px" }}>
                  {row.pnl >= 0 ? "+" : ""}${Math.abs(row.pnl).toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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
              <button
                type="button"
                className="pagination-button"
                onClick={() => setShowDiversificationModal(false)}
              >
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
    </div>
  );
}
