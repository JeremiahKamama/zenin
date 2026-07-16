// MacroDriverRail — compact macro-intelligence rail for non-macro surfaces
// (Company / Commodity / ETF workspaces, Portfolio, Transmission Explorer).
//
// Reuses the SAME IntelligenceBus signal the Macro workspace publishes, so every
// asset kind consumes identical macro intelligence (spec: no duplicated macro
// implementations). Honest empty state when no regime is published.

import React from "react";
import { useRegimeIntelligence } from "../portfolioIntelligence/useRegimeIntelligence";
import { IntelligenceBus } from "../../utils/intelligenceBus";
import { StatusPill } from "../ui/StatusPill.jsx";

export function MacroDriverRail({ compact = false }) {
  const { regime, freshness } = useRegimeIntelligence();
  const label = regime?.label || null;
  const sectors = IntelligenceBus.affectedSectors(label);
  const commodities = IntelligenceBus.affectedCommodities(label);

  if (!label) {
    return (
      <section className="analytics-card macro-driver-rail" aria-label="Macro Drivers">
        <div className="macro-tier-head">
          <div className="analytics-section-title">Macro Drivers</div>
        </div>
        <p className="macro-tier-empty">No macro regime published — drivers unavailable.</p>
      </section>
    );
  }

  return (
    <section className="analytics-card macro-driver-rail" aria-label="Macro Drivers">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">Macro Drivers</div>
          <div className="analytics-card-subtitle">Regime: {label}{freshness ? ` · ${freshness}` : ""}</div>
        </div>
        <div className="analytics-pill-group">
          <StatusPill tone={regime?.tone || "neutral"}>{label}</StatusPill>
        </div>
      </div>
      {!compact ? (
        <div className="macro-driver-body">
          <div className="macro-driver-col">
            <em>Sectors</em>
            {sectors.length ? sectors.map((s) => (
              <div key={s.label} className="macro-driver-row">
                <span>{s.label}</span>
                <StatusPill tone={s.direction === "up" ? "positive" : s.direction === "down" ? "negative" : "neutral"}>{s.direction}</StatusPill>
              </div>
            )) : <span className="macro-tier-empty">—</span>}
          </div>
          <div className="macro-driver-col">
            <em>Commodities</em>
            {commodities.length ? commodities.map((c) => (
              <div key={c.group} className="macro-driver-row">
                <span>{c.group}</span>
                <StatusPill tone={c.direction === "up" ? "positive" : "negative"}>{c.direction}</StatusPill>
              </div>
            )) : <span className="macro-tier-empty">—</span>}
          </div>
        </div>
      ) : (
        <p className="macro-driver-compact">{sectors.map((s) => s.label).join(", ") || "—"}</p>
      )}
    </section>
  );
}

export default MacroDriverRail;
