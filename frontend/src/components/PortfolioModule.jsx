import { useState, useMemo } from "react";
import Chart from "react-apexcharts";

function CollapseSection({ title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: "16px" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", padding: "12px 0",
          borderTop: "1px solid rgba(255,255,255,0.15)",
          borderBottom: open ? "none" : "1px solid rgba(255,255,255,0.15)",
        }}
      >
        <h2 style={{ margin: 0, fontSize: "16px", fontWeight: 500, color: "var(--color-text-primary)" }}>{title}</h2>
        <span style={{
          fontSize: "11px", color: "var(--color-text-secondary)",
          userSelect: "none", padding: "2px 8px",
          border: "0.5px solid rgba(255,255,255,0.1)",
          borderRadius: "4px", background: "rgba(255,255,255,0.04)"
        }}>
          {open ? "▲ Collapse" : "▼ Expand"}
        </span>
      </div>
      {open && (
        <div style={{ paddingTop: "12px", paddingBottom: "4px" }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function PortfolioModule({
  portfolio,
  trades = [],
  calculatePortfolioValue,
  calculatePortfolioGain,
  onRemove,
  onUpdateQuantity
}) {
  const [chartMode, setChartMode] = useState("equity");
  const [chartInterval, setChartInterval] = useState("1D");
  const INTERVALS = ["1D", "1W", "3M", "1Y", "YTD", "5Y", "MAX"];
  const initialBalance = 10000;
  const portfolioValue = calculatePortfolioValue();
  const isProfitable = portfolioValue >= initialBalance;
  const chartColor = chartMode === "pnl" ? (isProfitable ? "#22c55e" : "#ef4444") : "#38bdf8";

  const generateChartData = () => {
    const points = { "1D": 24, "1W": 7, "3M": 90, "1Y": 52, "YTD": 52, "5Y": 60, "MAX": 120 }[chartInterval] || 24;
    const msMap = { "1D": 3600000, "1W": 86400000, "3M": 86400000, "1Y": 604800000, "YTD": 604800000, "5Y": 2592000000, "MAX": 2592000000 };
    const step = msMap[chartInterval] || 3600000;
    const now = Date.now();
    return Array.from({ length: points }, (_, i) => {
      const t = now - (points - i) * step;
      const progress = i / points;
      const noise = (Math.random() - 0.48) * 0.02;
      const val = portfolioValue * (0.85 + progress * 0.15 + noise);
      if (chartMode === "equity") return [t, parseFloat(val.toFixed(2))];
      if (chartMode === "percentage") return [t, parseFloat(((val - initialBalance) / initialBalance * 100).toFixed(2))];
      return [t, parseFloat((val - initialBalance).toFixed(2))];
    });
  };

  const chartData = generateChartData();
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

  // Performance Metrics
  const metrics = useMemo(() => {
    if (portfolio.length === 0) return null;

    const returns = portfolio.map(item => item.priceChangePercent || 0).map(r => r / 100);
    const avgReturn = returns.reduce((a, b) => a + b, 0) / (returns.length || 1);
    const riskFreeRate = 0.0425 / 252;

    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length || 1);
    const stdDev = Math.sqrt(variance);

    const downsideReturns = returns.filter(r => r < riskFreeRate);
    const downsideVariance = downsideReturns.reduce((sum, r) => sum + Math.pow(r - riskFreeRate, 2), 0) / (downsideReturns.length || 1);
    const downsideDeviation = Math.sqrt(downsideVariance);

    const sharpe = stdDev > 0 ? ((avgReturn - riskFreeRate) / stdDev) * Math.sqrt(252) : 0;
    const sortino = downsideDeviation > 0 ? ((avgReturn - riskFreeRate) / downsideDeviation) * Math.sqrt(252) : 0;

    // Max drawdown from portfolio value vs initial
    const maxDrawdown = portfolioValue < initialBalance
      ? ((initialBalance - portfolioValue) / initialBalance) * 100
      : 0;

    // Beta: weighted average beta approximation using priceChangePercent vs market proxy (1% market daily)
    const marketReturn = 0.01;
    const weightedBeta = portfolio.reduce((sum, item) => {
      const weight = ((item.price || 0) * (item.quantity || 0)) / (portfolioValue || 1);
      const assetReturn = (item.priceChangePercent || 0) / 100;
      const beta = marketReturn > 0 ? assetReturn / marketReturn : 1;
      return sum + weight * beta;
    }, 0);

    // Jensen's Alpha: portfolio return - [risk free + beta * (market - risk free)]
    const marketDailyReturn = 0.0001;
    const alpha = (avgReturn - riskFreeRate - weightedBeta * (marketDailyReturn - riskFreeRate)) * 252 * 100;

    return {
      sharpe: sharpe.toFixed(2),
      sortino: sortino.toFixed(2),
      maxDrawdown: maxDrawdown.toFixed(2),
      alpha: alpha.toFixed(2),
      beta: weightedBeta.toFixed(2)
    };
  }, [portfolio, portfolioValue]);

  const metricDescriptions = {
    sharpe: "Risk-adjusted return per unit of total risk. >1 is good, >2 is excellent.",
    sortino: "Like Sharpe but penalises only downside volatility. >1 is solid.",
    maxDrawdown: "Largest peak-to-trough decline. Lower is better.",
    alpha: "Excess return vs market benchmark (annualised %). Positive = outperforming.",
    beta: "Portfolio sensitivity to market moves. 1 = moves with market, >1 = more volatile."
  };

  return (
    <div style={{ borderBottom: "1px solid rgba(255,255,255,0.15)", paddingBottom: "8px" }}>
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
      </div>

      <CollapseSection title="Diversification">
        <div className="watchlist-panel glass" style={{ cursor: "default" }}>
          {themeSeries.length > 0 ? (
            <Chart options={pieOptions} series={themeSeries} type="donut" height={240} width="100%" />
          ) : (
            <p className="meta" style={{ padding: "20px" }}>No holdings to display.</p>
          )}
        </div>
      </CollapseSection>

      <CollapseSection title="Performance Chart">
        <div className="watchlist-panel glass">
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
            series={[{ name: chartMode === "percentage" ? "% Gain" : chartMode === "pnl" ? "Cash PnL" : "Portfolio Value", data: chartData }]}
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
      </CollapseSection>

      <CollapseSection title="Holdings & Performance Metrics">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>

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
                    const prevPrice = item.price && item.priceChangePercent
                      ? item.price / (1 + item.priceChangePercent / 100)
                      : item.price;
                    const positionGain = (item.price || 0) * (item.quantity || 0) - (prevPrice || 0) * (item.quantity || 0);
                    const gainPercent = item.priceChangePercent || 0;
                    return (
                      <div key={item.id} className="portfolio-card">
                        <div className="portfolio-left">
                          <div>
                            <strong>{item.symbol}</strong>
                            <div style={{ fontSize: "11px", color: "var(--color-text-secondary)" }}>{item.name}</div>
                            {item.marketType && <div className="meta">{item.marketType.toUpperCase()}</div>}
                          </div>
                        </div>
                        <div className="portfolio-center">
                          <div className="price-info">
                            <div className="price">${(item.price || 0).toFixed(2)}</div>
                            <div className={`change ${gainPercent >= 0 ? "positive" : "negative"}`}>
                              {gainPercent >= 0 ? "+" : ""}{gainPercent.toFixed(2)}%
                            </div>
                          </div>
                        </div>
                        <div className="portfolio-quantity">
                          <input
                            type="number" min="0" step="0.01"
                            value={item.quantity || 0}
                            onChange={(e) => onUpdateQuantity(item.id, parseFloat(e.target.value) || 0)}
                          />
                        </div>
                        <div className="portfolio-value">
                          <div className="position-value">${positionValue.toFixed(2)}</div>
                          <div className={`position-gain ${positionGain >= 0 ? "positive" : "negative"}`}>
                            {positionGain >= 0 ? "+" : ""}${positionGain.toFixed(2)}
                          </div>
                        </div>
                        <button className="portfolio-remove-button" onClick={() => onRemove(item.id)}>🗑️</button>
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
                  { key: "sharpe", label: "Sharpe Ratio", value: metrics.sharpe, color: parseFloat(metrics.sharpe) >= 1 ? "#22c55e" : parseFloat(metrics.sharpe) >= 0 ? "#f59e0b" : "#ef4444" },
                  { key: "sortino", label: "Sortino Ratio", value: metrics.sortino, color: parseFloat(metrics.sortino) >= 1 ? "#22c55e" : parseFloat(metrics.sortino) >= 0 ? "#f59e0b" : "#ef4444" },
                  { key: "maxDrawdown", label: "Max Drawdown", value: `${metrics.maxDrawdown}%`, color: parseFloat(metrics.maxDrawdown) < 5 ? "#22c55e" : parseFloat(metrics.maxDrawdown) < 15 ? "#f59e0b" : "#ef4444" },
                  { key: "alpha", label: "Alpha (Jensen's)", value: `${metrics.alpha}%`, color: parseFloat(metrics.alpha) >= 0 ? "#22c55e" : "#ef4444" },
                  { key: "beta", label: "Beta", value: metrics.beta, color: Math.abs(parseFloat(metrics.beta) - 1) < 0.3 ? "#38bdf8" : "#f59e0b" }
                ].map(({ key, label, value, color }) => (
                  <div key={key} style={{ borderBottom: "0.5px solid rgba(255,255,255,0.06)", paddingBottom: "12px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "4px" }}>
                      <span style={{ fontSize: "13px", color: "var(--color-text-secondary)" }}>{label}</span>
                      <span style={{ fontSize: "18px", fontWeight: 500, color }}>{value}</span>
                    </div>
                    <p style={{ margin: 0, fontSize: "11px", color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                      {metricDescriptions[key]}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p style={{ padding: "20px", color: "var(--color-text-secondary)" }}>Add holdings to see performance metrics.</p>
            )}
          </div>

        </div>
      </CollapseSection>
    </div>
  );
}