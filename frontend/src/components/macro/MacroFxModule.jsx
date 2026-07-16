// MacroFxModule — Phase 2 FX Intelligence (compact, first-class macro theme).
//
// Sections: Spot FX (major pairs) · Dollar Dashboard (DXY/broad/real) · FX Carry
// (top carry trades) · FX Heatmap (regional strength). All driven by
// CountryRegistry.fx taxonomy so a country switch reloads real datasets without
// reloading the desk. Provider-agnostic via macro/adapters — no Yahoo/FRED logic
// in this component.
//
// Honest states: the backend /macro/timeseries surface is World Bank only, so live
// FX spot (Yahoo) is not yet resolvable → pairs render "Unavailable" until the Yahoo
// adapter is wired in the backend. The structure, labels, and country reactivity are
// real and ready; no fabricated rates.

import React from "react";
import { StatusPill } from "../ui/StatusPill.jsx";
import { getCountryMeta, getSeriesLabel } from "../../utils/CountryRegistry.ts";
import { fetchMacroSeriesBatch } from "../../utils/macro/adapters.js";
import { resolveIndicatorCode } from "../../utils/macro/seriesResolver.js";

const REGIONAL_CURRENCIES = ["USD", "EUR", "JPY", "GBP", "AUD", "CAD", "CHF", "CNY"];

function lastValue(points) {
  if (!Array.isArray(points) || !points.length) return null;
  for (let i = points.length - 1; i >= 0; i--) {
    if (Number.isFinite(Number(points[i]?.v))) return Number(points[i].v);
  }
  return null;
}

function FxSpotRow({ code, series, currency }) {
  const pts = series?.points;
  const v = lastValue(pts);
  const available = Array.isArray(pts) && pts.length > 0;
  return (
    <div className="macro-fx-row" role="row">
      <span className="macro-fx-pair">{getSeriesLabel(code)}</span>
      <span className="macro-fx-value">{available && v != null ? v.toFixed(4) : "—"}</span>
      <StatusPill tone={available ? "neutral" : "negative"}>{available ? "Live" : "Unavailable"}</StatusPill>
    </div>
  );
}

export function MacroFxModule({ countryCode = "USA", baseUrl = "" }) {
  const meta = getCountryMeta(countryCode);
  const fxCodes = (meta.series?.fx || []).filter((c) => resolveIndicatorCode(c));
  const hasSeries = fxCodes.length > 0;
  const [seriesMap, setSeriesMap] = React.useState({});
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    if (!hasSeries) { setSeriesMap({}); return; }
    setLoading(true);
    fetchMacroSeriesBatch(fxCodes.map((series) => ({ provider: "YAHOO", series, geo: countryCode, range: "1Y", baseUrl })))
      .then((res) => { if (!cancelled) setSeriesMap(res); })
      .catch(() => { if (!cancelled) setSeriesMap({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [fxCodes, countryCode, baseUrl, hasSeries]);

  const anyData = fxCodes.some((c) => (seriesMap[c]?.points || []).length > 0);
  const source = loading ? "Loading…" : anyData ? "Yahoo" : "Unavailable";

  return (
    <section className="analytics-card macro-fx-module" aria-label="FX Intelligence">
      <div className="macro-tier-head">
        <div>
          <div className="analytics-section-title">FX Intelligence</div>
          <div className="analytics-card-subtitle">Spot, dollar strength, carry, regional heatmap.</div>
        </div>
        <div className="analytics-pill-group">
          <StatusPill tone="neutral">{source}</StatusPill>
        </div>
      </div>

      <div className="macro-fx-grid">
        <div className="macro-fx-col">
          <div className="macro-fx-col-head">Spot FX · Major Pairs</div>
          {fxCodes.length === 0 ? (
            <div className="macro-tier-empty">Unavailable — no FX series for this country.</div>
          ) : (
            fxCodes.map((code) => (
              <FxSpotRow key={code} code={code} series={seriesMap[code]} currency={meta.currency} />
            ))
          )}
        </div>

        <div className="macro-fx-col">
          <div className="macro-fx-col-head">Dollar Dashboard</div>
          <div className="macro-fx-dollar">
            {["dxy"].map((code) => (
              <FxSpotRow key={code} code={code} series={seriesMap[code]} currency={meta.currency} />
            ))}
            <div className="macro-fx-note">Broad / Real Dollar — pending backend series.</div>
          </div>
          <div className="macro-fx-col-head">FX Carry (top trades)</div>
          <div className="macro-fx-note">Funding vs target yield spread — pending backend series.</div>
        </div>
      </div>

      <div className="macro-fx-heatmap">
        <div className="macro-fx-col-head">FX Heatmap · Regional Strength</div>
        <div className="macro-fx-heatmap-row">
          {REGIONAL_CURRENCIES.map((c) => (
            <span key={c} className="macro-fx-heat-cell">{c}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export default MacroFxModule;
