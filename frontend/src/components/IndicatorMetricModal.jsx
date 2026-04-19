import { useMemo, useState } from "react";
import { TradingViewChart } from "./TradingViewChart";

const HORIZONS = [
  { key: "1Y", label: "1Y", years: 1 },
  { key: "3Y", label: "3Y", years: 3 },
  { key: "5Y", label: "5Y", years: 5 },
  { key: "10Y", label: "10Y", years: 10 },
  { key: "MAX", label: "MAX", years: null }
];

const formatMetricValue = (value, unit) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const suffix = unit === "%" ? "%" : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${suffix}`;
};

export function IndicatorMetricModal({ countryName, metric, onClose }) {
  const [activeHorizon, setActiveHorizon] = useState("10Y");

  const series = useMemo(() => {
    const raw = Array.isArray(metric?.series) ? metric.series : [];
    return raw
      .map((point) => {
        const ts = Number(point?.ts || new Date(point?.date || "").getTime());
        const value = Number(point?.value);
        if (!Number.isFinite(ts) || !Number.isFinite(value)) return null;
        return {
          time: Math.floor(ts / 1000),
          value: value,
          x: ts, // keep x/y for trend calculations below
          y: value,
          date: point?.date || new Date(ts).toISOString()
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.x - b.x);
  }, [metric]);

  const filteredSeries = useMemo(() => {
    if (activeHorizon === "MAX") return series;
    const selected = HORIZONS.find((entry) => entry.key === activeHorizon);
    if (!selected?.years) return series;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - selected.years);
    const trimmed = series.filter((point) => point.x >= cutoff.getTime());
    return trimmed.length > 0 ? trimmed : series;
  }, [activeHorizon, series]);

  const trend = useMemo(() => {
    if (filteredSeries.length < 2) return null;
    const first = filteredSeries[0].y;
    const last = filteredSeries[filteredSeries.length - 1].y;
    const delta = last - first;
    const percent = first !== 0 ? (delta / Math.abs(first)) * 100 : null;
    return { delta, percent, first, last };
  }, [filteredSeries]);

  const chartOptions = useMemo(
    () => ({
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#94a3b8',
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      }
    }),
    []
  );

  const chartSeries = useMemo(
    () => [
      {
        name: metric?.label || "Indicator",
        data: filteredSeries,
        type: "area",
        color: "#38bdf8"
      }
    ],
    [filteredSeries, metric]
  );

  return (
    <div className="modal-overlay indicator-detail-overlay" onClick={onClose}>
      <div className="modal-content indicator-metric-modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div className="asset-info">
            <h2>{metric?.label || "Indicator"}</h2>
            <p>{countryName || "Macro indicators"}</p>
          </div>
          <button className="close-btn" onClick={onClose}>&times;</button>
        </header>

        <div className="chart-section">
          <div className="indicator-metric-summary">
            <div className="indicator-metric-stat">
              <span>Current</span>
              <strong>{formatMetricValue(metric?.current, metric?.unit)}</strong>
            </div>
            <div className="indicator-metric-stat">
              <span>Previous</span>
              <strong>{formatMetricValue(metric?.previous, metric?.unit)}</strong>
            </div>
            <div className="indicator-metric-stat">
              <span>Trend</span>
              <strong className={trend?.delta >= 0 ? "positive" : "negative"}>
                {trend
                  ? `${trend.delta >= 0 ? "+" : ""}${formatMetricValue(trend.delta, metric?.unit)}`
                  : "—"}
              </strong>
            </div>
            <div className="indicator-metric-stat">
              <span>Change</span>
              <strong className={trend?.percent >= 0 ? "positive" : "negative"}>
                {Number.isFinite(trend?.percent) ? `${trend.percent >= 0 ? "+" : ""}${trend.percent.toFixed(2)}%` : "—"}
              </strong>
            </div>
          </div>

          <div className="indicator-metric-controls">
            <div className="interval-toggle">
              {HORIZONS.map((entry) => (
                <button
                  key={entry.key}
                  className={activeHorizon === entry.key ? "active" : ""}
                  onClick={() => setActiveHorizon(entry.key)}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="chart-container">
            {filteredSeries.length > 0 ? (
              <TradingViewChart options={chartOptions} series={chartSeries} height={400} width="100%" />
            ) : (
              <div className="chart-no-data">Waiting for {String(metric?.label || "indicator")} history...</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
