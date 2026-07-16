// MacroCountryProfileModule — Phase 5 Country Profile.
//
// Real per-country reference profile: currency, timezone, providers, coverage
// tier, and cross-asset map. All sourced from CountryRegistry / MacroCoverageRegistry
// (reference data, no fabricated values). Reacts to the selected country.

import React from "react";
import { getCountryMeta, getCountryCrossAssets } from "../../utils/CountryRegistry.ts";
import { getCountryCoverage, tierMeta } from "./MacroCoverageRegistry.js";

export function MacroCountryProfileModule({ countryCode = "USA" }) {
  const meta = getCountryMeta(countryCode);
  const cov = getCountryCoverage(countryCode);
  const tier = tierMeta(cov.tier);
  const cross = getCountryCrossAssets(countryCode);
  return (
    <section className="analytics-card macro-country-profile" aria-label="Country Profile">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">Country Profile</div>
          <div className="analytics-card-subtitle">{cov.flag} {cov.name}</div>
        </div>
      </div>
      <div className="macro-cp-grid">
        <div className="macro-cp-item"><em>Currency</em><strong>{meta.currency}</strong></div>
        <div className="macro-cp-item"><em>Timezone</em><strong>{meta.timezone}</strong></div>
        <div className="macro-cp-item"><em>Coverage</em><strong className={`macro-coverage-badge ${tier.token}`}>{tier.label}</strong></div>
        <div className="macro-cp-item"><em>Providers</em><strong>{(cov.providers || []).join(" · ")}</strong></div>
      </div>
      <div className="macro-cp-cross">
        <em>Cross-asset map</em>
        <div className="macro-cp-chips">
          {cross.length === 0 ? <span className="macro-cp-chip muted">—</span> : cross.map((s) => (
            <span key={s} className="macro-cp-chip">{s}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export default MacroCountryProfileModule;
