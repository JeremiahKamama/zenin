import React from "react";

/**
 * Zenin Capital Brand Logo - Ultra-thin Line Z
 * Brand System v2: pure monochrome mark, no gradients or saturated color.
 */
export function LineZMark({ className = "" }) {
  return (
    <div className={`line-z-mark ${className}`.trim()} aria-hidden="true">
      <span className="line-z-top" />
      <span className="line-z-diag" />
      <span className="line-z-bottom" />
      <span className="line-z-inner" />
    </div>
  );
}

export function ZeninLogo({ size = "md", showText = true, className = "" }) {
  const sizeClass = `line-z-mark-${size}`;
  return (
    <div className={`zenin-brand-lockup ${className}`.trim()}>
      <LineZMark className={sizeClass} />
      {showText && (
        <div className="brand-text-block">
          <strong className="brand-name">ZENIN</strong>
          <span className="brand-subtitle">CAPITAL</span>
        </div>
      )}
    </div>
  );
}
