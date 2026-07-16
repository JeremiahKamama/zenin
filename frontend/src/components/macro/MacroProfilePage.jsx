// MacroProfilePage — Phase 6 reference-only Macro Profile.
//
// Reuses the macro registries (Indicator / Provider / Coverage) and the single
// MacroCountryProvider so it shows the SAME selected country as the workspace.
// Reference content only — no proprietary research, no fabricated data. Sections
// are driven by getAssetKind("macro").tiers.profile (registry-driven).

import React, { useState } from "react";
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
import { MacroCountryProvider, useMacroCountry } from "./MacroCountryContext";
import { MacroCountryMetaStrip } from "./MacroCountryMetaStrip";
import { MACRO_INDICATORS } from "./MacroIndicatorRegistry";
import { MACRO_PROVIDERS } from "./MacroProviderRegistry";
import { SUPPORTED_COUNTRIES, getCountryCoverage, tierMeta, COVERAGE_TIERS } from "./MacroCoverageRegistry";
import { getAssetKind } from "../../utils/assetRegistry";

const PROFILE_TIERS = getAssetKind("macro")?.tiers?.profile || [
  "definitions", "methodologies", "indicators", "providers",
  "calendars", "revisions", "coverage", "sourceQuality",
];

const DEFINITIONS = [
  { term: "Regime", def: "The dominant macro state (e.g. Expansion, Inflationary) that governs cross-asset behavior." },
  { term: "Liquidity", def: "Central-bank balance sheet + bank reserves driving the availability of credit." },
  { term: "Real Yield", def: "Nominal yield minus expected inflation; the opportunity cost of holding risk assets." },
  { term: "Transmission", def: "The channel by which a macro regime propagates into asset classes and holdings." },
];

const METHODOLOGIES = [
  "Regime is derived event-driven from the latest /api/macro/regime payload (low-frequency, recomputed only on change).",
  "Theme metrics resolve via the CountryRegistry taxonomy → provider-agnostic adapter (no provider UI logic in the view).",
  "Cross-asset impact reuses the IntelligenceBus cascade (regime → sectors → commodities → holdings); never reimplemented.",
  "Holding-level impact is ON-DEMAND (computed when a surface mounts), not per-tick.",
];

function ProfileInner({ onClose }) {
  const { selectedCountry } = useMacroCountry();
  const [activeView, setActiveView] = useState(PROFILE_TIERS[0] || "definitions");
  const cov = getCountryCoverage(selectedCountry);
  const providers = (cov.providers || []).map((p) => MACRO_PROVIDERS[p]).filter(Boolean);

  const sidebar = (
    <nav className="arw-sidebar" aria-label="Macro profile sections">
      <SidebarGroup label="Reference">
        {PROFILE_TIERS.map((id) => (
          <SidebarItem key={id} label={id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())} active={activeView === id} onClick={() => setActiveView(id)} />
        ))}
      </SidebarGroup>
    </nav>
  );

  const renderView = () => {
    switch (activeView) {
      case "definitions":
        return (
          <Section title="Definitions">
            <Panel title="Macro Glossary">
              {DEFINITIONS.map((d) => (<div key={d.term} className="macro-profile-row"><strong>{d.term}</strong><span>{d.def}</span></div>))}
            </Panel>
          </Section>
        );
      case "methodologies":
        return (
          <Section title="Methodologies">
            <Panel title="How macro intelligence is computed">
              {METHODOLOGIES.map((m, i) => (<p key={i} className="cw-note">{m}</p>))}
            </Panel>
          </Section>
        );
      case "indicators":
        return (
          <Section title="Indicator Descriptions">
            <Panel title={`Indicator Catalog (${MACRO_INDICATORS.length})`}>
              <div className="macro-indicator-grid">
                {MACRO_INDICATORS.map((i) => (
                  <div key={i.code} className="macro-indicator-card">
                    <strong>{i.label}</strong>
                    <span className="macro-indicator-group">{i.group}</span>
                    <span className="macro-indicator-unit">{i.unit || "—"}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </Section>
        );
      case "providers":
        return (
          <Section title="Data Providers">
            <Panel title={`Providers (${Object.keys(MACRO_PROVIDERS).length})`}>
              <div className="macro-provider-grid">
                {Object.values(MACRO_PROVIDERS).map((p) => (
                  <div key={p.id} className="macro-provider-card">
                    <strong>{p.label}</strong>
                    <span>{p.full}</span>
                    <span className="macro-provider-scope">{p.scope}</span>
                  </div>
                ))}
              </div>
            </Panel>
          </Section>
        );
      case "calendars":
        return (
          <Section title="Release Calendars">
            <Panel title="Release Cadence by Provider">
              {providers.length ? providers.map((p) => (
                <div key={p.id} className="macro-profile-row"><strong>{p.label}</strong><span>{p.full} · {p.scope}</span></div>
              )) : <Ghost label="No providers mapped for this country" />}
              <p className="cw-note">Exact release dates are sourced from each provider's calendar feed (not stored locally).</p>
            </Panel>
          </Section>
        );
      case "revisions":
        return (
          <Section title="Historical Revisions">
            <Panel title="Revision Policy">
              <p className="cw-note">Macro series are subject to revision (e.g. initial GDP/Payrolls estimates revised in subsequent prints). The platform surfaces the latest available print and flags staleness via the meta strip; it does not store a revision history locally.</p>
            </Panel>
          </Section>
        );
      case "coverage":
        return (
          <Section title="Coverage Registry">
            <Panel title={`Supported Countries (${SUPPORTED_COUNTRIES.length})`}>
              <div className="macro-coverage-grid">
                {SUPPORTED_COUNTRIES.map((code) => {
                  const c = getCountryCoverage(code);
                  const t = tierMeta(c.tier);
                  return (
                    <div key={code} className="macro-coverage-card">
                      <strong>{c.flag} {c.name}</strong>
                      <span className={`macro-coverage-badge ${t.token}`}>{t.label}</span>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </Section>
        );
      case "sourceQuality":
        return (
          <Section title="Source Quality">
            <MetricStrip items={[
              { label: "Coverage Tier", value: tierMeta(cov.tier).label },
              { label: "Providers", value: String((cov.providers || []).length) },
              { label: "Indicators Cataloged", value: String(MACRO_INDICATORS.length) },
            ]} />
            <Panel title="Quality Notes">
              <p className="cw-note">Source provenance is shown on every data panel (provider badge + updated time). Unavailable series render honest "Unavailable" rather than interpolated values.</p>
            </Panel>
          </Section>
        );
      default:
        return <Ghost label="Select a reference section" />;
    }
  };

  return (
    <WorkspaceLayout
      sidebar={sidebar}
      header={
        <CompactPageHeader
          eyebrow="Macro Profile"
          title={`Macro · ${cov?.name || selectedCountry}`}
          description="Reference documentation for the macro intelligence asset."
          meta={<span className="arw-header-meta">{onClose ? <button type="button" className="research-btn primary" onClick={onClose}>Close</button> : null}</span>}
        />
      }
    >
      <div className="macro-profile-canvas">
        <MacroCountryMetaStrip countryCode={selectedCountry} />
        {renderView()}
      </div>
    </WorkspaceLayout>
  );
}

export function MacroProfilePage({ symbol = "USA", onClose }) {
  return (
    <MacroCountryProvider defaultCountry={String(symbol || "USA").toUpperCase()}>
      <ProfileInner onClose={onClose} />
    </MacroCountryProvider>
  );
}

export default MacroProfilePage;
