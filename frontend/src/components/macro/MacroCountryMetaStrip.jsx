// MacroCountryMetaStrip — compact per-panel metadata (Objective 6).
// Country · Provider · Coverage · Updated. Monochrome tokens only.

import React from "react";
import { useMacroCountry } from "./MacroCountryContext";
import { getCountryCoverage, tierMeta } from "./MacroCoverageRegistry";
import { providerLabel } from "./MacroProviderRegistry";

function formatUpdated(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const mins = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  return `${Math.round(hrs / 24)} d ago`;
}

export function MacroCountryMetaStrip({ countryCode, exec, updatedAt }) {
  const { selectedCountry } = useMacroCountry();
  const code = countryCode || selectedCountry;
  const cov = getCountryCoverage(code);
  const tier = tierMeta(cov.tier);
  const primaryProvider = cov.providers && cov.providers.length ? cov.providers[0] : null;
  const confidence = exec && Number.isFinite(Number(exec.confidence)) ? Number(exec.confidence) : null;
  return (
    <div className="macro-country-meta-strip" role="contentinfo">
      <span className="macro-meta-item"><em>Country</em><strong>{cov.flag} {cov.name}</strong></span>
      {primaryProvider ? (
        <span className="macro-meta-item"><em>Provider</em><strong>{providerLabel(primaryProvider)}</strong></span>
      ) : null}
      <span className="macro-meta-item"><em>Coverage</em><strong className={`macro-coverage-badge ${tier.token}`}>{tier.label}</strong></span>
      {confidence != null ? <span className="macro-meta-item"><em>Confidence</em><strong>{confidence}%</strong></span> : null}
      {updatedAt ? <span className="macro-meta-item"><em>Updated</em><strong>{formatUpdated(updatedAt)}</strong></span> : null}
    </div>
  );
}

export default MacroCountryMetaStrip;
