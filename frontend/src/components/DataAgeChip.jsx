import { memo, useEffect, useState } from "react";

/**
 * DataAgeChip — small colored dot + relative-time label for age-of-data UX.
 *
 * Props:
 *   fetchedAt   ISO string | Date | number (ms)
 *   label       optional override text (default: relative time)
 *   className   additional class
 *
 * Tone:
 *   green  ≤ 1 min
 *   amber  ≤ 5 min
 *   red    > 5 min
 */
function DataAgeChipImpl({ fetchedAt, label, className = "" }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  const date = toDate(fetchedAt);
  if (!date) return null;
  const ageMs = Math.max(0, now - date.getTime());
  const ageMins = Math.round(ageMs / 60000);
  const tone = ageMins <= 1 ? "fresh" : ageMins <= 5 ? "stale" : "hazard";

  const display = label || (ageMins < 1 ? "just now" : `${ageMins}m ago`);
  const title = `Data fetched ${date.toLocaleTimeString()}`;

  return (
    <span
      className={`data-age-chip data-age-chip--${tone} ${className}`}
      title={title}
      aria-label={title}
    >
      {/* dot */}
      <i aria-hidden="true" />
      {/* label */}
      <span>{display}</span>
    </span>
  );
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const n = Number(value);
  const d = Number.isNaN(n) ? new Date(value).getTime() : n;
  if (Number.isNaN(d)) return null;
  return new Date(d);
}

export const DataAgeChip = memo(DataAgeChipImpl);
export default DataAgeChip;
