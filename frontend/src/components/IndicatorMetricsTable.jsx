const formatMacroValue = (value, key = "") => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";

  // Truncate large values for Balance of Trade
  if (key === "balance_of_trade" || String(key).toLowerCase().includes("balance of trade")) {
    const abs = Math.abs(n);
    if (abs >= 1e9) {
      return (n / 1e9).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "B";
    }
    if (abs >= 1e6) {
      return (n / 1e6).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "M";
    }
  }

  return n.toLocaleString(undefined, { maximumFractionDigits: 3 });
};

const formatMetricDate = (value) => {
  if (!value) return "—";
  const str = String(value).trim();
  // World Bank series are year-granularity (e.g. "2025"). new Date("2025")
  // parses as Jan 1 of that year, so show the year directly instead of "01/01".
  if (/^\d{4}$/.test(str)) return str;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  const day = String(parsed.getDate()).padStart(2, "0");
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
};

const resolveMetricDates = (metric = {}, snapshot = {}) => {
  const series = Array.isArray(metric?.series) ? metric.series : [];
  const previousPoint = series.length > 1 ? series[series.length - 2] : null;
  const currentPoint = series.length > 0 ? series[series.length - 1] : null;
  return {
    previous: metric?.previousAsOf || previousPoint?.date || null,
    current: metric?.currentAsOf || metric?.asOf || currentPoint?.date || snapshot?.updatedAt || null,
    expected: metric?.expectationAsOf || snapshot?.updatedAt || metric?.asOf || currentPoint?.date || null,
  };
};

export function IndicatorMetricsTable({ snapshot, onSelectMetric }) {
  const metrics = Array.isArray(snapshot?.metrics) ? snapshot.metrics : [];
  const firstDates = resolveMetricDates(metrics[0] || {}, snapshot);

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div className="table-scroll">
        <table className="option-chain-table indicator-metrics-table" style={{ minWidth: "620px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Indicator</th>
              <th><div className="indicator-metric-header"><span>Previous</span><small>{formatMetricDate(firstDates.previous)}</small></div></th>
              <th><div className="indicator-metric-header"><span>Current</span><small>{formatMetricDate(firstDates.current)}</small></div></th>
              <th><div className="indicator-metric-header"><span>Expected</span><small>{formatMetricDate(firstDates.expected)}</small></div></th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => {
              const metricDates = resolveMetricDates(metric, snapshot);
              return (
                <tr
                  key={metric.key}
                  className={onSelectMetric ? "indicator-metric-row clickable" : ""}
                  onClick={onSelectMetric ? () => onSelectMetric(metric) : undefined}
                >
                  <td style={{ textAlign: "left", color: "var(--color-data-slate-bright)", fontWeight: 600 }}>
                    <div className="indicator-metric-cell">
                      <span>{metric.label}</span>
                      {metric.unit ? <small>{metric.unit}</small> : null}
                    </div>
                  </td>
                  <td className="greek">
                    <div className="indicator-metric-value-cell">
                      <span>{formatMacroValue(metric.previous, metric.key)}</span>
                      <small>{formatMetricDate(metricDates.previous)}</small>
                    </div>
                  </td>
                  <td style={{ color: "var(--color-data-slate-bright)" }}>
                    <div className="indicator-metric-value-cell">
                      <span>{formatMacroValue(metric.current, metric.key)}</span>
                      <small>{formatMetricDate(metricDates.current)}</small>
                    </div>
                  </td>
                  <td style={{ color: "var(--color-data-primary)" }}>
                    <div className="indicator-metric-value-cell">
                      <span>{formatMacroValue(metric.expectation, metric.key)}</span>
                      <small>{formatMetricDate(metricDates.expected)}</small>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: "var(--fs-sm)", color: "var(--color-data-slate-dim)" }}>
        Source: {snapshot?.source || "EODHD"}
        {snapshot?.updatedAt ? ` · Updated ${new Date(snapshot.updatedAt).toLocaleString()}` : ""}
      </div>
    </div>
  );
}
