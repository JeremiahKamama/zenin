import { useMemo, useState } from "react";
import { TradingViewChart } from "./TradingViewChart";
import { getAppRuntimeConfig } from "../config/runtimeConfigStore";
import { chartColors } from "../utils/chartTheme";

const formatMetricValue = (value, unit) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const suffix = unit === "%" ? "%" : "";
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}${suffix}`;
};

export function IndicatorMetricModal({ countryName, metric, onClose }) {
  const horizons = Array.isArray(getAppRuntimeConfig()?.ui?.indicatorMetricHorizons)
    ? getAppRuntimeConfig().ui.indicatorMetricHorizons
    : [
      { key: "1Y", label: "1Y", years: 1 },
      { key: "3Y", label: "3Y", years: 3 },
      { key: "5Y", label: "5Y", years: 5 },
      { key: "10Y", label: "10Y", years: 10 },
      { key: "MAX", label: "MAX", years: null }
    ];
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
    const selected = horizons.find((entry) => entry.key === activeHorizon);
    if (!selected?.years) return series;
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - selected.years);
    const trimmed = series.filter((point) => point.x >= cutoff.getTime());
    return trimmed.length > 0 ? trimmed : series;
  }, [activeHorizon, horizons, series]);

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
        textColor: chartColors.muted(),
      },
      rightPriceScale: {
        borderVisible: false,
      },
      timeScale: {
        borderVisible: false,
      },
      grid: {
        vertLines: { color: 'rgba(160, 160, 160, 0.08)' },
        horzLines: { color: 'rgba(160, 160, 160, 0.08)' },
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
        color: "var(--color-data-primary)"
      }
    ],
    [filteredSeries, metric]
  );

  return (
    <div className="modal-overlay indicator-detail-overlay" onClick={onClose}>
      <div className="modal-content indicator-metric-modal" onClick={(event) => event.stopPropagation()}>
        <header className="modal-header yahoo-header">
          <div className="asset-info-yahoo">
            <div className="asset-title-row">
              <h2 className="yahoo-name">{metric?.label || "Indicator"} ({countryName || "Macro"})</h2>
              <button className="close-btn" onClick={onClose}>&times;</button>
            </div>
            
            <div className="yahoo-price-row">
              <span className="yahoo-price">
                {formatMetricValue(metric?.current, metric?.unit)}
              </span>
              <span className={`yahoo-change ${trend?.delta >= 0 ? "positive" : "negative"}`}>
                {trend?.delta >= 0 ? "+" : ""}{formatMetricValue(trend?.delta, metric?.unit)}
                ({trend?.percent >= 0 ? "+" : ""}{trend?.percent?.toFixed(2)}%)
              </span>
            </div>

            <div className="yahoo-market-status">
              Latest update as of {metric?.date || "Recently"}.
            </div>
          </div>
        </header>

        <div className="chart-section">
          <div className="indicator-metric-controls">
            <div className="interval-toggle">
              {horizons.map((entry) => (
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
