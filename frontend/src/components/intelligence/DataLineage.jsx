// P14 Data Lineage — every number clickable → shows Source / Timestamp /
// Methodology / Calculation / Confidence / Coverage / Fallback / Historical
// Accuracy. This is a reusable utility (not a workspace tab). Enhances the
// IntelligencePanel provenance bar: each provenance item is a LineageSource that
// opens a lineage popover. No hidden calculations.

import React, { useState } from "react";
import { Badge } from "../CompactWorkspaceUI";

// A clickable provenance value. `lineage` describes how the number was derived.
export function LineageSource({ label, value, lineage }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="lineage-source">
      <button type="button" className="lineage-trigger" onClick={() => setOpen((o) => !o)} title="View data lineage">
        {value}
      </button>
      {open && lineage ? (
        <span className="lineage-popover" role="dialog">
          <strong>{label}</strong>
          <dl>
            <dt>Source</dt><dd>{lineage.source || "—"}</dd>
            <dt>Timestamp</dt><dd>{lineage.timestamp || "—"}</dd>
            <dt>Methodology</dt><dd>{lineage.methodology || "—"}</dd>
            <dt>Calculation</dt><dd>{lineage.calculation || "—"}</dd>
            <dt>Confidence</dt><dd>{lineage.confidence != null ? `${lineage.confidence}%` : "—"}</dd>
            <dt>Coverage</dt><dd>{lineage.coverage != null ? `${lineage.coverage}%` : "—"}</dd>
            <dt>Fallback</dt><dd>{lineage.fallback || "—"}</dd>
            <dt>Historical Accuracy</dt><dd>{lineage.historicalAccuracy || "—"}</dd>
          </dl>
        </span>
      ) : null}
    </span>
  );
}

// Compact lineage chip for inline use in panels.
export function LineageChip({ provider, coverage, confidence }) {
  return (
    <Badge tone="info" title={`Source: ${provider || "—"} · Coverage: ${coverage ?? "—"}% · Confidence: ${confidence ?? "—"}%`}>
      {provider || "Source"}
    </Badge>
  );
}

export default LineageSource;
