// MacroAssetWorkspace — Phase 6: Macro as a first-class Asset Intelligence asset.
//
// Promotes Macro from a standalone desk into a registered asset kind consumed by
// the same Asset Registry as stock/commodity/etf. Reuses (never reimplements):
//   - CompactWorkspaceUI  → WorkspaceLayout / Section / Panel / Sidebar* (shared shell)
//   - ResearchWorkspacePanel → Research & Decisions tier (shared with ARW)
//   - assetResearchService → theses/notes/catalysts/triggers (single owner)
//   - useRegimeIntelligence / IntelligenceBus → regime + publishes macro signal
//   - relationshipGraph → Related Assets + Cross-Asset Impact traversal
//   - Macro* modules → Executive Brief / Regime / Theme / Cross-Asset / Transmission
//   - MacroCoverageRegistry / IndicatorRegistry / ProviderRegistry → Profile
//
// Sidebar is REGISTRY-DRIVEN: getAssetKind("macro").tiers.workspace enumerates
// the 9 tiers in order. No duplicated page logic.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  WorkspaceLayout,
  Section,
  Panel,
  SidebarGroup,
  SidebarItem,
  Ghost,
  CompactPageHeader,
  MetricStrip,
} from "../CompactWorkspaceUI";
import { StatusPill } from "../ui/StatusPill.jsx";
import { ResearchWorkspacePanel } from "../InstitutionalPanels";
import { getResearch, getResearchCounts } from "../../services/assetResearchService";
import { useRegimeIntelligence } from "../portfolioIntelligence/useRegimeIntelligence";
import { IntelligenceBus, publishRegime } from "../../utils/intelligenceBus";
import { getRelated, traverse, NODE_KIND } from "../../utils/relationshipGraph";
import { getAssetKind } from "../../utils/assetRegistry";
import { MacroCountryProvider, useMacroCountry } from "./MacroCountryContext";
import { MacroCountrySelector } from "./MacroCountrySelector";
import { EtfRecommendations } from "../EtfRecommendations";
import { MacroCountryProfileModule } from "./MacroCountryProfileModule";
import { MacroTierRail } from "./MacroTierRail";
import { MacroThemeModule } from "./MacroThemeModule";
import { MacroCrossAssetModule } from "./MacroCrossAssetModule";
import { MacroTransmissionModule } from "./MacroTransmissionModule";
import { SUPPORTED_COUNTRIES, getCountryCoverage, tierMeta } from "./MacroCoverageRegistry";
import { MACRO_INDICATORS } from "./MacroIndicatorRegistry";
import { MACRO_PROVIDERS } from "./MacroProviderRegistry";
import { EconomicDependencyEngine, ScenarioLaboratory } from "../intelligence/index.jsx";

// Theme Explorer → taxonomy/provider mapping (CountryRegistry taxonomy keys).
// Themes without a backend taxonomy resolve to honest "Unavailable" in
// MacroThemeModule (no fabricated values).
const THEME_CONFIG = [
  { theme: "Inflation", taxonomy: "inflation", provider: "FRED" },
  { theme: "Rates", taxonomy: "rates", provider: "FRED" },
  { theme: "Liquidity", taxonomy: "debt", provider: "FRED" },
  { theme: "Credit", taxonomy: "credit", provider: "FRED" },
  { theme: "Labor", taxonomy: "labor", provider: "FRED" },
  { theme: "Housing", taxonomy: "housing", provider: "FRED" },
  { theme: "Manufacturing", taxonomy: "gdp", provider: "WORLDBANK" },
  { theme: "Consumer", taxonomy: "inflation", provider: "FRED" },
  { theme: "FX", taxonomy: "fx", provider: "FRED" },
  { theme: "Geopolitics", taxonomy: "geopol", provider: "FRED" },
  { theme: "Energy", taxonomy: "energy", provider: "FRED" },
  { theme: "Climate", taxonomy: "climate", provider: "FRED" },
  { theme: "Fiscal", taxonomy: "fiscal", provider: "FRED" },
  { theme: "Monetary", taxonomy: "rates", provider: "FRED" },
  { theme: "China", taxonomy: "gdp", provider: "WORLDBANK" },
  { theme: "Europe", taxonomy: "gdp", provider: "WORLDBANK" },
  { theme: "Emerging Markets", taxonomy: "gdp", provider: "WORLDBANK" },
];

const MACRO_REGIONS = [
  "USA", "GBR", "CHN", "JPN", "IND", "AUS",
  "EUU", "ZAF", "BRA", "SAU", "ARE",
];

function ExecutiveBrief({ regime, macroSignal }) {
  const label = regime?.label || null;
  const score = regime?.score ?? null;
  const confidence = regime?.confidence ?? null;
  const drivers = regime?.drivers || [];
  const summary = regime?.explain || (label ? `Current regime: ${label}.` : "Macro regime not yet published.");
  return (
    <Section title="Executive Brief" description="Regime-led macro summary">
      <MetricStrip items={[
        { label: "Regime", value: label || "Unavailable" },
        { label: "Score", value: score != null ? score.toFixed(0) : "—" },
        { label: "Confidence", value: confidence != null ? `${confidence}%` : "—" },
      ]} />
      <Panel title="Executive Summary">
        <p className="cw-note">{summary}</p>
        {drivers.length ? (
          <ul className="macro-driver-list">
            {drivers.slice(0, 6).map((d, i) => <li key={i}>{d}</li>)}
          </ul>
        ) : <Ghost label="No drivers published" />}
      </Panel>
      <Panel title="Key Changes Since Previous Update">
        {macroSignal?.delta ? (
          <p className="cw-note">{macroSignal.delta}</p>
        ) : <Ghost label="No prior regime to diff against" />}
      </Panel>
    </Section>
  );
}

function RegimeDashboard({ countryCode, regimeLabel, regimeTone }) {
  return (
    <Section title="Regime Dashboard" description="Growth · Inflation · Liquidity · Rates · Credit · Dollar · Employment · Volatility">
      <MacroTierRail countryCode={countryCode} regimeLabel={regimeLabel} regimeTone={regimeTone} />
      <div className="macro-regime-extra">
        <MacroThemeModule title="Credit Conditions" subtitle="Spreads, default rates, leverage." taxonomy="credit" provider="FRED" countryCode={countryCode} regimeLabel={regimeLabel} regimeTone={regimeTone} higherIsBullish={false} />
        <MacroThemeModule title="Employment" subtitle="Payrolls, participation, claims." taxonomy="labor" provider="FRED" countryCode={countryCode} regimeLabel={regimeLabel} regimeTone={regimeTone} higherIsBullish={true} />
        <MacroThemeModule title="Dollar" subtitle="DXY, trade-weighted USD." taxonomy="fx" provider="FRED" countryCode={countryCode} regimeLabel={regimeLabel} regimeTone={regimeTone} higherIsBullish={false} />
        <MacroThemeModule title="Volatility" subtitle="VIX and implied vol term structure." taxonomy="vol" provider="FRED" countryCode={countryCode} regimeLabel={regimeLabel} regimeTone={regimeTone} higherIsBullish={false} />
      </div>
    </Section>
  );
}

function ThemeExplorer({ countryCode, regimeLabel, regimeTone }) {
  return (
    <Section title="Theme Explorer" description="Sixteen macro themes, one card each">
      <div className="macro-theme-grid">
        {THEME_CONFIG.map((t) => (
          <MacroThemeModule
            key={t.theme}
            title={t.theme}
            subtitle={`${t.provider} · ${t.taxonomy}`}
            taxonomy={t.taxonomy}
            provider={t.provider}
            countryCode={countryCode}
            regimeLabel={regimeLabel}
            regimeTone={regimeTone}
          />
        ))}
      </div>
    </Section>
  );
}

function CrossAssetImpact({ regimeLabel }) {
  const sectors = IntelligenceBus.affectedSectors(regimeLabel);
  const commodities = IntelligenceBus.affectedCommodities(regimeLabel);
  return (
    <Section title="Cross-Asset Impact" description="Propagation from macro regime to sectors, commodities, holdings">
      <div className="macro-ca-impact">
        <Panel title="Affected Sectors">
          {sectors.length ? sectors.map((s) => (
            <div key={s.label} className="macro-ca-impact-row">
              <span>{s.label}</span>
              <StatusPill tone={s.direction === "up" ? "positive" : s.direction === "down" ? "negative" : "neutral"}>{s.direction}</StatusPill>
            </div>
          )) : <Ghost label="No regime — sectors unavailable" />}
        </Panel>
        <Panel title="Affected Commodities">
          {commodities.length ? commodities.map((c) => (
            <div key={c.group} className="macro-ca-impact-row">
              <span>{c.group}</span>
              <StatusPill tone={c.direction === "up" ? "positive" : "negative"}>{c.direction}</StatusPill>
            </div>
          )) : <Ghost label="No regime — commodities unavailable" />}
        </Panel>
      </div>
    </Section>
  );
}

function RegionalIntelligence() {
  const { selectedCountry, setSelectedCountry } = useMacroCountry();
  const regions = MACRO_REGIONS.map((code) => getCountryCoverage(code)).filter(Boolean);
  return (
    <Section title="Regional Intelligence" description="US · Europe · UK · China · Japan · India · Africa · Latin America · Middle East · Australia">
      <div className="macro-region-bar">
        <MacroCountrySelector />
      </div>
      <div className="macro-region-chips">
        {regions.map((c) => (
          <button
            key={c.code}
            type="button"
            className={`macro-region-chip ${c.code === selectedCountry ? "active" : ""} ${c.available ? "" : "coming-soon"}`}
            disabled={!c.available}
            onClick={() => c.available && setSelectedCountry(c.code)}
          >
            {c.flag} {c.name}
          </button>
        ))}
      </div>
      <MacroCountryProfileModule countryCode={selectedCountry} />
    </Section>
  );
}

function ScenarioAnalysis({ regimeLabel }) {
  const base = IntelligenceBus.affectedSectors(regimeLabel);
  const bull = base.map((s) => ({ ...s, direction: "up" }));
  const bear = base.map((s) => ({ ...s, direction: "down" }));
  const probability = regimeLabel ? "Derived from regime score" : "Unavailable";
  return (
    <Section title="Scenario Analysis" description="Base · Bull · Bear · Probability · Portfolio implications">
      <MetricStrip items={[
        { label: "Base", value: base.length ? `${base.length} sectors` : "Unavailable" },
        { label: "Bull", value: bull.length ? "Risk-on tilt" : "—" },
        { label: "Bear", value: bear.length ? "Risk-off tilt" : "—" },
        { label: "Probability", value: probability },
      ]} />
      <Panel title="Portfolio Implications">
        {regimeLabel ? (
          <p className="cw-note">
            Under <strong>{regimeLabel}</strong>, the regime transmits into {base.map((s) => s.label).join(", ") || "defensive assets"}.
            Reuse the RelationshipGraph cascade for holding-level impact (see Cross-Asset Impact).
          </p>
        ) : <Ghost label="No regime published — scenarios unavailable" />}
      </Panel>
    </Section>
  );
}

function Transmission({ countryCode, regimeLabel, regimeTone }) {
  return (
    <Section title="Transmission" description="Interactive propagation graph (Transmission Engine)">
      <MacroTransmissionModule countryCode={countryCode} regimeLabel={regimeLabel} regimeTone={regimeTone} />
    </Section>
  );
}

function RelatedAssets({ regimeLabel }) {
  // Traverse from the active macro regime node to related asset classes via the
  // RelationshipGraph (Phase 6 macro edges). Honest: empty when no regime.
  const related = useMemo(() => {
    if (!regimeLabel) return { companies: [], commodities: [], etfs: [], bonds: [], currencies: [], indexes: [] };
    const node = `Macro:${regimeLabel}`;
    const hits = traverse(node, { maxHops: 2, kinds: [NODE_KIND.COMPANY, NODE_KIND.COMMODITY, NODE_KIND.ETF, NODE_KIND.CURRENCY, NODE_KIND.INDEX] });
    const out = { companies: [], commodities: [], etfs: [], bonds: [], currencies: [], indexes: [] };
    for (const h of hits) {
      if (h.kind === NODE_KIND.COMPANY) out.companies.push(h.label);
      else if (h.kind === NODE_KIND.COMMODITY) out.commodities.push(h.label);
      else if (h.kind === NODE_KIND.ETF) out.etfs.push(h.label);
      else if (h.kind === NODE_KIND.CURRENCY) out.currencies.push(h.label);
      else if (h.kind === NODE_KIND.INDEX) out.indexes.push(h.label);
    }
    return out;
  }, [regimeLabel]);

  const groups = [
    { label: "Companies", items: related.companies },
    { label: "Commodities", items: related.commodities },
    { label: "ETFs", items: related.etfs },
    { label: "Bonds", items: related.bonds },
    { label: "Currencies", items: related.currencies },
    { label: "Indices", items: related.indexes },
  ];
  return (
    <Section title="Related Assets" description="Companies · Commodities · ETFs · Bonds · Currencies · Indices">
      <div className="macro-related-grid">
        {groups.map((g) => (
          <Panel key={g.label} title={g.label}>
            {g.items.length ? g.items.map((i) => <div key={i} className="macro-rel-row">{i}</div>) : <Ghost label="No linked assets" />}
          </Panel>
        ))}
      </div>
    </Section>
  );
}

function ResearchDecisions({ symbol }) {
  const [counts, setCounts] = useState({ theses: 0, catalysts: 0, triggers: 0, notes: 0 });
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    getResearchCounts(symbol).then((c) => { if (!cancelled) setCounts(c); }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol]);
  return (
    <Section title="Research & Decisions" description="Research notes · Decision log · Catalysts · Risks · AI Brief · Journal">
      <div className="macro-research-rail">
        <SidebarGroup label="Research Objects">
          <SidebarItem label="Theses" badge={counts.theses} />
          <SidebarItem label="Catalysts" badge={counts.catalysts} />
          <SidebarItem label="Triggers" badge={counts.triggers} />
          <SidebarItem label="Notes" badge={counts.notes} />
        </SidebarGroup>
      </div>
      <ResearchWorkspacePanel scope="macro" title="Macro Research" signals={[]} />
    </Section>
  );
}

const TIER_RENDERERS = {
  executiveBrief: (p) => <ExecutiveBrief regime={p.regime} macroSignal={p.macroSignal} />,
  regimeDashboard: (p) => <RegimeDashboard countryCode={p.countryCode} regimeLabel={p.regimeLabel} regimeTone={p.regimeTone} />,
  themeExplorer: (p) => <ThemeExplorer countryCode={p.countryCode} regimeLabel={p.regimeLabel} regimeTone={p.regimeTone} />,
  crossAssetImpact: (p) => <CrossAssetImpact regimeLabel={p.regimeLabel} />,
  regionalIntelligence: () => <RegionalIntelligence />,
  scenarioAnalysis: (p) => <ScenarioAnalysis regimeLabel={p.regimeLabel} />,
  transmission: (p) => <Transmission countryCode={p.countryCode} regimeLabel={p.regimeLabel} regimeTone={p.regimeTone} />,
  relatedAssets: (p) => <RelatedAssets regimeLabel={p.regimeLabel} />,
  economicDependency: (p) => <EconomicDependencyEngine symbol={p.symbol} kind="macro" regimeLabel={p.regimeLabel} />,
  etfRecommendations: (p) => <EtfRecommendations mode="regime" regime={p.regime} onOpenEtf={p.onOpenEtf} />,
  scenarioLab: (p) => <ScenarioLaboratory symbol={p.symbol} />,
  researchDecisions: (p) => <ResearchDecisions symbol={p.symbol} />,
};

function MacroWorkspaceInner({ symbol = "USA", onClose, onOpenEtf }) {
  const { selectedCountry } = useMacroCountry();
  const { regime, macroSignal } = useRegimeIntelligence();
  const kind = getAssetKind("macro");
  const tiers = kind?.tiers?.workspace || Object.keys(TIER_RENDERERS);
  const [activeView, setActiveView] = useState(tiers[0] || "executiveBrief");

  const regimeLabel = regime?.label || null;
  const regimeTone = regime?.tone || "neutral";

  // Publish the macro regime through the Intelligence Bus so every other
  // surface (Portfolio, Company/Commodity/ETF, Watchlist, Decision Engine)
  // consumes the SAME normalized macro signal (spec: publishes through bus).
  useEffect(() => {
    if (regimeLabel) publishRegime({ label: regimeLabel, score: regime?.score, explain: regime?.explain, updatedAt: regime?.updatedAt, source: `geo:${selectedCountry}` });
  }, [regimeLabel, regime?.score, regime?.explain, regime?.updatedAt, selectedCountry]);

  const sym = String(symbol || "USA").toUpperCase();
  const countryCode = selectedCountry || "USA";

  const openEtf = (asset) => { if (onOpenEtf) onOpenEtf(asset); };

  const sidebar = (
    <nav className="arw-sidebar" aria-label="Macro research sections">
      <SidebarGroup label="Macro Intelligence">
        {tiers.map((id) => (
          <SidebarItem key={id} label={id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} active={activeView === id} onClick={() => setActiveView(id)} />
        ))}
      </SidebarGroup>
    </nav>
  );

  const props = { symbol: sym, countryCode, regime, macroSignal, regimeLabel, regimeTone, onOpenEtf: openEtf };

  return (
    <WorkspaceLayout
      sidebar={sidebar}
      header={
        <CompactPageHeader
          eyebrow="Macro Research"
          title={`Macro · ${getCountryCoverage(countryCode)?.name || countryCode}`}
          description="Macro intelligence as a first-class asset. Regime-led, cross-asset, transmission-aware."
          meta={<span className="arw-header-meta"><StatusPill tone={regimeTone}>{regimeLabel ? `Regime: ${regimeLabel}` : "Regime Unavailable"}</StatusPill>{onClose ? <button type="button" className="research-btn primary" onClick={onClose}>Close</button> : null}</span>}
        />
      }
    >
      <div className="macro-workspace-canvas">
        {(TIER_RENDERERS[activeView] || TIER_RENDERERS[tiers[0]])(props)}
      </div>
    </WorkspaceLayout>
  );
}

export function MacroAssetWorkspace({ symbol = "USA", onClose, onOpenEtf }) {
  return (
    <MacroCountryProvider defaultCountry={String(symbol || "USA").toUpperCase()}>
      <MacroWorkspaceInner symbol={symbol} onClose={onClose} onOpenEtf={onOpenEtf} />
    </MacroCountryProvider>
  );
}

export default MacroAssetWorkspace;
