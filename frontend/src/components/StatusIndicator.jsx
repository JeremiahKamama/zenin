// StatusIndicator — shared semantic status primitive (Brandv2 §8, §4).
// Meaning never relies on color alone: every state carries an icon + label +
// detail text, so it survives grayscale and screen readers.
//
// Tones map to existing semantic tokens only:
//   risk     → --color-danger
//   warning  → --color-warning
//   healthy  → --color-success
//   neutral  → --color-text-secondary
// No new color literals.

const TONE_META = {
  risk: { symbol: "▲", label: "Risk", ariaLabel: "Risk" },
  warning: { symbol: "!", label: "Warning", ariaLabel: "Warning" },
  healthy: { symbol: "✓", label: "Healthy", ariaLabel: "Healthy" },
  neutral: { symbol: "•", label: "Neutral", ariaLabel: "Neutral" },
  info: { symbol: "i", label: "Info", ariaLabel: "Info" },
};

export function StatusIndicator({
  tone = "neutral",
  label,
  detail,
  icon,
  size = "md",
  className = "",
}) {
  const meta = TONE_META[tone] || TONE_META.neutral;
  return (
    <span
      className={`status-indicator status-indicator--${tone} status-indicator--${size} ${className}`}
      role="status"
    >
      <span className="status-indicator__icon" aria-hidden="true">{icon || meta.symbol}</span>
      {label ? (
        <span className="status-indicator__label">{label}</span>
      ) : null}
      {detail ? <span className="status-indicator__detail">{detail}</span> : null}
      <span className="sr-only">{meta.ariaLabel}{label ? `: ${label}` : ""}{detail ? `, ${detail}` : ""}</span>
    </span>
  );
}

export default StatusIndicator;
