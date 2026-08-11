import { TradingViewChart } from "../TradingViewChart";
import { DataHealthBadge } from "@/components/ui/async-state";

export function AssetChart({
  chartData,
  history,
  loading,
  historyStale,
  historySource,
  chartType,
  setChartType,
  visibleIndicators,
  setVisibleIndicators,
  activeInterval,
  setActiveInterval,
  intervals,
  performanceMap,
  assetPriceLines,
  tradeMarkers,
  chartExpanded,
  setChartExpanded,
  chartResetSignal,
  chartRange,
  formatChartPrice,
  formatChartVolume,
  formatChartTime,
  formatChartReadout,
  crosshairEnabled,
  compactWhenEmpty = false
}) {
  const hasHistory = history.length > 0;
  const showCompactEmpty = compactWhenEmpty && !hasHistory && !loading;
  const chartHeight = showCompactEmpty ? 152 : chartExpanded ? 440 : 300;
  const toggleIndicator = (id) =>
    setVisibleIndicators((prev) => ({ ...prev, [id]: !prev[id] }));

  return (
    <section className="am-chart-section" aria-label="Price chart">
      <div className="am-chart-toolbar">
        <div className="am-data-health">
          {historySource ? (
            <span className="am-source-chip font-mono">
              {historySource === "hyperliquid" ? "Hyperliquid" : historySource === "coingecko" ? "CoinGecko" : historySource}
            </span>
          ) : null}
          <span className={`am-health-badge ${loading ? "loading" : historyStale ? "hazard" : "ok"}`} title={loading ? "Refreshing" : historyStale ? "Delayed" : "Up to date"}>
            <DataHealthBadge status={loading ? "loading" : historyStale ? "stale" : "ok"} />
            <span className="am-health-label">{loading ? "Syncing" : historyStale ? "Stale" : "Live"}</span>
          </span>
        </div>

        {!showCompactEmpty ? <div className="am-chart-controls">
          <div className="am-type-toggle" role="group" aria-label="Chart type">
            <button className={chartType === "line" ? "active" : ""} onClick={() => setChartType("line")}>Line</button>
            <button className={chartType === "candlestick" ? "active" : ""} onClick={() => setChartType("candlestick")}>Candle</button>
          </div>
          <div className="am-ind-group" role="group" aria-label="Indicators">
            <button
              className={`am-ind-toggle ${visibleIndicators.volume ? "on" : ""}`}
              onClick={() => toggleIndicator("volume")}
              title="Volume"
            >Vol</button>
            <button
              className={`am-ind-toggle ${visibleIndicators.sma20 ? "on" : ""}`}
              onClick={() => toggleIndicator("sma20")}
              title="SMA 20"
            >SMA</button>
            <button
              className={`am-ind-toggle ${visibleIndicators.ema20 ? "on" : ""}`}
              onClick={() => toggleIndicator("ema20")}
              title="EMA 20"
            >EMA</button>
            <button
              className={`am-ind-toggle ${visibleIndicators.vwap ? "on" : ""}`}
              onClick={() => toggleIndicator("vwap")}
              title="VWAP"
            >VWAP</button>
          </div>
          <button className="am-expand-btn" onClick={() => setChartExpanded((v) => !v)} title="Expand chart">
            {chartExpanded ? "–" : "⤢"}
          </button>
        </div> : null}
      </div>

      <div
        className={`am-chart-container ${chartExpanded ? "expanded" : ""}`}
        style={{ height: `${chartHeight}px`, minHeight: `${chartHeight}px` }}
      >
        {hasHistory ? (
          <TradingViewChart
            series={chartData}
            height={chartHeight}
            width="100%"
            priceLines={assetPriceLines}
            tradeMarkers={tradeMarkers}
            valueFormatter={formatChartPrice}
            timeFormatter={formatChartTime}
            readoutFormatter={formatChartReadout}
            crosshairEnabled={crosshairEnabled}
            resetSignal={chartResetSignal}
          />
        ) : loading ? (
          <div className="am-chart-loader" aria-label="Loading chart">
            <span className="am-spinner spin">⟳</span>
          </div>
        ) : (
          <div className={showCompactEmpty ? "am-chart-empty am-chart-empty--compact" : "am-chart-empty"}>
            {showCompactEmpty ? "No chart history is available for this ETF." : "No chart data available."}
          </div>
        )}
        {loading && history.length > 0 ? (
          <div className="am-chart-refresh">
            <span className="am-spinner spin">⟳</span>
          </div>
        ) : null}
      </div>

      {chartRange && !showCompactEmpty ? (
        <div className="am-chart-range">
          <span className="am-range-label">{chartRange.label}</span>
          <span className="am-range-dates font-mono">{chartRange.start} — {chartRange.end}</span>
        </div>
      ) : null}

      {!showCompactEmpty ? <div className="am-interval-row" role="group" aria-label="Interval">
        {intervals.map((int) => {
          const perf = performanceMap[int];
          return (
            <div key={int} className="am-interval-pill">
              <button
                className={activeInterval === int ? "active" : ""}
                onClick={() => setActiveInterval(int)}
              >
                {int}
              </button>
              {perf !== undefined && (
                <span className={`am-perf-badge ${perf >= 0 ? "am-pos" : "am-neg"} font-mono`}>
                  {perf >= 0 ? "+" : ""}{perf.toFixed(2)}%
                </span>
              )}
            </div>
          );
        })}
      </div> : null}
    </section>
  );
}
