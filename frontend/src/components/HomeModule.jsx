import { useState } from "react";
import Chart from "react-apexcharts";

export function HomeModule({
  portfolio,
  assets,
  onSelectAsset,
  calculatePortfolioValue,
  calculatePortfolioGain,
  balance = 0,
  onDeposit,
  onWithdraw
}) {
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [chartMode, setChartMode] = useState("equity"); // equity | percentage | pnl
  const [chartInterval, setChartInterval] = useState("1D");

  const topPositions = [...portfolio]
    .sort((a, b) => ((b.price || 0) * (b.quantity || 0)) - ((a.price || 0) * (a.quantity || 0)))
    .slice(0, 8);

  const allWatchlistAssets = assets.filter(a => a.price != null && a.priceChangePercent != null);
  const gainers = [...allWatchlistAssets]
    .sort((a, b) => (b.priceChangePercent || 0) - (a.priceChangePercent || 0))
    .slice(0, 5);
  const losers = [...allWatchlistAssets]
    .sort((a, b) => (a.priceChangePercent || 0) - (b.priceChangePercent || 0))
    .slice(0, 5);

  const portfolioValue = calculatePortfolioValue();
  const initialBalance = 10000;

  // Simulated chart data based on mode and interval
  const generateChartData = () => {
    const points = { "1D": 24, "1W": 7, "3M": 90, "1Y": 52, "YTD": 52, "5Y": 60, "MAX": 120 }[chartInterval] || 24;
    const now = Date.now();
    const msMap = { "1D": 3600000, "1W": 86400000, "3M": 86400000, "1Y": 604800000, "YTD": 604800000, "5Y": 2592000000, "MAX": 2592000000 };
    const step = msMap[chartInterval] || 3600000;

    return Array.from({ length: points }, (_, i) => {
      const t = now - (points - i) * step;
      const progress = i / points;
      const noise = (Math.random() - 0.48) * 0.02;
      const trend = progress * 0.15;
      const val = portfolioValue * (0.85 + trend + noise);

      if (chartMode === "equity") return [t, parseFloat(val.toFixed(2))];
      if (chartMode === "percentage") return [t, parseFloat(((val - initialBalance) / initialBalance * 100).toFixed(2))];
      if (chartMode === "pnl") return [t, parseFloat((val - initialBalance).toFixed(2))];
      return [t, val];
    });
  };

  const chartData = generateChartData();
  const isProfitable = portfolioValue >= initialBalance;

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
          <div className="value">${portfolioValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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
          <div className="value">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <div style={{ display: "flex", flex: 1, border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: "6px", overflow: "hidden" }}>
              <input
                type="number"
                placeholder="Amount"
                value={depositAmount}
                onChange={e => setDepositAmount(e.target.value)}
                style={{ flex: 1, background: "transparent", border: "none", padding: "4px 8px", fontSize: "12px", color: "var(--color-text-primary)", width: "60px" }}
              />
              <button
                onClick={() => { const amt = parseFloat(depositAmount); if (amt > 0) { onDeposit(amt); setDepositAmount(""); } }}
                style={{ padding: "4px 10px", background: "rgba(34,197,94,0.15)", border: "none", color: "#22c55e", fontSize: "12px", cursor: "pointer" }}
              >Deposit</button>
            </div>
            <div style={{ display: "flex", flex: 1, border: "0.5px solid rgba(255,255,255,0.1)", borderRadius: "6px", overflow: "hidden" }}>
              <input
                type="number"
                placeholder="Amount"
                value={withdrawAmount}
                onChange={e => setWithdrawAmount(e.target.value)}
                style={{ flex: 1, background: "transparent", border: "none", padding: "4px 8px", fontSize: "12px", color: "var(--color-text-primary)", width: "60px" }}
              />
              <button
                onClick={() => { const amt = parseFloat(withdrawAmount); if (amt > 0) { onWithdraw(amt); setWithdrawAmount(""); } }}
                style={{ padding: "4px 10px", background: "rgba(239,68,68,0.15)", border: "none", color: "#ef4444", fontSize: "12px", cursor: "pointer" }}
              >Withdraw</button>
            </div>
          </div>
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

        <Chart
          options={chartOptions}
          series={[{ name: chartMode === "percentage" ? "% Gain" : chartMode === "pnl" ? "Cash PnL" : "Portfolio Value", data: chartData }]}
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
            <h2>Top Positions</h2>
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
                      <span className="name">{asset.name}</span>
                    </div>
                    <div className="value-info">
                      <div className="price">${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="qty">{asset.quantity} Units</div>
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
          <div style={{ display: "flex", gap: "0" }}>
            
            <div style={{ flex: 1, borderRight: "0.5px solid rgba(255,255,255,0.1)" }}>
              <div className="section-header" style={{ padding: "0 0 8px" }}>
                <h2>Top Gainers</h2>
                <div className="asset-count positive">Today</div>
              </div>
              <div className="home-asset-list">
                {gainers.length > 0 ? gainers.map((asset) => (
                  <div key={asset.symbol} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info">
                      <span className="symbol">{asset.symbol}</span>
                      <span className="name">{asset.name}</span>
                    </div>
                    <div className="value-info">
                      <div className="price">${(asset.price || 0).toFixed(2)}</div>
                      <div className="change positive">+{(asset.priceChangePercent || 0).toFixed(2)}%</div>
                    </div>
                  </div>
                )) : <p className="meta" style={{ padding: "12px" }}>No data yet.</p>}
              </div>
            </div>

            <div style={{ flex: 1, paddingLeft: "12px" }}>
              <div className="section-header" style={{ padding: "0 0 8px" }}>
                <h2>Top Losers</h2>
                <div className="asset-count negative">Today</div>
              </div>
              <div className="home-asset-list">
                {losers.length > 0 ? losers.map((asset) => (
                  <div key={asset.symbol} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info">
                      <span className="symbol">{asset.symbol}</span>
                      <span className="name">{asset.name}</span>
                    </div>
                    <div className="value-info">
                      <div className="price">${(asset.price || 0).toFixed(2)}</div>
                      <div className="change negative">{(asset.priceChangePercent || 0).toFixed(2)}%</div>
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