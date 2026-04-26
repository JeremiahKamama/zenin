const formatMacroValue = (value, key = "") => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";

  // Truncate large values for Balance of Trade
  if (key === "balance_of_trade") {
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

export function IndicatorMetricsTable({ snapshot, onSelectMetric }) {
  const metrics = Array.isArray(snapshot?.metrics) ? snapshot.metrics : [];

  return (
    <div style={{ display: "grid", gap: "10px" }}>
      <div className="table-scroll">
        <table className="option-chain-table indicator-metrics-table" style={{ minWidth: "620px" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left" }}>Indicator</th>
              <th>Previous</th>
              <th>Current</th>
              <th>Expected</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((metric) => (
              <tr
                key={metric.key}
                className={onSelectMetric ? "indicator-metric-row clickable" : ""}
                onClick={onSelectMetric ? () => onSelectMetric(metric) : undefined}
              >
                <td style={{ textAlign: "left", color: "#e2e8f0", fontWeight: 600 }}>
                  <div className="indicator-metric-cell">
                    <span>{metric.label}</span>
                    {metric.unit ? <small>{metric.unit}</small> : null}
                  </div>
                </td>
                <td className="greek">{formatMacroValue(metric.previous, metric.key)}</td>
                <td style={{ color: "#e2e8f0" }}>{formatMacroValue(metric.current, metric.key)}</td>
                <td style={{ color: "#38bdf8" }}>{formatMacroValue(metric.expectation, metric.key)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: "11px", color: "#64748b" }}>
        Source: {snapshot?.source || "EODHD"}
        {snapshot?.updatedAt ? ` · Updated ${new Date(snapshot.updatedAt).toLocaleString()}` : ""}
      </div>
    </div>
  );
}
