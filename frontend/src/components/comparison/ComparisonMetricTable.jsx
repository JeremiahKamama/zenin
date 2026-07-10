// Reusable A | diff | B metric table. Used by every comparison section so both
// assets always share identical layout. `rows` shape:
//   { label, a, b, format?, winner?: "A"|"B"|"tie"|null, diff?, diffKind? }
// `a`/`b` are already-formatted strings OR raw numbers (format applied if provided).
import { fmtNum, fmtPct, fmtMultiple, metricDiff } from "./comparisonUtils";

function renderCell(value, format, raw) {
  if (value === "—" || value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (format === "pct") return fmtPct(value);
  if (format === "multiple") return fmtMultiple(value);
  if (format === "currency") return fmtNum(value, { currency: "USD" });
  if (format === "num") return fmtNum(value);
  return String(value);
}

export function ComparisonMetricTable({ rows, caption }) {
  return (
    <div className="cmp-metric-table" role="table" aria-label={caption || "Comparison metrics"}>
      {caption ? <div className="cmp-metric-caption">{caption}</div> : null}
      <div className="cmp-metric-head" role="row">
        <span className="cmp-col cmp-col-a">Asset A</span>
        <span className="cmp-col cmp-col-diff">Δ</span>
        <span className="cmp-col cmp-col-b">Asset B</span>
      </div>
      {rows.map((r, i) => {
        const aTxt = renderCell(r.a, r.format, "a");
        const bTxt = renderCell(r.b, r.format, "b");
        const diffTxt = r.diff !== undefined ? r.diff : metricDiff(r.a, r.b, r.diffKind || "pct");
        const win = r.winner;
        return (
          <div className="cmp-metric-row" role="row" key={i}>
            <span className={`cmp-col cmp-col-a ${win === "A" ? "cmp-win" : ""}`}>{aTxt}</span>
            <span className="cmp-col cmp-col-diff">{diffTxt}</span>
            <span className={`cmp-col cmp-col-b ${win === "B" ? "cmp-win" : ""}`}>{bTxt}</span>
          </div>
        );
      })}
    </div>
  );
}
