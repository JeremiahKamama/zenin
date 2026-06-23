import { memo } from "react";

/**
 * Inline SVG sparkline for compact data-dense tables.
 *
 * Props:
 *   points    number[]    (or string[])   values left → right
 *   width     number      default 96
 *   height    number      default 28
 *   positive  boolean     true → green; false → red; undefined → neutral tone
 *   filled    boolean     default true
 *   ariaLabel string      optional
 */
function SparklineImpl({ points = [], width = 96, height = 28, positive, filled = true, ariaLabel }) {
  const values = points.filter((v) => Number.isFinite(Number(v))).map(Number);
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : 0;
  const pad = 2;
  const innerH = height - pad * 2;
  const coords = values.map((v, idx) => {
    const x = idx * stepX;
    const y = pad + innerH - ((v - min) / range) * innerH;
    return [x, y];
  });

  const linePath = coords
    .map(([x, y], idx) => (idx === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`))
    .join(" ");
  const areaPath = filled && coords.length
    ? `${linePath} L ${coords[coords.length - 1][0].toFixed(2)} ${height - pad} L ${coords[0][0].toFixed(2)} ${height - pad} Z`
    : null;

  const stroke = positive === true ? "var(--color-success)" : positive === false ? "var(--color-danger)" : "var(--color-text-muted)";
  const fill = positive === true
    ? "rgba(16, 185, 129, 0.18)"
    : positive === false
      ? "rgba(239, 68, 68, 0.18)"
      : "rgba(148, 163, 184, 0.18)";

  return (
    <svg
      className="zenin-sparkline"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      preserveAspectRatio="none"
      role={ariaLabel ? "img" : "presentation"}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
    >
      {areaPath && <path d={areaPath} fill={fill} stroke="none" />}
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export const Sparkline = memo(SparklineImpl);

export default Sparkline;
