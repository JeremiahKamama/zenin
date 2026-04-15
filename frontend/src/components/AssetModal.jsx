import { useState, useEffect, useMemo } from "react";
import Chart from "react-apexcharts";
const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

const INTERVALS = ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"];

export function AssetModal({ asset, onClose, onConfirm, isInWatchlist, onToggleStar, portfolio = [], balance = 0 }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeInterval, setActiveInterval] = useState("1D");
  const [orderType, setOrderType] = useState(() => asset?._forceSell ? "sell" : "buy");
  const [earnings, setEarnings] = useState(null);
  const [earningsLoading, setEarningsLoading] = useState(false);

  const isTradFi = asset && asset.type !== "crypto" && !asset.marketType;

// ✅ ADD THIS (missing state causing crash)
const [chartType, setChartType] = useState("line");


const [quantity, setQuantity] = useState(() =>  {
    if (!asset?._forceSell) return 1;
    const holding = (portfolio || []).find(
      p => p.symbol === asset?.symbol &&
      (p.marketType || "spot") === (asset?.marketType || "spot")
    );
    return holding?.quantity || 1;
  }); // 'line' or 'candlestick'

  const [performanceMap, setPerformanceMap] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shake, setShake] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const [showFireworks, setShowFireworks] = useState(false);

useEffect(() => {
    fetchHistory();
    fetchPerformance();
    if (isTradFi) fetchEarnings();
  }, [activeInterval, asset]);

  const fetchEarnings = async () => {
    setEarningsLoading(true);
    try {
      const res = await fetch(`${BACKEND_URL}/earnings?symbol=${encodeURIComponent(asset.symbol)}`);
      const data = await res.json();
      if (!data.error) setEarnings(data);
    } catch (err) {
      console.error("Failed to fetch earnings:", err);
    } finally {
      setEarningsLoading(false);
    }
  };

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const type = asset.type || (asset.marketType ? "crypto" : "stock");
      const res = await fetch(
        `${BACKEND_URL}/history?symbol=${asset.symbol}&type=${type}&interval=${activeInterval}`
      );
      const data = await res.json();
      setHistory(data.history || []);
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPerformance = async () => {
    try {
      const type = asset.type || (asset.marketType ? "crypto" : "stock");
      const res = await fetch(`${BACKEND_URL}/interval-performance?symbol=${asset.symbol}&type=${type}`);
      const data = await res.json();
      setPerformanceMap(data.performance || {});
    } catch (err) {
      console.error("Failed to fetch performance summary:", err);
    }
  };

  const totalValue = (asset.price || 0) * (quantity || 0);
  const availableBalance = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  const insufficientBalance = orderType === "buy" && totalValue > availableBalance;
  const confettiPieces = useMemo(() => Array.from({ length: 26 }, (_, i) => i), []);
  const fireworkBursts = useMemo(() => Array.from({ length: 18 }, (_, i) => i), []);

  const playKaching = () => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const now = ctx.currentTime;
      const notes = [880, 1320, 1760];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.12, now + 0.015 + idx * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 + idx * 0.025);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.03);
        osc.stop(now + 0.22 + idx * 0.03);
      });
      setTimeout(() => ctx.close().catch(() => {}), 380);
    } catch {
      // no-op for unsupported environments
    }
  };

  const triggerInsufficientFeedback = () => {
    setShake(true);
    setTimeout(() => setShake(false), 560);
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate([90, 55, 90]);
    }
  };

  const handleConfirmOrder = async () => {
    if (isSubmitting || quantity <= 0) return;
    setIsSubmitting(true);
    const result = await onConfirm?.(cleanAsset, quantity, orderType);
    setIsSubmitting(false);

    if (!result?.ok) {
      if (result?.reason === "insufficient_balance") {
        triggerInsufficientFeedback();
      }
      return;
    }

    if (result?.action === "buy") {
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 1200);
      setTimeout(() => onClose?.(), 900);
      return;
    }

    if (result?.action === "sell") {
      playKaching();
      setShowFireworks(true);
      setTimeout(() => setShowFireworks(false), 1200);
      setTimeout(() => onClose?.(), 950);
      return;
    }

    onClose?.();
  };

  const getChartData = () => {
    if (chartType === "candlestick") {
      return [{
        data: history.map(h => ({
          x: new Date(h.time),
          y: [h.open, h.high, h.low, h.close]
        }))
      }];
    }
    return [{
      name: "Price",
      data: history.map(h => ({
        x: new Date(h.time),
        y: h.close || h.price
      }))
    }];
  };

  const chartOptions = {
    chart: {
      type: chartType,
      toolbar: { show: false },
      sparkline: { enabled: false },
      animations: { enabled: true },
      background: 'transparent'
    },
    theme: { mode: "dark" },
    grid: {
      show: true,
      borderColor: "rgba(255, 255, 255, 0.05)",
      strokeDashArray: 4,
      xaxis: { lines: { show: false } },
      yaxis: { lines: { show: true } },
      padding: { top: 0, right: 0, bottom: 20, left: 0 }
    },
    xaxis: {
      type: "datetime",
      labels: {
        show: true,
        style: { colors: "#64748b", fontSize: "10px" },
        datetimeUTC: false,
      },
      axisBorder: { show: false },
      axisTicks: { show: false },
      crosshairs: {
        show: true,
        width: 1,
        position: 'back',
        stroke: { color: '#ffffff', width: 1, dashArray: 0 },
      },
    },
    yaxis: {
      opposite: true,
      floating: true,
      tickAmount: 6,
      labels: {
        show: true,
        offsetX: -10,
        style: { colors: "#94a3b8", fontSize: "11px", fontWeight: 600 },
        formatter: (val) => `$${val.toFixed(2)}`
      }
    },
    stroke: {
      curve: "smooth",
      width: 1.5,
      colors: chartType === "line" ? ["#94a3b8"] : undefined
    },
    markers: { size: 0, hover: { size: 5 } },
    tooltip: {
      theme: "dark",
      shared: true,
      intersect: false,
      x: { show: true, format: 'dd MMM yyyy, HH:mm' },
      y: {
        formatter: (val) => `$${val.toFixed(2)}`,
        title: { formatter: () => "Price :" }
      },
      marker: { show: false },
    },
    plotOptions: {
      candlestick: {
        colors: {
          upward: "#22c55e",
          downward: "#ef4444"
        }
      }
    }
  };

  if (!asset) return null;
    const cleanAsset = { ...asset };
    delete cleanAsset._forceSell;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className={`modal-content ${shake ? "modal-shake" : ""}`} onClick={(e) => e.stopPropagation()}>
        {showConfetti && (
          <div className="trade-effect-layer confetti-layer">
            {confettiPieces.map((idx) => (
              <span key={`confetti-${idx}`} className="confetti-piece" style={{ "--i": idx }} />
            ))}
          </div>
        )}
        {showFireworks && (
          <div className="trade-effect-layer fireworks-layer">
            {fireworkBursts.map((idx) => (
              <span key={`fire-${idx}`} className="firework-burst" style={{ "--i": idx }} />
            ))}
          </div>
        )}
        <header className="modal-header">
          <div className="asset-info">
            <h2>{asset.symbol}</h2>
            <p>{asset.name}</p>
          </div>
          <div className="modal-header-actions">
            <button
              className="modal-remove-btn"
              onClick={() => onToggleStar?.(asset)}
              title={isInWatchlist?.(asset.symbol, asset.marketType) ? "Remove from watchlist" : "Add to watchlist"}
            >
              {isInWatchlist?.(asset.symbol, asset.marketType) ? "Remove" : "Add"}
            </button>
            <button className="close-btn" onClick={onClose}>&times;</button>
          </div>
        </header>

        <div className="chart-section">
          <div className="chart-header-controls">
            <div className="asset-price-mini">
              <span className="price">${asset.price?.toFixed(2)}</span>
              <span className={`change ${asset.priceChangePercent >= 0 ? "positive" : "negative"}`}>
                {asset.priceChangePercent >= 0 ? "+" : ""}{asset.priceChangePercent?.toFixed(2)}%
              </span>
            </div>
            <div className="chart-type-toggle">
              <button className={chartType === 'line' ? 'active' : ''} onClick={() => setChartType('line')}>Line</button>
              <button className={chartType === 'candlestick' ? 'active' : ''} onClick={() => setChartType('candlestick')}>Candle</button>
            </div>
          </div>

          <div className="chart-container">
            {loading ? (
              <div className="chart-loading">Loading market data...</div>
            ) : history.length > 0 ? (
              <Chart options={chartOptions} series={getChartData()} type={chartType} height="400" width="100%" />
            ) : (
              <div className="chart-no-data">No historical data available for this range.</div>
            )}
          </div>

          <div className="interval-toggle-bottom">
            <div className="interval-toggle">
              {INTERVALS.map((int) => {
                const perf = performanceMap[int];
                return (
                  <div key={int} className="interval-btn-wrapper">
                    <button
                      className={activeInterval === int ? "active" : ""}
                      onClick={() => setActiveInterval(int)}
                    >
                      {int}
                    </button>
                    {perf !== undefined && (
                      <span className={`performance-badge ${perf >= 0 ? "positive" : "negative"}`}>
                        {perf >= 0 ? "+" : ""}{perf.toFixed(2)}%
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

{isTradFi && (
            <div style={{ padding: "0 32px 16px" }}>
              {earningsLoading ? (
                <div style={{ fontSize: "12px", color: "#64748b", textAlign: "center", padding: "8px" }}>
                  Loading fundamentals...
                </div>
              ) : earnings ? (
                <div style={{ border: "1px solid rgba(148,163,184,0.12)", borderRadius: "10px", overflow: "hidden" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
                    <thead>
                      <tr style={{ background: "rgba(148,163,184,0.06)" }}>
                        <th style={{ padding: "8px 12px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Metric</th>
                        <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Consensus</th>
                        <th style={{ padding: "8px 12px", textAlign: "right", color: "#64748b", fontWeight: 600, fontSize: "11px", textTransform: "uppercase", letterSpacing: "0.04em" }}>Previous</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>EPS</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#f1f5f9", fontWeight: 600 }}>
                          {earnings.eps?.consensus != null ? `$${Number(earnings.eps.consensus).toFixed(2)}` : "—"}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#94a3b8" }}>
                          {earnings.eps?.previous != null ? `$${Number(earnings.eps.previous).toFixed(2)}` : "—"}
                        </td>
                      </tr>
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>Revenue</td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#f1f5f9", fontWeight: 600 }}>
                          {earnings.revenue?.consensus != null
                            ? `$${(Number(earnings.revenue.consensus) / 1e9).toFixed(2)}B`
                            : "—"}
                        </td>
                        <td style={{ padding: "8px 12px", textAlign: "right", color: "#94a3b8" }}>
                          {earnings.revenue?.previous != null
                            ? `$${(Number(earnings.revenue.previous) / 1e9).toFixed(2)}B`
                            : "—"}
                        </td>
                      </tr>
                      <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                        <td style={{ padding: "8px 12px", color: "#94a3b8" }}>Market Cap</td>
                        <td colSpan={2} style={{ padding: "8px 12px", textAlign: "right", color: "#f1f5f9", fontWeight: 600 }}>
                          {earnings.marketCap != null
                            ? earnings.marketCap >= 1e12
                              ? `$${(earnings.marketCap / 1e12).toFixed(2)}T`
                              : `$${(earnings.marketCap / 1e9).toFixed(2)}B`
                            : "—"}
                        </td>
                      </tr>
                      {earnings.targetPrice != null && (
                        <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                          <td style={{ padding: "8px 12px", color: "#94a3b8" }}>Analyst Target</td>
                          <td colSpan={2} style={{ padding: "8px 12px", textAlign: "right" }}>
                            <span style={{ color: "#38bdf8", fontWeight: 600 }}>${Number(earnings.targetPrice).toFixed(2)}</span>
                            {earnings.analystRating && (
                              <span style={{
                                marginLeft: "8px", fontSize: "10px", padding: "2px 6px", borderRadius: "4px", fontWeight: 700, textTransform: "uppercase",
                                background: earnings.analystRating.includes("buy") ? "rgba(34,197,94,0.15)" : earnings.analystRating.includes("sell") ? "rgba(239,68,68,0.15)" : "rgba(148,163,184,0.1)",
                                color: earnings.analystRating.includes("buy") ? "#22c55e" : earnings.analystRating.includes("sell") ? "#ef4444" : "#94a3b8"
                              }}>
                                {earnings.analystRating.replace(/_/g, " ")}
                                {earnings.analystCount ? ` (${earnings.analystCount})` : ""}
                              </span>
                            )}
                          </td>
                        </tr>
                      )}
                      {earnings.nextEarnings && (
                        <tr style={{ borderTop: "1px solid rgba(148,163,184,0.08)" }}>
                          <td style={{ padding: "8px 12px", color: "#94a3b8" }}>Next Earnings</td>
                          <td colSpan={2} style={{ padding: "8px 12px", textAlign: "right", color: "#f59e0b", fontWeight: 600, fontSize: "11px" }}>
                            {earnings.nextEarnings}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}

          <div className="order-type-toggle">
            <button className={`buy-selector ${orderType === 'buy' ? 'active' : ''}`} onClick={() => setOrderType('buy')}>Buy</button>
            <button className={`sell-selector ${orderType === 'sell' ? 'active' : ''}`} onClick={() => setOrderType('sell')}>Sell</button>
          </div>
        </div>
        {orderType === "sell" && (() => {
            const holding = portfolio.find(
              p => p.symbol === asset.symbol &&
              (p.marketType || "spot") === (asset.marketType || "spot")
            );
            const holdingQty = holding?.quantity || 0;
            const holdingValue = holdingQty * (asset.price || 0);
            return holdingQty > 0 ? (
              <div style={{ padding: "8px 0", fontSize: "13px", color: "var(--color-text-secondary)" }}>
                Your position: <strong style={{ color: "var(--color-text-primary)" }}>
                  {holdingQty} {asset.symbol}
                </strong> <span>(${holdingValue.toFixed(2)})</span>
                {" · "}Max sell: <strong style={{ color: "var(--color-text-danger)" }}>{holdingQty}</strong>
              </div>
            ) : (
              <div style={{ padding: "8px 0", fontSize: "13px", color: "var(--color-text-danger)" }}>
                You don't hold any {asset.symbol}.
              </div>
            );
          })()}
        {orderType === "buy" && (
          <div
            style={{
              padding: "8px 0",
              fontSize: "13px",
              color: insufficientBalance ? "var(--color-text-danger)" : "var(--color-text-secondary)"
            }}
          >
            Available balance: <strong style={{ color: insufficientBalance ? "var(--color-text-danger)" : "var(--color-text-primary)" }}>
              ${availableBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </strong>
            {insufficientBalance ? (
              <span style={{ marginLeft: "8px" }}>
                · Need ${(totalValue - availableBalance).toFixed(2)} more
              </span>
            ) : null}
          </div>
        )}
        <footer className="modal-footer">
          <div className="footer-left">
            <div className="quantity-input">
              <label>Quantity</label>
              <input
                  type="number"
                  value={quantity}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value) || 0;
                    if (orderType === "sell") {
                      const holding = portfolio.find(
                        p => p.symbol === asset.symbol &&
                        (p.marketType || "spot") === (asset.marketType || "spot")
                      );
                      const max = holding?.quantity || 0;
                      setQuantity(Math.min(val, max));
                    } else {
                      setQuantity(val);
                    }
                  }}
                  min="0.0001"
                  max={orderType === "sell" ? (portfolio.find(p => p.symbol === asset.symbol)?.quantity || 0) : undefined}
                  step="any"
                />
            </div>
            <div className="total-value-display">
              <label>Total Value ($)</label>
              <div className="value-field">
                <input type="number" value={totalValue.toFixed(2)} onChange={(e) => {
                  const newVal = parseFloat(e.target.value) || 0;
                  if (asset.price > 0) setQuantity(newVal / asset.price);
                }} step="0.01" />
              </div>
            </div>
          </div>
	          <button className={`confirm-order-btn ${orderType}`} onClick={handleConfirmOrder} disabled={quantity <= 0 || isSubmitting}>
	            {isSubmitting ? "Submitting..." : "Confirm Order"}
	          </button>
	        </footer>
      </div>
    </div>
  );
}
