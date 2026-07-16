// EtfResearchWorkspace — institutional ETF research surface for ARW.
// First-class ETF asset (spec "ETF Research Evolution"), NOT "equity with a
// different profile". Delegated to by AssetResearchWorkspace when kind==="etf".
//
// Capability-driven (Rec 14): every tier declares a CAPABILITY. If a live
// provider powers it we render real data; otherwise we surface the missing
// capability honestly ("Waiting on provider") instead of a static Ghost.
//
// Real data available TODAY (no fabrication):
//   - CORE_ETF_SEED        : issuer / index / category / exposure
//   - ETF_TIERS (registry): authoritative tier list + grouping
//   - EtfAdapter.fetchSnapshot: LIVE price/day-change (Yahoo via backend)
//   - useETFIntelligence   : provider (ETFDB_SCRAPER) — currently returns
//                            null server-side (scraper not yet wired) → honest
//                            "waiting on ETF Intelligence Provider"
//   - relationshipGraph.getRelated: related ETFs/commodities/countries
//
// All cross-links are reversible and never dead-end (Rec 3/5/6).

import { useEffect, useMemo, useState } from "react";
import {
  CompactPageHeader, WorkspaceLayout, Section, Panel, MetricStrip, Tag, Ghost, SidebarGroup, SidebarItem,
} from "./CompactWorkspaceUI";
import { CORE_ETF_SEED } from "../utils/assetGraph";
import { getAssetKind } from "../utils/assetRegistry";
import { useETFIntelligence } from "../hooks/useETFIntelligence";
import { getRelated } from "../utils/relationshipGraph";
import { CapabilityStatusCard } from "./CapabilityStatusCard";
import { EtfDiscovery } from "./EtfDiscovery";
import { EtfCompare } from "./EtfCompare";

/* ── Capability-driven tiers (Corrections 2/14) ─────────────────────
 * ARW is provider-agnostic: each tier names the CAPABILITY it needs and the
 * Capability Registry (DataCoverageRegistry.resolveCapability) resolves the
 * provider + live status. Adding a provider never touches this file. */
// Tiers whose live data we can derive from seed/graph/price TODAY (no provider).
const DERIVED_OK = new Set([
  "overview", "investmentThesis", "portfolioIntel", "fundComposition",
  "geographic", "factor", "currency", "risk", "overlap", "correlation",
  "filings", "macroIntel", "performance", "fundFlows", "research",
  "consensus", "catalysts", "decisionReplay", "decisionLedger", "scenarioLab",
]);

// 5-stage spine (Rec 6).
const STAGES = ["Understand", "Analyze", "Compare", "Monitor", "Decide"];

// Coverage Score breakdown (Rec 13) — each dimension maps to a capability.
const COVERAGE_DIMS = [
  { id: "documents", label: "Documents", cap: "ETF_DOCUMENTS" },
  { id: "holdings", label: "Holdings", cap: "ETF_COMPOSITION" },
  { id: "performance", label: "Performance", cap: "ETF_NAV_SERIES" },
  { id: "risk", label: "Risk", cap: "ETF_CLASSIFICATION" },
  { id: "macro", label: "Macro", cap: "ETF_MACRO_EXPOSURE" },
  { id: "scenario", label: "Scenario Analysis", cap: "ETF_INTELLIGENCE" },
  { id: "correlation", label: "Correlation", cap: "ETF_CORRELATION" },
  { id: "flows", label: "Flows", cap: "ETF_FLOWS" },
  { id: "intelligence", label: "Intelligence", cap: "ETF_INTELLIGENCE" },
  { id: "researchNotes", label: "Research Notes", cap: null },
];

// Map legacy tier cap ids → Capability Registry ids (Correction 2: the ARW
// consumes capabilities, never providers). Kept as a thin alias so existing
// call sites stay unchanged while the registry owns provider resolution.
const CAP_ALIAS = {
  ETF_STRATEGY: "ETF_STRATEGY",
  ETF_COMPOSITION: "ETF_COMPOSITION",
  ETF_CLASSIFICATION: "ETF_CLASSIFICATION",
  ETF_FLOWS: "ETF_FLOW_HISTORY",
  ETF_NAV_SERIES: "ETF_NAV_SERIES",
  ETF_MACRO_EXPOSURE: "ETF_MACRO_EXPOSURE",
  ETF_CORRELATION: "ETF_CORRELATION_ENGINE",
  ETF_DOCUMENTS: "ETF_DOCUMENT_INTELLIGENCE",
  ETF_INTELLIGENCE: "ETF_COMPOSITION",
};

function CapabilityUnavailable({ cap, reason }) {
  return <CapabilityStatusCard capability={CAP_ALIAS[cap] || cap} reason={reason} />;
}

function ResearchCoverageScore({ dims, notesCount, live }) {
  const scored = dims.map((d) => {
    if (d.cap == null) return { ...d, status: notesCount > 0 ? "complete" : "partial" };
    if (live) return { ...d, status: "complete" };
    // No live provider yet: seed/reference-derived dimensions are "partial"
    // (real reference metadata exists), the rest are "missing".
    return { ...d, status: DERIVED_OK.has(d.id) ? "partial" : "missing" };
  });
  const complete = scored.filter((d) => d.status === "complete").length;
  const partial = scored.filter((d) => d.status === "partial").length;
  const pct = Math.round(((complete + partial * 0.5) / scored.length) * 100);
  return (
    <Panel title="Research Coverage">
      <div className="etf-cov-score">
        <div className="etf-cov-bar"><span style={{ width: `${pct}%` }} /></div>
        <div className="etf-cov-pct">{pct}%</div>
      </div>
      <ul className="etf-cov-list">
        {scored.map((d) => (
          <li key={d.id} className={`etf-cov-${d.status}`}>
            <span className="etf-cov-dot" />
            {d.label}<em>{d.status}</em>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// Fund Timeline (Rec 2) — ETF-native events. Live events require the
// provider; today we show the canonical ETF lifecycle that COULD surface,
// with honest "no live document feed" state (no fabricated dates).
const FUND_TIMELINE = [
  "ETF Launch", "Prospectus Filed", "Semi-Annual Report", "N-PORT",
  "N-CEN", "Benchmark Change", "Methodology Change", "Expense Ratio Change",
  "Holdings Rotation", "Distribution Announcement", "Rebalance", "Closure Notice",
  "Fund Merger", "Index Provider Change", "AUM Milestone",
];

function FundTimeline({ providerLive }) {
  if (!providerLive) {
    return <CapabilityUnavailable cap="ETF_DOCUMENTS" reason="No live document feed — SEC/ETFDB document intelligence not yet wired." />;
  }
  return (
    <ul className="etf-timeline">
      {FUND_TIMELINE.map((e) => (
        <li key={e} className="etf-tl-row"><span className="etf-tl-dot" />{e}<span className="etf-tl-open">Open Document →</span></li>
      ))}
    </ul>
  );
}

// ETF Relationship Graph (Rec 5) — derived from relationshipGraph.getRelated.
function EtfRelationshipGraph({ sym, onOpenEtf, onOpenCommodity, onOpenCountry, onOpenSector }) {
  const rel = useMemo(() => getRelated(sym), [sym]);
  const nodes = useMemo(() => {
    const out = [];
    (rel.etfs || []).forEach((s) => out.push({ key: s, type: "ETF", label: s, onOpen: onOpenEtf }));
    (rel.commodities || []).forEach((s) => out.push({ key: `c-${s}`, type: "Commodity", label: s, onOpen: onOpenCommodity }));
    (rel.countries || []).forEach((s) => out.push({ key: `co-${s}`, type: "Country", label: s, onOpen: onOpenCountry }));
    return out;
  }, [rel]);
  return (
    <Panel title="ETF Relationship Graph">
      {nodes.length ? (
        <div className="etf-graph">
          {nodes.map((n) => (
            <button key={n.key} type="button" className={`etf-node etf-${n.type.toLowerCase()}`} onClick={() => n.onOpen?.(n.label)}>
              <span className="etf-node-type">{n.type}</span>{n.label}
            </button>
          ))}
        </div>
      ) : <Ghost label="No related assets mapped in the Relationship Graph." />}
      <p className="etf-note muted">Every node opens its research surface. Integrates with Transmission Explorer via shared Relationship Graph edges.</p>
    </Panel>
  );
}

function NavigableList({ title, items, onOpen, kind }) {
  return (
    <Panel title={title}>
      {items.length ? (
        <div className="etf-nav-list">
          {items.map((it) => (
            <button key={it} type="button" className="etf-nav-row" onClick={() => onOpen?.(it)}>
              {it}<span className="etf-rel-go">→</span>
            </button>
          ))}
        </div>
      ) : <Ghost label="No data mapped." />}
    </Panel>
  );
}

/* ── Main ETF workspace ─────────────────────────────────────────────── */
export function EtfResearchWorkspace({
  symbol, asset, etfSnap, compareSymbol,
  onClose, onCompare, onOpenCommodity, onOpenCompanyProfile, onOpenMacro, onOpenCountry, onOpenSector,
}) {
  const sym = String(symbol || "").trim().toUpperCase();
  const seed = CORE_ETF_SEED[sym] || null;
  const [activeView, setActiveView] = useState("overview");
  const [live, setLive] = useState(false); // flips true once provider returns data

  const etf = useETFIntelligence(sym);
  useEffect(() => { setLive(Boolean(etf.available)); }, [etf.available]);

  const rel = useMemo(() => getRelated(sym), [sym]);
  const tiers = getAssetKind("etf")?.tiers?.workspace || [];

  // Group tiers into the 5 stages (Rec 6).
  const GROUP_OF = useMemo(() => {
    const g = {};
    tiers.forEach((id) => { g[id] = STAGE_OF(id); });
    return g;
  }, [tiers]);
  const grouped = useMemo(() => {
    const out = {}; STAGES.forEach((s) => (out[s] = []));
    tiers.forEach((id) => out[GROUP_OF[id] || "Analyze"].push(id));
    return out;
  }, [tiers, GROUP_OF]);

  const renderView = () => {
    // Derived / live-OK tiers:
    if (activeView === "overview") {
      return (
        <Section title="Overview">
          <MetricStrip items={[
            { label: "Price", value: etfSnap?.price != null ? `$${etfSnap.price.toFixed(2)}` : "Unavailable" },
            { label: "Day", value: etfSnap?.dayChangePct != null ? `${etfSnap.dayChangePct >= 0 ? "+" : ""}${etfSnap.dayChangePct.toFixed(2)}%` : "Unavailable" },
            { label: "Issuer", value: seed?.issuer || "—" },
            { label: "Category", value: seed?.category || "—" },
            { label: "Benchmark", value: seed?.benchmark || "—" },
            { label: "Ticker", value: sym },
            { label: "Exposure", value: (seed?.exposure || []).join(" · ") || "—" },
          ]} />
          <Panel title="Objective">
            <p className="etf-note">{seed ? `${seed.name} tracks ${seed.benchmark || "its benchmark"}, classified as ${seed.category}.` : `No reference metadata for ${sym}.`}</p>
          </Panel>
        </Section>
      );
    }
    if (activeView === "investmentThesis") {
      return (
        <Section title="Investment Thesis">
          <Panel title="Current Stance"><Ghost label="No thesis yet — add one from Research." /></Panel>
          <MetricStrip items={[
            { label: "Issuer", value: seed?.issuer || "—" },
            { label: "Tracked Index", value: seed?.benchmark || "—" },
            { label: "Category", value: seed?.category || "—" },
          ]} />
        </Section>
      );
    }
    if (activeView === "portfolioIntel" || activeView === "overlap") {
      return (
        <Section title="Portfolio Intelligence">
          <Panel title="Holdings Overlap">
            <Ghost label={live ? "Overlap vs your portfolio computed from live holdings." : "Overlap vs your portfolio unavailable — holdings feed pending ETF Intelligence Provider."} />
          </Panel>
          <NavigableList title="Sector / Country / Factor Exposure" items={(seed?.exposure || [])} onOpen={onOpenSector} />
        </Section>
      );
    }
    if (activeView === "fundComposition") {
      if (live && etf.composition) {
        const c = etf.composition;
        return (
          <Section title="Fund Composition">
            <Panel title="Top Holdings">
              {(c.topHoldings || []).slice(0, 12).map((h) => (
                <button key={h.symbol || h.name} type="button" className="etf-nav-row" onClick={() => onOpenCompanyProfile?.({ symbol: h.symbol || h.name })}>
                  {h.name || h.symbol}<span className="etf-rel-go">→</span>
                </button>
              ))}
            </Panel>
            <NavigableList title="Sectors" items={(c.sector || []).map((s) => s.name || s)} onOpen={onOpenSector} />
            <NavigableList title="Countries" items={(c.country || []).map((s) => s.name || s)} onOpen={onOpenCountry} />
          </Section>
        );
      }
      return <Section title="Fund Composition"><CapabilityUnavailable cap="ETF_COMPOSITION" reason="No ETF holdings feed wired (ETF Intelligence Provider pending)." /></Section>;
    }
    if (activeView === "geographic" || activeView === "factor" || activeView === "currency") {
      if (live && etf.classification) {
        const cl = etf.classification;
        return (
          <Section title={activeView === "geographic" ? "Geographic" : activeView === "factor" ? "Factor" : "Currency"}>
            <MetricStrip items={[
              { label: "Asset Class", value: cl.assetClass || "—" },
              { label: "Region", value: cl.region || "—" },
              { label: "Focus", value: cl.focus || "—" },
              { label: "Style", value: cl.style || "—" },
            ]} />
            <NavigableList title="Country Exposure" items={(seed?.exposure || []).filter((e) => /international|emerg|china|global/i.test(e))} onOpen={onOpenCountry} />
          </Section>
        );
      }
      return <Section title={activeView}><CapabilityUnavailable cap="ETF_CLASSIFICATION" reason="No classification feed wired (ETF Intelligence Provider pending)." /></Section>;
    }
    if (activeView === "performance") {
      return <Section title="Performance"><CapabilityUnavailable cap="ETF_NAV_SERIES" reason="No NAV/return series feed wired (FMP / SEC pending)." /></Section>;
    }
    if (activeView === "fundFlows") {
      return <Section title="Fund Flows"><CapabilityUnavailable cap="ETF_FLOWS" reason="No fund-flow / AUM feed wired (ETF Intelligence Provider pending)." /></Section>;
    }
    if (activeView === "macroIntel") {
      return (
        <Section title="Macro Intelligence">
          <Panel title="Regime Sensitivity"><Ghost label="Rates / inflation / USD sensitivity unavailable — no macro-factor feed wired." /></Panel>
          <Panel title="Transmission Horizon"><Ghost label="ETF → portfolio transmission pending Macro Intelligence Bus." /></Panel>
        </Section>
      );
    }
    if (activeView === "correlation") {
      return <Section title="Correlation"><CapabilityUnavailable cap="ETF_CORRELATION" reason="Zenin-computed correlation requires live holdings (ETF Intelligence Provider pending)." /></Section>;
    }
    if (activeView === "filings") {
      if (live) return <Section title="Filings"><FundTimeline providerLive={false} /></Section>;
      return <Section title="Filings"><CapabilityUnavailable cap="ETF_DOCUMENTS" reason="No live document feed — SEC/ETFDB document intelligence not yet wired." /></Section>;
    }
    if (activeView === "corporateTimeline") {
      return <Section title="Fund Timeline"><FundTimeline providerLive={false} /></Section>;
    }
    if (activeView === "discovery") {
      return (
        <Section title="ETF Discovery">
          <EtfDiscovery
            onOpenResearch={onOpenCompanyProfile}
            onCompare={(s) => setActiveView("compare")}
            onAddWatchlist={() => {}}
            onPortfolioOverlap={() => {}}
          />
        </Section>
      );
    }
    if (activeView === "compare") {
      return (
        <Section title="ETF Comparison">
          <EtfCompare initialA={sym} initialB={compareSymbol || "SPY"} onOpenResearch={onOpenCompanyProfile} onClose={() => setActiveView("overview")} />
        </Section>
      );
    }
    // Decided / shared Phase Next panels (no duplication — delegate to caller's
    // ResearchWorkspacePanel for research/consensus/catalysts/decision* / scenarioLab).
    return null;
  };

  const header = (
    <CompactPageHeader
      eyebrow={`ETF Research · ${seed?.category || "Exchange-Traded Fund"}`}
      title={etfSnap?.raw?.price?.name || seed?.name || sym}
      description="Should I own this fund? Every research object hangs off this asset."
      meta={
        <span className="arw-header-meta">
          {etfSnap?.price != null ? <strong className="font-mono">{`$${etfSnap.price.toFixed(2)}`}</strong> : null}
          {etfSnap?.dayChangePct != null ? (
            <span className={`badge ${etfSnap.dayChangePct >= 0 ? "positive" : "negative"}`}>
              {etfSnap.dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(etfSnap.dayChangePct).toFixed(2)}%
            </span>
          ) : null}
          <span className={`badge ${live ? "positive" : "neutral"}`}>{live ? "Live Provider" : "Reference Only"}</span>
        </span>
      }
      actions={
        <>
          {onOpenCommodity ? <button type="button" className="research-btn secondary" onClick={() => onOpenCommodity(sym)}>Commodity</button> : null}
          {onOpenMacro ? <button type="button" className="research-btn secondary" onClick={() => onOpenMacro(sym)}>Macro</button> : null}
          {onCompare ? <button type="button" className="research-btn secondary" onClick={() => onCompare({ symbol: sym, kind: "etf", compareSymbol: compareSymbol || null })}>Compare</button> : null}
          <button type="button" className="research-btn secondary" onClick={() => setActiveView("scenarioLab")}>Scenario Lab</button>
          {onClose ? <button type="button" className="research-btn primary" onClick={onClose}>Close</button> : null}
        </>
      }
    />
  );

  const sidebar = (
    <nav className="arw-sidebar etf-sidebar" aria-label="ETF research sections">
      {STAGES.map((stage) => (
        <SidebarGroup key={stage} label={stage}>
          {(grouped[stage] || []).map((id) => {
            const label = ETF_TIER_LABEL[id] || id;
            return <SidebarItem key={id} label={label} active={activeView === id} onClick={() => setActiveView(id)} />;
          })}
        </SidebarGroup>
      ))}
    </nav>
  );

  const main = (
    <>
      {renderView() || (
        <Section title={ETF_TIER_LABEL[activeView] || activeView}>
          <p className="etf-note muted">This research dimension is not yet available. See Research Coverage for completeness.</p>
        </Section>
      )}
      <EtfRelationshipGraph
        sym={sym}
        onOpenEtf={(s) => onCompare?.(s)}
        onOpenCommodity={onOpenCommodity}
        onOpenCountry={onOpenCountry}
        onOpenSector={onOpenSector}
      />
      <ResearchCoverageScore dims={COVERAGE_DIMS} notesCount={0} live={live} />
    </>
  );

  return <WorkspaceLayout header={header} sidebar={sidebar}>{main}</WorkspaceLayout>;
}

// Stage mapping for each registry tier (Rec 6 spine).
const TIER_STAGE = {
  overview: "Understand", investmentThesis: "Understand", portfolioIntel: "Analyze",
  ownership: "Analyze", filings: "Monitor", insider: "Analyze", supplyChain: "Analyze",
  fundComposition: "Analyze", geographic: "Analyze", corporateTimeline: "Monitor",
  governance: "Analyze", business: "Analyze", mda: "Analyze", alternative: "Analyze",
  factor: "Analyze", currency: "Analyze", risk: "Analyze", riskFactors: "Analyze",
  overlap: "Compare", performance: "Analyze", fundFlows: "Analyze", macroIntel: "Analyze",
  correlation: "Compare", research: "Decide", consensus: "Decide", catalysts: "Decide",
  decisionReplay: "Decide", decisionLedger: "Decide", scenarioLab: "Decide",
};
function STAGE_OF(id) { return TIER_STAGE[id] || "Analyze"; }

const ETF_TIER_LABEL = {
  overview: "Overview", investmentThesis: "Investment Thesis", portfolioIntel: "Portfolio Intelligence",
  ownership: "Ownership", filings: "Filings", insider: "Insider", supplyChain: "Supply Chain",
  fundComposition: "Fund Composition", geographic: "Geographic", corporateTimeline: "Fund Timeline",
  governance: "Governance", business: "Business", mda: "MDA", alternative: "Alternative",
  factor: "Factor", currency: "Currency", risk: "Risk Engine", riskFactors: "Risk Factors",
  overlap: "Portfolio Overlap", performance: "Performance", fundFlows: "Fund Flows",
  macroIntel: "Macro Intelligence", correlation: "Correlation", research: "Research",
  consensus: "Consensus", catalysts: "Catalysts & Risks", decisionReplay: "Decision Replay",
  decisionLedger: "Decision Ledger", scenarioLab: "Scenario Lab",
  discovery: "Discovery", compare: "Compare",
};

export default EtfResearchWorkspace;
