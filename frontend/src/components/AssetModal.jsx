import { useState, useEffect } from "react";
import Chart from "react-apexcharts";
const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";

const INTERVALS = ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"];

export function AssetModal({ asset, onClose, onConfirm, isInWatchlist, onToggleStar }) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeInterval, setActiveInterval] = useState("1D");
  const [quantity, setQuantity] = useState(1);
  const [orderType, setOrderType] = useState("buy");
  const [chartType, setChartType] = useState("line"); // 'line' or 'candlestick'

  const [performanceMap, setPerformanceMap] = useState({});

  useEffect(() => {
    fetchHistory();
    fetchPerformance();
  }, [activeInterval, asset]);

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
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

          <div className="order-type-toggle">
            <button className={`buy-selector ${orderType === 'buy' ? 'active' : ''}`} onClick={() => setOrderType('buy')}>Buy</button>
            <button className={`sell-selector ${orderType === 'sell' ? 'active' : ''}`} onClick={() => setOrderType('sell')}>Sell</button>
          </div>
        </div>

        <footer className="modal-footer">
          <div className="footer-left">
            <div className="quantity-input">
              <label>Quantity</label>
              <input type="number" value={quantity} onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)} min="0.0001" step="any" />
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
          <button className={`confirm-order-btn ${orderType}`} onClick={() => onConfirm(asset, quantity, orderType)} disabled={quantity <= 0}>
            Confirm Order
          </button>
        </footer>
      </div>
    </div>
  );
}
