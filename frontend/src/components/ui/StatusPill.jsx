// StatusPill — shared monochrome status pill. Extracted so macro modules can reuse
// the exact same token-class pill used across AnalyticsModule (no color, Brand v2).
import React from "react";

export function StatusPill({ children, tone = "neutral" }) {
  return <span className={`analytics-status-pill ${tone}`}>{children}</span>;
}

export default StatusPill;
