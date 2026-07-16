// MacroTierRail — Phase 1 Tier-1 intelligence rail.
//
// Renders the new top-of-desk hierarchy modules (Liquidity, Rates, Growth,
// Inflation) BELOW Macro Regime and ABOVE the Macro Terminal. Reuses:
//   - CountryRegistry (series taxonomy per country)  → real data switching
//   - macro/adapters (provider-agnostic fetch)       → no provider UI logic
//   - MacroTierModule (presentational)               → Brand v2 cards
//   - intelligenceBus regime                          → context tone
//
// Progressive: each module fetches its own series batch; missing series render
// honest "Unavailable". No fabricated values.

import React, { useEffect, useMemo, useState } from "react";
import { MacroTierModule } from "./MacroTierModule.jsx";
import { getCountryMeta, getSeriesLabel } from "../../utils/CountryRegistry.ts";
import { fetchMacroSeriesBatch } from "../../utils/macro/adapters.js";
import { resolveIndicatorCode } from "../../utils/macro/seriesResolver.js";
import { getCountryCoverage } from "./MacroCoverageRegistry.js";

// Theme → {seriesKey in taxonomy, provider hint, regime label fn, higherIsBullish}.
const THEMES = [
  { key: "liquidity", title: "Liquidity Intelligence", taxonomy: "debt", provider: "FRED",
    subtitle: "Fed balance sheet, reverse repo, TGA, net liquidity, reserves.", higherIsBullish: true },
  { key: "rates", title: "Rates Intelligence", taxonomy: "rates", provider: "FRED",
    subtitle: "Policy rate, 2Y/5Y/10Y/30Y, real yield, curve.", higherIsBullish: false },
  { key: "growth", title: "Growth Theme", taxonomy: "gdp", provider: "WORLDBANK",
    subtitle: "GDP, industrial production, PMI, retail, confidence.", higherIsBullish: true },
  { key: "inflation", title: "Inflation Theme", taxonomy: "inflation", provider: "FRED",
    subtitle: "Headline/Core CPI, PPI, Core PCE, breakevens.", higherIsBullish: false },
];

function useThemeSeries(theme, countryCode, baseUrl) {
  const [seriesMap, setSeriesMap] = useState({});
  const [loading, setLoading] = useState(false);

  const meta = useMemo(() => getCountryMeta(countryCode), [countryCode]);
  // Only fetch series the backend can actually resolve, deduped by indicator so
  // we don't render four identical rows for one shared series (e.g. yields).
  const codes = useMemo(() => {
    const all = meta.series?.[theme.taxonomy] || [];
    const seenIndicator = new Set();
    const kept = [];
    for (const code of all) {
      const indicator = resolveIndicatorCode(code);
      if (!indicator || seenIndicator.has(indicator)) continue;
      seenIndicator.add(indicator);
      kept.push(code);
    }
    return kept;
  }, [meta, theme.taxonomy]);

  useEffect(() => {
    let cancelled = false;
    if (!codes.length) { setSeriesMap({}); return; }
    setLoading(true);
    const requests = codes.map((series) => ({ provider: theme.provider, series, geo: countryCode, range: "5Y", baseUrl }));
    fetchMacroSeriesBatch(requests)
      .then((res) => { if (!cancelled) setSeriesMap(res); })
      .catch(() => { if (!cancelled) setSeriesMap({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [codes, countryCode, theme.provider, baseUrl]);

  return { seriesMap, codes, loading };
}

function ThemeModule({ theme, countryCode, baseUrl, regimeLabel, regimeTone }) {
  const { seriesMap, codes, loading } = useThemeSeries(theme, countryCode, baseUrl);
  const metrics = codes.map((code) => ({
    label: getSeriesLabel(code),
    series: seriesMap[code],
    higherIsBullish: theme.higherIsBullish,
  }));
  const anyData = metrics.some((m) => (m.series?.points || []).length > 0);
  const source = loading ? "Loading…" : anyData ? theme.provider : "Unavailable";
  return (
    <MacroTierModule
      title={theme.title}
      subtitle={theme.subtitle}
      regimeLabel={regimeLabel ? `Regime: ${regimeLabel}` : null}
      regimeTone={regimeTone}
      metrics={anyData ? metrics : []}
      source={source}
    />
  );
}

export function MacroTierRail({ countryCode = "USA", regimeLabel = null, regimeTone = "neutral", baseUrl = "" }) {
  const coverage = getCountryCoverage(countryCode);
  return (
    <div className="macro-tier-rail" aria-label="Macro Tier-1 intelligence">
      <div className="macro-tier-rail-head">
        <span className="analytics-card-label">TIER-1 INTELLIGENCE</span>
        <span className="analytics-card-subtitle">
          {coverage.name} · {coverage.providers?.join(" · ") || "—"}
        </span>
      </div>
      {THEMES.map((theme) => (
        <ThemeModule
          key={theme.key}
          theme={theme}
          countryCode={countryCode}
          baseUrl={baseUrl}
          regimeLabel={regimeLabel}
          regimeTone={regimeTone}
        />
      ))}
    </div>
  );
}

export default MacroTierRail;
