// MacroTransmissionModule — Phase 4 Cross-Asset Transmission.
//
// Shows how the current macro regime transmits across the country's asset
// classes, using the canonical cross-asset map (real symbols) + regime label.
// This is the analytical bridge the roadmap calls the "Macro Intelligence Bus":
// regime → asset-class impact. No fabricated transmission scores; the structure
// and symbol mapping are real, and impact rows render honest "Unavailable" until
// a transmission engine feeds live betas.

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";
import { getCountryCrossAssets } from "../../utils/CountryRegistry.ts";
import { getCountryCoverage } from "./MacroCoverageRegistry.js";

function transmissionFor(symbol) {
  // Reference channel by asset class — descriptive only, not a fabricated value.
  if (/USD|EUR|JPY|GBP|AUD|CAD|CHF|CNY|FX/i.test(symbol)) return "FX channel";
  if (/10Y|JGB|Bund|Yield/i.test(symbol)) return "Rates channel";
  if (/VIX/i.test(symbol)) return "Vol channel";
  return "Equity channel";
}

export function MacroTransmissionModule({ countryCode = "USA", regimeLabel = null, regimeTone = "neutral" }) {
  const symbols = getCountryCrossAssets(countryCode);
  const cov = getCountryCoverage(countryCode);
  return (
    <section className="analytics-card macro-tx-module" aria-label="Cross-Asset Transmission">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">Cross-Asset Transmission</div>
          <div className="analytics-card-subtitle">
            {cov.name} · Regime: {regimeLabel || "Unavailable"} → asset-class impact.
          </div>
        </div>
        <div className="analytics-pill-group">
          <StatusPill tone={regimeTone}>{regimeLabel ? `Regime: ${regimeLabel}` : "Unavailable"}</StatusPill>
        </div>
      </div>
      <div className="macro-tx-grid">
        {symbols.length === 0 ? (
          <div className="macro-tier-empty">Unavailable — no transmission map for this country.</div>
        ) : (
          symbols.map((s) => (
            <div key={s} className="macro-tx-row" role="row">
              <span className="macro-tx-symbol">{s}</span>
              <span className="macro-tx-channel">{transmissionFor(s)}</span>
              <StatusPill tone="neutral">Unavailable</StatusPill>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default MacroTransmissionModule;
