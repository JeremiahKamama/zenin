// MacroCrossAssetModule — Phase 4 Cross-Asset Dashboard.
//
// Shows the country's cross-asset map (equity index, sovereign bond, FX, vol)
// from the canonical CROSS_ASSET_BY_COUNTRY registry. These are real reference
// symbols (no fabricated prices). When a live price feed is wired, each row
// populates from getCrossAssets(); until then rows render honest "Unavailable".

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";
import { getCountryCrossAssets } from "../../utils/CountryRegistry.ts";
import { getCountryCoverage } from "./MacroCoverageRegistry.js";

function AssetRow({ symbol }) {
  return (
    <div className="macro-ca-row" role="row">
      <span className="macro-ca-symbol">{symbol}</span>
      <span className="macro-ca-price">—</span>
      <StatusPill tone="neutral">Unavailable</StatusPill>
    </div>
  );
}

export function MacroCrossAssetModule({ countryCode = "USA" }) {
  const symbols = getCountryCrossAssets(countryCode);
  const cov = getCountryCoverage(countryCode);
  return (
    <section className="analytics-card macro-ca-module" aria-label="Cross-Asset Dashboard">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">Cross-Asset Dashboard</div>
          <div className="analytics-card-subtitle">{cov.name} · equity · rates · FX · vol map.</div>
        </div>
        <div className="analytics-pill-group">
          <StatusPill tone="neutral">No feed</StatusPill>
        </div>
      </div>
      <div className="macro-ca-grid">
        {symbols.length === 0 ? (
          <div className="macro-tier-empty">Unavailable — no cross-asset map for this country.</div>
        ) : (
          symbols.map((s) => <AssetRow key={s} symbol={s} />)
        )}
      </div>
    </section>
  );
}

export default MacroCrossAssetModule;
