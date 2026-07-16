// MacroFinancialConditionsModule — Phase 2 Financial Conditions.
//
// Chicago Fed NFCI, credit conditions, mortgage conditions, corporate borrowing,
// bank lending, liquidity. The backend /macro/timeseries is World Bank only and has
// no financial-conditions series yet, so the module renders an honest "Unavailable"
// state — never fabricated conditions (Brand v2). The NFCI code exists in
// CountryRegistry labels; when a FRED adapter wires it, this module populates
// without UI changes.

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";
import { getSeriesLabel } from "../../utils/CountryRegistry.ts";

const CONDITION_SERIES = ["nfci"];

function ConditionRow({ code }) {
  return (
    <div className="macro-fc-row" role="row">
      <span className="macro-fc-label">{getSeriesLabel(code)}</span>
      <span className="macro-fc-value">—</span>
      <StatusPill tone="neutral">Unavailable</StatusPill>
    </div>
  );
}

export function MacroFinancialConditionsModule() {
  return (
    <section className="analytics-card macro-fc-module" aria-label="Financial Conditions">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">Financial Conditions</div>
          <div className="analytics-card-subtitle">NFCI, credit, mortgage, corporate, bank lending.</div>
        </div>
        <div className="analytics-pill-group">
          <StatusPill tone="neutral">No feed</StatusPill>
        </div>
      </div>
      <div className="macro-fc-grid">
        {CONDITION_SERIES.map((code) => (
          <ConditionRow key={code} code={code} />
        ))}
      </div>
    </section>
  );
}

export default MacroFinancialConditionsModule;
