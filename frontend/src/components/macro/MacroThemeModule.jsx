// MacroThemeModule — generic Phase 3+ macro theme module (Global Trade, Capital
// Flows, Sovereign Bonds, Credit, Economic Surprise).
//
// Reuses the established pattern: CountryRegistry taxonomy → provider-agnostic
// adapter → MacroTierModule cards. Real series resolve via seriesResolver; the
// backend /macro/timeseries is World Bank only, so Trade/Capital-Flows rows can
// populate while Sovereign Bonds / Credit / Economic Surprise render honest
// "Unavailable" until those backend feeds land. No fabricated values (Brand v2).

import React, { useEffect, useMemo, useState } from "react";
import { MacroTierModule } from "./MacroTierModule.jsx";
import { getCountryMeta, getSeriesLabel } from "../../utils/CountryRegistry.ts";
import { fetchMacroSeriesBatch } from "../../utils/macro/adapters.js";
import { resolveIndicatorCode } from "../../utils/macro/seriesResolver.js";
import { getCountryCoverage } from "./MacroCoverageRegistry.js";

function useThemeSeries(taxonomy, countryCode, baseUrl, provider) {
  const [seriesMap, setSeriesMap] = useState({});
  const [loading, setLoading] = useState(false);
  const meta = useMemo(() => getCountryMeta(countryCode), [countryCode]);
  const codes = useMemo(() => {
    const all = meta.series?.[taxonomy] || [];
    const seen = new Set();
    const kept = [];
    for (const code of all) {
      const indicator = resolveIndicatorCode(code);
      if (!indicator || seen.has(indicator)) continue;
      seen.add(indicator);
      kept.push(code);
    }
    return kept;
  }, [meta, taxonomy]);

  useEffect(() => {
    let cancelled = false;
    if (!codes.length) { setSeriesMap({}); return; }
    setLoading(true);
    const requests = codes.map((series) => ({ provider, series, geo: countryCode, range: "5Y", baseUrl }));
    fetchMacroSeriesBatch(requests)
      .then((res) => { if (!cancelled) setSeriesMap(res); })
      .catch(() => { if (!cancelled) setSeriesMap({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [codes, countryCode, provider, baseUrl]);

  return { seriesMap, codes, loading };
}

export function MacroThemeModule({ title, subtitle, taxonomy, provider, countryCode = "USA", baseUrl = "", regimeLabel = null, regimeTone = "neutral", higherIsBullish = true }) {
  const { seriesMap, codes, loading } = useThemeSeries(taxonomy, countryCode, baseUrl, provider);
  const metrics = codes.map((code) => ({ label: getSeriesLabel(code), series: seriesMap[code], higherIsBullish }));
  const anyData = metrics.some((m) => (m.series?.points || []).length > 0);
  const coverage = getCountryCoverage(countryCode);
  const source = loading ? "Loading…" : anyData ? provider : "Unavailable";
  return (
    <MacroTierModule
      title={title}
      subtitle={subtitle}
      regimeLabel={regimeLabel ? `Regime: ${regimeLabel}` : null}
      regimeTone={regimeTone}
      metrics={anyData ? metrics : []}
      source={source}
    />
  );
}

export default MacroThemeModule;
