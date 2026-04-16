const formatMacroValue = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
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
                <td className="greek">{formatMacroValue(metric.previous)}</td>
                <td style={{ color: "#e2e8f0" }}>{formatMacroValue(metric.current)}</td>
                <td style={{ color: "#38bdf8" }}>{formatMacroValue(metric.expectation)}</td>
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
