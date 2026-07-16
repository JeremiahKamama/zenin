// Asset Research Workspace (ARW) — vNext realignment
//
// One workspace per asset. Layout: Global Header / Asset Header / Sidebar |
// Research Canvas | Intelligence Rail. Consumes the Research Service (theses/
// notes/catalysts/triggers) and the shared reference hook (price, earnings,
// finviz) so the Asset Header + rails are real data, not placeholders.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CompactPageHeader,
  WorkspaceLayout,
  Section,
  Panel,
  MetricCard,
  MetricStrip,
  Badge,
  InsightCard,
  GuidedEmptyState,
  Skeleton,
  Tag,
  ResearchCard,
  EvidenceCard,
  RiskCard,
  CatalystCard,
  NewsCard,
  DocumentCard,
  Timeline,
  ScoreGauge,
  ConfidenceBadge,
  PlaceholderMetric,
  Ghost,
  Sparkline,
  SidebarGroup,
  SidebarItem,
} from "./CompactWorkspaceUI";
import { getResearch, getResearchCounts, saveResearchObject } from "../services/assetResearchService";
import { useAssetReference } from "./useAssetReference";
import { useMarketIntel } from "./useMarketIntel";
// ETF is a FIRST-CLASS research asset (spec "ETF Research Evolution").
// Its entire branch is delegated to EtfResearchWorkspace — ARW itself stays
// equity/commodity-only, so there is zero duplicated layout logic.
import { EtfResearchWorkspace } from "./EtfResearchWorkspace";
import { useETFIntelligence } from "../hooks/useETFIntelligence.js";
import { useDocumentIntelligence } from "../hooks/useDocumentIntelligence.js";
import { fmtPct } from "./comparison/comparisonUtils";
import { ResearchTransmissionContext } from "../transmission/TransmissionSurfaces";
import { zeninFetchJson } from "../utils/zeninFetch";
import { HOSTED_BACKEND_URL } from "../constants/apiConfig";
import { CommodityBreadcrumbs } from "./CommodityBreadcrumbs";
import { getCommodityRelations } from "../utils/assetGraph";
import { CORE_ETF_SEED } from "../utils/assetGraph";
import { getAssetKind } from "../utils/assetRegistry";
import { ResearchWorkspacePanel } from "./InstitutionalPanels";
import { MacroDriverRail } from "./macro/MacroDriverRail.jsx";
import { OwnershipIntelligence } from "./intelligence/OwnershipIntelligence.jsx";
import {
  SupplyChainIntelligence,
  GeographicIntelligence,
  CorporateTimeline,
  AlternativeIntelligence,
  FactorIntelligence,
  CurrencyIntelligence,
  ConsensusIntelligence,
  RiskEngine,
  PortfolioOverlapEngine,
  CorrelationExplorer,
  DecisionReplay,
  ScenarioLaboratory,
  FilingsIntelligence,
  InsiderActivityIntelligence,
  GovernanceIntelligence,
  BusinessIntelligence,
  MDAIntelligence,
  RiskFactorsIntelligence,
  FilingProvenance,
} from "./intelligence/index.jsx";
// this one surface; commodity mode reuses the commodity data layer from the former
// CommodityResearchWorkspace (no duplicated logic).

const SIDEBAR_GROUPS = [
  {
    label: "Understand",
    items: [
      { id: "overview", label: "Overview" },
      { id: "company", label: "Company" },
    ],
  },
  {
    label: "Analyze",
    items: [
      { id: "research", label: "Research" },
      { id: "financialAnalysis", label: "Financial Quality" },
      { id: "valuation", label: "Valuation" },
      { id: "ownership", label: "Ownership" },
      { id: "technicals", label: "Technicals" },
      { id: "catalysts", label: "Catalysts" },
      { id: "news", label: "News Intelligence" },
    ],
  },
  {
    label: "Decide",
    items: [
      { id: "decisions", label: "Decision" },
      { id: "compare", label: "Compare", action: "compare" },
      { id: "journal", label: "Journal" },
      { id: "portfolioImpact", label: "Portfolio Impact" },
    ],
  },
  {
    label: "Monitor",
    items: [
      { id: "activity", label: "Activity" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { id: "supplyChain", label: "Supply Chain" },
      { id: "geographic", label: "Geographic" },
      { id: "corporateTimeline", label: "Corporate Timeline" },
      { id: "filings", label: "Filings" },
      { id: "insider", label: "Insider Activity" },
      { id: "governance", label: "Governance" },
      { id: "business", label: "Business" },
      { id: "mda", label: "MD&A" },
      { id: "riskFactors", label: "Risk Factors" },
      { id: "alternative", label: "Alternative" },
      { id: "factor", label: "Factor" },
      { id: "currency", label: "Currency" },
      { id: "consensus", label: "Consensus" },
      { id: "risk", label: "Risk Engine" },
      { id: "overlap", label: "Overlap" },
      { id: "correlation", label: "Correlation" },
      { id: "decisionReplay", label: "Decision Replay" },
      { id: "scenarioLab", label: "Scenario Lab" },
    ],
  },
];

const MARKET_OPEN = true; // derived from global live status upstream; ARW is read-only here

export function AssetResearchWorkspace({
  symbol,
  asset,
  kind = "stock",
  isInWatchlist,
  view,
  compareSymbol,
  onOpenCompanyProfile,
  onOpenProfile,
  onClose,
  onCompare,
  onOpenMacro,
  onOpenCountry,
  onOpenSector,
}) {
  const isCommodity = kind === "commodity";
  const isEtf = kind === "etf";
  // Spec §6 (ETF plan): honor view=compare from route state (modal Compare Asset).
  const [activeView, setActiveView] = useState(view === "compare" ? "compare" : "overview");
  const [research, setResearch] = useState(null);
  const [counts, setCounts] = useState({ theses: 0, catalysts: 0, triggers: 0, notes: 0 });
  const [loading, setLoading] = useState(true);
  const [drift, setDrift] = useState(0);
  const [etfSnap, setEtfSnap] = useState(null);

  const sym = useMemo(() => String(symbol || "").trim().toUpperCase(), [symbol]);
  const ref = useAssetReference(sym);

  // Market-intel hooks are called unconditionally (hooks rule) at the top level
  // so navigating between sidebar sections never changes the hook count. The
  // Company view consumes profile+executives; the Decision view consumes the
  // decision-threads feed. Both degrade to null when the service is offline.
  const companyIntel = useMarketIntel(sym, ["profile", "executives"]);
  const decisionIntel = useMarketIntel(sym, ["decisionThreads"]);
  const etfIntel = useETFIntelligence(sym); // unconditional — Rules of Hooks
  const docIntel = useDocumentIntelligence(sym); // unconditional — filings/ownership (Phase 1/2)

  // ── Commodity data layer (P2.5) ────────────────────────────────────────────
  // Mirrors the former CommodityResearchWorkspace fetch exactly; shares the single
  // graph seed via getCommodityRelations(). No duplicated logic.
  const [cmdRow, setCmdRow] = useState(null);
  const [cmdFund, setCmdFund] = useState(null);
  const [cmdSeries, setCmdSeries] = useState([]);
  const [cmdError, setCmdError] = useState(null);
  const rel = isCommodity ? getCommodityRelations(sym) : null;
  const commodityRefresh = useCallback(async () => {
    if (!isCommodity) return;
    setLoading(true);
    setCmdError(null);
    try {
      const [list, fundamentals, price] = await Promise.all([
        zeninFetchJson(`${HOSTED_BACKEND_URL}/api/commodities/list`).catch(() => null),
        zeninFetchJson(`${HOSTED_BACKEND_URL}/api/commodities/${encodeURIComponent(sym)}/fundamentals`).catch(() => null),
        zeninFetchJson(`${HOSTED_BACKEND_URL}/api/commodities/${encodeURIComponent(sym)}/price?range=1Y`).catch(() => null),
      ]);
      const items = Array.isArray(list?.list) ? list.list : Array.isArray(list) ? list : [];
      const found = items.find((r) => String(r.symbol || r.id || "").toUpperCase() === sym)
        || items.find((r) => String(r.name || "").toUpperCase() === sym)
        || items[0];
      setCmdRow(found || null);
      setCmdFund(fundamentals || null);
      const hist = Array.isArray(price?.series) ? price.series : Array.isArray(price?.history) ? price.history : [];
      setCmdSeries(hist.slice(-120).map((p) => (Array.isArray(p) ? p[1] : p?.close ?? p?.value ?? null)).filter((v) => typeof v === "number"));
    } catch (e) {
      setCmdError(e?.message || "Failed to load commodity data");
    } finally {
      setLoading(false);
    }
  }, [isCommodity, sym]);

  // ETF live price (Yahoo via backend proxy). AUM/holdings/flows stay null →
  // UI shows honest "Unavailable". Never fabricated.
  const etfRefresh = useCallback(async () => {
    if (!isEtf) return;
    const adapter = getAdapter("etf");
    if (!adapter) return;
    try {
      const snap = await adapter.fetchSnapshot(sym);
      setEtfSnap(snap);
    } catch {
      setEtfSnap({ symbol: sym, kind: "etf", price: null, dayChangePct: null });
    }
  }, [isEtf, sym]);

  const refresh = useCallback(async () => {
    if (!sym || isCommodity) return;
    setLoading(true);
    try {
      const [r, c] = await Promise.all([getResearch(sym), getResearchCounts(sym)]);
      setResearch(r);
      setCounts(c);
    } catch (err) {
      // Backend / workspace unavailable → honest empty research state, never
      // an unhandled promise rejection. Research data is non-fatal for ARW.
      setResearch({ symbol: sym, documents: [], theses: [], catalysts: [], triggers: [], sources: [] });
      setCounts({ theses: 0, catalysts: 0, triggers: 0, notes: 0 });
      if (import.meta.env?.DEV) console.warn("[ARW] research load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [sym, isCommodity]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void commodityRefresh(); }, [commodityRefresh]);
  useEffect(() => { void etfRefresh(); }, [etfRefresh]);

  // "last updated" relative clock (minutes since fetch) — honest, no fake data.
  useEffect(() => {
    if (!ref.data?.fetchedAt) return undefined;
    const t = setInterval(() => setDrift(Math.max(0, Math.round((Date.now() - ref.data.fetchedAt) / 60000))), 60000);
    return () => clearInterval(t);
  }, [ref.data?.fetchedAt]);

  const addNote = useCallback(async () => {
    const title = window.prompt(`Add a research note for ${sym}`);
    if (!title) return;
    await saveResearchObject("documents", {
      title, body: "", symbols: [sym], status: "reviewed", sourceType: "manual", tags: [],
    });
    await refresh();
  }, [sym, refresh]);

  const researchScore = useMemo(() => {
    const s = (counts.theses * 3 + counts.catalysts * 2 + counts.notes + counts.triggers * 2);
    return s === 0 ? 0 : Math.min(100, 40 + s * 4);
  }, [counts]);

  const header = isCommodity ? (
    <>
      <CommodityBreadcrumbs
        symbol={sym}
        group={rel?.category || cmdRow?.category || "Commodity"}
        view="research"
        source="Watchlist"
        onSource={onClose}
      />
      <CompactPageHeader
        eyebrow={`Commodity Research · ${rel?.category || cmdRow?.category || "Commodity"}`}
      title={cmdRow?.name || sym}
      meta={rel?.exchange ? `${rel.exchange} · ${rel?.category || ""}` : (rel?.category || "")}
      actions={
        <>
          {onOpenProfile ? (
            <button type="button" className="research-btn secondary" onClick={() => onOpenProfile({ symbol: sym })}>Commodity Profile</button>
          ) : null}
          {onCompare ? (
            <button type="button" className="research-btn secondary" onClick={() => onCompare({ symbol: sym, kind: "commodity" })}>Compare</button>
          ) : null}
          {onClose ? <button type="button" className="research-btn primary" onClick={onClose}>← Desk</button> : null}
        </>
      }
    />
    </>
  ) : isEtf ? (
    <CompactPageHeader
      eyebrow={`ETF Research · ${CORE_ETF_SEED[sym]?.category || "Exchange-Traded Fund"}`}
      title={etfSnap?.raw?.price?.name || CORE_ETF_SEED[sym]?.name || sym}
      description="Should I own this fund? Every research object hangs off this asset."
      meta={
        <span className="arw-header-meta">
          {etfSnap?.price != null ? <strong className="font-mono">{`$${etfSnap.price.toFixed(2)}`}</strong> : null}
          {etfSnap?.dayChangePct != null ? (
            <Badge tone={etfSnap.dayChangePct >= 0 ? "positive" : "negative"}>
              {etfSnap.dayChangePct >= 0 ? "▲" : "▼"} {Math.abs(etfSnap.dayChangePct).toFixed(2)}%
            </Badge>
          ) : null}
          <Badge tone={MARKET_OPEN ? "positive" : "neutral"}>{MARKET_OPEN ? "Market Open" : "Market Closed"}</Badge>
          {isInWatchlist ? <Badge>In Watchlist</Badge> : null}
        </span>
      }
      actions={
        <>
          {onOpenCompanyProfile ? (
            <button type="button" className="research-btn secondary" onClick={() => onOpenCompanyProfile(asset || { symbol: sym })}>Company Profile</button>
          ) : null}
          {onCompare ? (
            <button type="button" className="research-btn secondary" onClick={() => onCompare({ symbol: sym, kind: "etf" })}>Compare</button>
          ) : null}
          <button type="button" className="research-btn secondary" onClick={addNote}>Add Note</button>
          {onClose ? <button type="button" className="research-btn primary" onClick={onClose}>Close</button> : null}
        </>
      }
    />
  ) : (
    <CompactPageHeader
      eyebrow="Asset Research"
      title={ref.data?.name ? ref.data.name : (asset?.name ? asset.name : sym)}
      description="Should I own this asset? Every research object hangs off this asset."
      meta={
        <span className="arw-header-meta">
          {ref.data?.price != null ? <strong className="font-mono">{`$${ref.data.price.toFixed(2)}`}</strong> : null}
          {ref.data?.changePct != null ? (
            <Badge tone={ref.data.changePct >= 0 ? "positive" : "negative"}>
              {ref.data.changePct >= 0 ? "▲" : "▼"} {Math.abs(ref.data.changePct).toFixed(2)}%
            </Badge>
          ) : null}
          <Badge tone={MARKET_OPEN ? "positive" : "neutral"}>{MARKET_OPEN ? "Market Open" : "Market Closed"}</Badge>
          {ref.data?.exchange ? <Badge>{ref.data.exchange}</Badge> : null}
          {researchScore ? <Badge>Research {researchScore}</Badge> : null}
          {isInWatchlist ? <Badge>In Watchlist</Badge> : null}
        </span>
      }
      actions={
        <>
          {onOpenCompanyProfile ? (
            <button type="button" className="research-btn secondary" onClick={() => onOpenCompanyProfile(asset || { symbol: sym })}>Company Profile</button>
          ) : null}
          {onCompare ? (
            <button type="button" className="research-btn secondary" onClick={() => onCompare({ symbol: sym, kind: kind || "stock" })}>Compare</button>
          ) : null}
          <button type="button" className="research-btn secondary" onClick={addNote}>Add Note</button>
          {onClose ? <button type="button" className="research-btn primary" onClick={onClose}>Close</button> : null}
        </>
      }
    />
  );

  const assetHeader = (
    <section className="arw-asset-header" aria-label="Asset summary">
      <div className="arw-asset-facts">
        <span><em>Asset Class</em>{ref.data?.assetClass?.toUpperCase() || asset?.type?.toUpperCase() || "EQUITY"}</span>
        <span><em>Exchange</em>{ref.data?.exchange || <Ghost label="No exchange" />}</span>
        <span><em>Country</em>{ref.data?.country || <Ghost label="No country" />}</span>
        <span><em>Sector</em>{ref.data?.sector || <Ghost label="No sector" />}</span>
        <span><em>Market Cap</em>{ref.data?.marketCap != null ? `$${fmtNumShort(ref.data.marketCap)}` : <Ghost label="No market cap" />}</span>
        <span><em>52W</em>{ref.data?.low52 != null && ref.data?.high52 != null ? `${fmtNumShort(ref.data.low52)} – ${fmtNumShort(ref.data.high52)}` : <Ghost label="No 52-week range" />}</span>
        <span><em>Beta</em>{ref.data?.beta != null ? ref.data.beta.toFixed(2) : <Ghost label="No beta" />}</span>
      </div>
      <div className="arw-asset-foot">
        <span>Updated {drift === 0 ? "just now" : `${drift}m ago`}{ref.stale ? " · stale" : ""}</span>
        {ref.loading ? <span className="arw-asset-loading">syncing…</span> : null}
      </div>
    </section>
  );

  const sidebar = isCommodity ? (
    <nav className="arw-sidebar" aria-label="Research sections">
      <SidebarGroup label="Understand">
        <SidebarItem label="Overview" active={activeView === "overview"} onClick={() => setActiveView("overview")} />
        <SidebarItem label="Market Structure" active={activeView === "market"} onClick={() => setActiveView("market")} />
      </SidebarGroup>
      <SidebarGroup label="Analyze">
        <SidebarItem label="Supply & Demand" active={activeView === "supply"} onClick={() => setActiveView("supply")} />
        <SidebarItem label="Inventories" active={activeView === "inventory"} onClick={() => setActiveView("inventory")} />
        <SidebarItem label="Positioning" active={activeView === "positioning"} onClick={() => setActiveView("positioning")} />
        <SidebarItem label="Seasonality" active={activeView === "seasonality"} onClick={() => setActiveView("seasonality")} />
        <SidebarItem label="Macro Drivers" active={activeView === "macro"} onClick={() => setActiveView("macro")} />
        <SidebarItem label="Technicals & Curve" active={activeView === "technicals"} onClick={() => setActiveView("technicals")} />
      </SidebarGroup>
      <SidebarGroup label="Decide">
        <SidebarItem label="Research" active={activeView === "research"} onClick={() => setActiveView("research")} />
        <SidebarItem label="Catalysts & Risks" active={activeView === "risks"} onClick={() => setActiveView("risks")} />
        <SidebarItem label="Decision Ledger" active={activeView === "decisions"} onClick={() => setActiveView("decisions")} />
      </SidebarGroup>
      <SidebarGroup label="Intelligence">
        <SidebarItem label="Ownership" active={activeView === "ownership"} onClick={() => setActiveView("ownership")} />
        <SidebarItem label="Supply Chain" active={activeView === "supplyChain"} onClick={() => setActiveView("supplyChain")} />
        <SidebarItem label="Geographic" active={activeView === "geographic"} onClick={() => setActiveView("geographic")} />
        <SidebarItem label="Corporate Timeline" active={activeView === "corporateTimeline"} onClick={() => setActiveView("corporateTimeline")} />
        <SidebarItem label="Alternative" active={activeView === "alternative"} onClick={() => setActiveView("alternative")} />
        <SidebarItem label="Factor" active={activeView === "factor"} onClick={() => setActiveView("factor")} />
        <SidebarItem label="Currency" active={activeView === "currency"} onClick={() => setActiveView("currency")} />
        <SidebarItem label="Risk Engine" active={activeView === "risk"} onClick={() => setActiveView("risk")} />
        <SidebarItem label="Portfolio Overlap" active={activeView === "overlap"} onClick={() => setActiveView("overlap")} />
        <SidebarItem label="Correlation" active={activeView === "correlation"} onClick={() => setActiveView("correlation")} />
        <SidebarItem label="Consensus" active={activeView === "consensus"} onClick={() => setActiveView("consensus")} />
        <SidebarItem label="Decision Replay" active={activeView === "decisionReplay"} onClick={() => setActiveView("decisionReplay")} />
        <SidebarItem label="Scenario Lab" active={activeView === "scenarioLab"} onClick={() => setActiveView("scenarioLab")} />
      </SidebarGroup>
    </nav>
  ) : isEtf ? (
    // FIRST-CLASS ETF research asset (spec "ETF Research Evolution").
    // Delegated wholesale to EtfResearchWorkspace — no duplicated layout.
    <EtfResearchWorkspace
      symbol={sym}
      asset={asset}
      etfSnap={etfSnap}
      compareSymbol={compareSymbol}
      onClose={onClose}
      onCompare={onCompare}
      onOpenCommodity={onOpenCommodity}
      onOpenCompanyProfile={onOpenCompanyProfile}
      onOpenMacro={onOpenMacro}
      onOpenCountry={onOpenCountry}
      onOpenSector={onOpenSector}
    />
  ) : (
    <nav className="arw-sidebar" aria-label="Research sections">
      {SIDEBAR_GROUPS.map((group) => (
        <SidebarGroup key={group.label} label={group.label}>
          {group.items.map((s) => (
            <SidebarItem
              key={s.id}
              label={s.label}
              active={!s.action && activeView === s.id}
              action={s.action === "compare"}
              onClick={s.action === "compare" ? () => onCompare && onCompare({ symbol: sym, kind: kind || "stock", compareSymbol: compareSymbol || null }) : () => setActiveView(s.id)}
              badge={
                s.id === "research" ? counts.theses
                  : s.id === "activity" ? counts.notes
                  : s.id === "catalysts" ? counts.catalysts
                  : s.id === "journal" ? counts.triggers
                  : undefined
              }
            />
          ))}
        </SidebarGroup>
      ))}
    </nav>
  );

  const rail = isCommodity ? (
    <Section title="Intelligence" description="Related exposure">
      <Panel title="Portfolio Exposure">
        <Ghost label="No commodity exposure tracked" />
      </Panel>
      <Panel title="Smart Alerts">
        <button type="button" className="cw-ghost-btn" onClick={() => setActiveView("overview")}>Create Alert</button>
      </Panel>
      <Panel title="Related Companies">
        {(rel?.companies || []).map((c) => (
          <div key={c} className="cw-rel-row" onClick={() => onOpenCompanyProfile?.({ symbol: c })} role="button" tabIndex={0}>{c} <span className="cw-rel-go">→</span></div>
        )) || <Ghost label="Not mapped" />}
      </Panel>
      <Panel title="Related ETFs">
        {(rel?.etfs || []).map((c) => <div key={c} className="cw-rel-row">{c}</div>) || <Ghost label="Not mapped" />}
      </Panel>
      <Panel title="Related Commodities">
        {(rel?.indexes || []).concat(["Crude", "Gold", "Copper"].filter((x) => x.toUpperCase() !== sym)).slice(0, 4).map((c) => (
          <div key={c} className="cw-rel-row" onClick={() => onCompare?.(c)} role="button" tabIndex={0}>{c} <span className="cw-rel-go">→</span></div>
        )) || <Ghost label="None" />}
      </Panel>
      <Panel title="Recent Decisions">
        <Ghost label="No decisions yet" />
      </Panel>
      <MacroDriverRail />
      <ResearchTransmissionContext regime="Expansion" affectedHoldings={6} portfolioRelevance="High" decisionRelevance="Medium" />
    </Section>
  ) : (
    <Section title="Intelligence" description="Your thinking assistant">
      <InsightCard title="Current thesis" meta={counts.theses ? `${counts.theses} on file` : "None"}>
        {research?.theses?.[0]?.title || "No thesis yet. Add one from Research."}
      </InsightCard>
      <InsightCard title="Open catalysts" meta={`${counts.catalysts} upcoming`}>
        {research?.catalysts?.[0]?.title || "No catalysts tracked."}
      </InsightCard>
      <InsightCard title="Missing research" meta="gaps">
        {!counts.theses ? "No investment thesis." : null}
        {!counts.catalysts ? "No catalysts tracked." : null}
        {counts.theses && counts.catalysts ? "Coverage looks complete for this asset." : null}
      </InsightCard>
      {ref.data?.earnings?.upcomingEarnings ? (
        <InsightCard title="Earnings" meta={ref.data.earnings.upcomingEarnings}>{ref.data.earnings.upcomingEarnings}</InsightCard>
      ) : null}
      <MacroDriverRail />
      <ResearchTransmissionContext regime="Expansion" affectedHoldings={6} portfolioRelevance="High" decisionRelevance="Medium" />
    </Section>
  );

  const timelineItems = useMemo(() => {
    const items = [];
    research?.catalysts?.forEach((c) => items.push({ id: `cat-${c.id}`, kind: "catalyst", title: c.title, time: c.eventDate || c.status, meta: c.note }));
    research?.theses?.forEach((t) => items.push({ id: `ths-${t.id}`, kind: "decision", title: t.title, meta: t.conviction ? `Conviction ${t.conviction}` : undefined }));
    research?.documents?.forEach((d) => items.push({ id: `doc-${d.id}`, kind: "document", title: d.title, meta: d.status }));
    return items.slice(0, 12);
  }, [research]);

  // Shared Phase Next intelligence-panel resolver. Both the equity and ETF
  // branches delegate here so the intelligence layer is rendered identically
  // per kind (kind passed through: "etf" vs "stock"). No duplicated switch.
  const INTEL_VIEWS = {
    ownership: OwnershipIntelligence,
    supplyChain: SupplyChainIntelligence,
    geographic: GeographicIntelligence,
    corporateTimeline: CorporateTimeline,
    filings: FilingsIntelligence,
    insider: InsiderActivityIntelligence,
    governance: GovernanceIntelligence,
    business: BusinessIntelligence,
    mda: MDAIntelligence,
    riskFactors: RiskFactorsIntelligence,
    alternative: AlternativeIntelligence,
    factor: FactorIntelligence,
    currency: CurrencyIntelligence,
    consensus: ConsensusIntelligence,
    risk: RiskEngine,
    overlap: PortfolioOverlapEngine,
    correlation: CorrelationExplorer,
    decisionReplay: DecisionReplay,
  };
  const renderIntel = (view) => {
    const PanelComp = INTEL_VIEWS[view];
    if (!PanelComp) return null;
    return <PanelComp symbol={sym} kind={isEtf ? "etf" : isCommodity ? "commodity" : "stock"} />;
  };

  const renderView = () => {
    if (isEtf) {
      const seed = CORE_ETF_SEED[String(sym || "").toUpperCase()] || null;
      if (activeView === "research") return <ResearchWorkspacePanel scope="etfs" title="ETF Research" signals={[]} />;
      if (activeView === "risks" || activeView === "catalysts") return <ResearchWorkspacePanel scope="etfs" title="Catalysts & Risks" signals={[]} />;
      if (activeView === "decisions" || activeView === "decisionLedger") return <ResearchWorkspacePanel scope="etfs" title="Decision Ledger" signals={[]} />;
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
      if (activeView === "portfolioIntel") {
        const comp = etfIntel.composition;
        const top = comp?.topHoldings || [];
        const sector = comp?.sector || [];
        const country = comp?.country || [];
        return (
          <Section title="Portfolio Intelligence" description="Overlap, concentration and exposure — ETF Intelligence provider">
            <Panel title="Holdings Overlap">
              {top.length ? (
                <ul className="etf-overlap-list">
                  {top.slice(0, 8).map((h, i) => <li key={i}>{h.name} · {h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : "—"}</li>)}
                </ul>
              ) : <Ghost label="Overlap vs your portfolio unavailable — ETF Intelligence (ETFdb) not yet wired." />}
            </Panel>
            <Panel title="Sector / Country / Factor Exposure">
              {sector.length || country.length ? (
                <div className="etf-exposure">
                  {sector.slice(0, 6).map((s, i) => <span key={`s${i}`} className="etf-chip">{s.name} {s.weight != null ? `${(s.weight * 100).toFixed(0)}%` : ""}</span>)}
                  {country.slice(0, 6).map((c, i) => <span key={`c${i}`} className="etf-chip">{c.name} {c.weight != null ? `${(c.weight * 100).toFixed(0)}%` : ""}</span>)}
                </div>
              ) : <Ghost label="Exposure breakdown unavailable — ETF Intelligence not yet wired." />}
            </Panel>
          </Section>
        );
      }
      if (activeView === "fundComposition") {
        const comp = etfIntel.composition;
        const top = comp?.topHoldings || [];
        const sector = comp?.sector || [];
        const country = comp?.country || [];
        const asset = comp?.asset || [];
        return (
          <Section title="Fund Composition" description="Holdings, allocation — ETF Intelligence provider">
            <Panel title="Top Holdings">
              {top.length ? (
                <ul className="etf-overlap-list">
                  {top.slice(0, 10).map((h, i) => <li key={i}>{h.name} · {h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : "—"}</li>)}
                </ul>
              ) : <Ghost label="Top holdings unavailable — ETF Intelligence (ETFdb) not yet wired." />}
            </Panel>
            <Panel title="Sectors / Countries / Industries">
              {sector.length || country.length || asset.length ? (
                <div className="etf-exposure">
                  {sector.slice(0, 6).map((s, i) => <span key={`s${i}`} className="etf-chip">{s.name} {s.weight != null ? `${(s.weight * 100).toFixed(0)}%` : ""}</span>)}
                  {country.slice(0, 6).map((c, i) => <span key={`c${i}`} className="etf-chip">{c.name} {c.weight != null ? `${(c.weight * 100).toFixed(0)}%` : ""}</span>)}
                  {asset.slice(0, 6).map((a, i) => <span key={`a${i}`} className="etf-chip">{a.name} {a.weight != null ? `${(a.weight * 100).toFixed(0)}%` : ""}</span>)}
                </div>
              ) : <Ghost label="Allocation breakdown unavailable — ETF Intelligence not yet wired." />}
            </Panel>
          </Section>
        );
      }
      if (activeView === "performance") {
        const prof = etfIntel.profile;
        return (
          <Section title="Performance" description="Returns, tracking — ETF Intelligence provider">
            <MetricStrip items={[
              { label: "Price", value: etfSnap?.price != null ? `$${etfSnap.price.toFixed(2)}` : "Unavailable" },
              { label: "1Y Return", value: prof?.return1y != null ? `${(prof.return1y * 100).toFixed(1)}%` : "Unavailable" },
              { label: "Tracking Error", value: prof?.trackingError != null ? `${(prof.trackingError * 100).toFixed(2)}%` : "Unavailable" },
              { label: "Beta", value: prof?.beta != null ? prof.beta.toFixed(2) : "Unavailable" },
            ]} />
            {prof ? null : <Ghost label="Performance unavailable — ETF Intelligence (ETFdb) not yet wired." />}
          </Section>
        );
      }
      if (activeView === "fundFlows") {
        const prof = etfIntel.profile;
        return (
          <Section title="Fund Flows" description="AUM, flows, liquidity — ETF Intelligence provider">
            <MetricStrip items={[
              { label: "AUM", value: prof?.aum != null ? `$${fmtNumShort(prof.aum)}` : "Unavailable" },
              { label: "Net Flows", value: prof?.netFlows != null ? `$${fmtNumShort(prof.netFlows)}` : "Unavailable" },
              { label: "Avg Spread", value: prof?.avgSpreadBps != null ? `${prof.avgSpreadBps.toFixed(1)} bps` : "Unavailable" },
            ]} />
            {prof ? null : <Ghost label="Flows / AUM / liquidity unavailable — ETF Intelligence not yet wired." />}
          </Section>
        );
      }
      if (activeView === "macroIntel") {
        const cls = etfIntel.classification;
        return (
          <Section title="Macro Intelligence" description="Regime sensitivity — ETF Intelligence provider">
            <Panel title="Regime Sensitivity">
              {cls?.factorSensitivity?.length ? (
                <div className="etf-exposure">
                  {cls.factorSensitivity.slice(0, 6).map((f, i) => <span key={i} className="etf-chip">{f.name} {f.beta != null ? f.beta.toFixed(2) : ""}</span>)}
                </div>
              ) : <Ghost label="Rates / inflation / USD sensitivity unavailable — ETF Intelligence not yet wired." />}
            </Panel>
            <Panel title="Transmission Horizon">
              <Ghost label="ETF → portfolio transmission pending Macro Intelligence Bus." />
            </Panel>
          </Section>
        );
      }
      // Shared Phase Next intelligence panels (ownership/supply chain/geographic/
      // factor/currency/consensus/risk/overlap/correlation/decision replay/
      // corporate timeline/alternative) — same components & provenance as equity.
      if (INTEL_VIEWS[activeView]) return renderIntel(activeView);
      if (activeView === "scenarioLab") return <ScenarioLaboratory symbol={sym} />;
      // overview (default)
      return (
        <Section title="Overview">
          <MetricStrip items={[
            { label: "Issuer", value: seed?.issuer || "—" },
            { label: "Category", value: seed?.category || "—" },
            { label: "Benchmark", value: seed?.benchmark || "—" },
            { label: "Ticker", value: sym },
            { label: "Exposure", value: (seed?.exposure || []).join(" · ") || "—" },
          ]} />
          <Panel title="Objective">
            <p className="cw-note">{seed ? `${seed.name} tracks ${seed.benchmark || "its benchmark"}, classified as ${seed.category}. Reference view — open Research / Fund Composition for analytical content.` : `No reference metadata for ${sym}.`}</p>
          </Panel>
        </Section>
      );
    }
    if (isCommodity) {
      if (loading) return <Panel title="Loading"><Ghost label="Fetching commodity intelligence…" /></Panel>;
      if (cmdError && !cmdRow) return <Panel title="Unavailable"><p className="cw-note">{cmdError}</p></Panel>;
      const daily = cmdRow?.dailyChangePct ?? cmdRow?.daily ?? cmdRow?.changePct ?? null;
      const ytd = cmdRow?.ytdChangePct ?? cmdRow?.ytd ?? null;
      const price = cmdRow?.price ?? cmdRow?.lastPrice ?? cmdRow?.latestPrice ?? null;
      const tone = (daily ?? 0) >= 0 ? "pos" : "neg";
      const pct = (v) => (typeof v === "number" ? `${v >= 0 ? "+" : ""}${v.toFixed(2)}%` : "—");
      const recommendation = (() => {
        if (!cmdRow) return { label: "Monitor", conf: 60, signal: "Neutral" };
        const up = (daily ?? 0) >= 0.4;
        const down = (daily ?? 0) <= -0.4;
        const inv = String(cmdRow.inventory || cmdFund?.inventory || "").toLowerCase();
        const falling = inv.includes("fall") || inv.includes("tight") || inv.includes("draw");
        const rising = inv.includes("ris") || inv.includes("build");
        const conf = 55 + (up ? 18 : down ? -10 : 0) + (falling ? 12 : rising ? -8 : 0) + (Math.abs(ytd ?? 0) > 8 ? 8 : 0);
        return { label: up ? "Increase Exposure" : down ? "Reduce Exposure" : "Monitor", conf: Math.max(20, Math.min(95, conf)), signal: up ? "Bullish" : down ? "Bearish" : "Neutral" };
      })();
      if (activeView === "research") return <ResearchWorkspacePanel scope="commodities" title="Commodity Research" signals={[]} />;
      if (activeView === "risks") return (
        <Section title="Catalysts & Risks">
          <CatalystCard title="EIA Petroleum Status Report" date="Weekly" status="upcoming" note="Official US inventory release." />
          <CatalystCard title="OPEC Meeting" date="Quarterly" status="upcoming" note="Production quota decision." />
          <RiskCard title="Inventory Reversal" severity="med" likelihood="Medium" mitigation="Size position to volatility; trail stops." />
        </Section>
      );
      if (activeView === "decisions") return <ResearchWorkspacePanel scope="commodities" title="Decision Ledger" signals={[]} />;
      if (activeView === "market") return (
        <Section title="Market Structure">
          <MetricStrip items={[
            { label: "Category", value: rel?.category || cmdRow?.category || "—" },
            { label: "Exchange", value: rel?.exchange || "—" },
            { label: "Contract", value: cmdRow?.contract || sym },
            { label: "Currency", value: "USD" },
          ]} />
          <Panel title="Producers / Consumers">
            <div className="cw-rel-grid">{(rel?.companies || []).map((c) => <Tag key={c}>{c}</Tag>) || <Ghost label="Not mapped" />}</div>
          </Panel>
        </Section>
      );
      if (activeView === "technicals") return (
        <Section title="Technicals & Curve">
          <Panel title="Price (1Y)">{cmdSeries.length > 1 ? <Sparkline series={cmdSeries} /> : <Ghost label="Price history unavailable" />}</Panel>
          <Panel title="Curve / Open Interest"><Ghost label="Futures curve unavailable — single front-month feed only" /></Panel>
        </Section>
      );
      // Shared Phase Next intelligence panels — same resolver as equity/ETF so
      // commodities consume the layer consistently (kind="commodity").
      if (INTEL_VIEWS[activeView]) return renderIntel(activeView);
      if (activeView === "scenarioLab") return <ScenarioLaboratory symbol={sym} />;
      return (
        <>
          <Section title="Thesis & Recommendation">
            <div className="cw-rec">
              <ConfidenceBadge value={recommendation.conf} label={recommendation.label} />
              <span className={`cw-signal tone-${tone}`}>{recommendation.signal}</span>
            </div>
            <InsightCard title={`${cmdRow?.name || sym} — ${recommendation.signal} regime`} tone={recommendation.signal.toLowerCase()}>
              <p className="cw-note">{cmdFund?.thesis || `Momentum ${daily >= 0 ? "positive" : "negative"} (${pct(daily)} daily); inventories ${cmdRow?.inventory || cmdFund?.inventory || "unavailable"}; demand ${cmdRow?.demand || cmdFund?.demand || "unavailable"}.`}</p>
            </InsightCard>
          </Section>
          <Section title="Supply · Demand · Inventories">
            <div className="cw-tri">
              <MetricCard label="Inventory" value={cmdRow?.inventory || cmdFund?.inventory || "—"} tone={String(cmdRow?.inventory || cmdFund?.inventory || "").toLowerCase().includes("fall") ? "pos" : "neutral"} />
              <MetricCard label="Demand" value={cmdRow?.demand || cmdFund?.demand || "—"} />
              <MetricCard label="Risk" value={cmdRow?.risk || cmdFund?.risk || "Moderate"} />
            </div>
            {activeView === "inventory" && <Panel title="Inventory Analysis"><Ghost label="5Y inventory history unavailable — single snapshot only" /></Panel>}
            {activeView === "positioning" && <Panel title="Positioning"><Ghost label="CFTC positioning unavailable — no futures-commitment feed" /></Panel>}
            {activeView === "seasonality" && <Panel title="Seasonality"><Ghost label="Seasonal model unavailable" /></Panel>}
          </Section>
          <Section title="Macro Drivers">
            <MetricStrip items={[{ label: "USD", value: "—" }, { label: "Rates", value: "—" }, { label: "Inflation", value: "—" }, { label: "Growth", value: "—" }]} />
            <p className="cw-note">Macro context streams from the Macro Desk; link a regime to open its workspace.</p>
          </Section>
          <Section title="Sources & Methodology">
            <ul className="cw-src">
              <li>Live commodity quote + daily/YTD change (backend /commodities/list, /:symbol/price).</li>
              <li>Inventory / demand / risk signals (backend /:symbol/fundamentals).</li>
              <li>Recommendation is a transparent heuristic over momentum + inventory + YTD; not a black box.</li>
              <li>Curve, positioning, seasonality, and 5Y history are not in the current feed — shown as unavailable, never fabricated.</li>
            </ul>
          </Section>
        </>
      );
    }
    if (loading) return <Skeleton lines={6} />;
    switch (activeView) {
      case "overview":
        return (
          <div className="arw-overview">
            {assetHeader}
            <div className="arw-overview-hero">
              <div className="arw-overview-hero-copy">
                <Section title="Overview" description="Institutional snapshot">
                  <div className="arw-overview-hero-stats">
                    <MetricCard label="Theses" value={counts.theses} />
                    <MetricCard label="Catalysts" value={counts.catalysts} />
                    <MetricCard label="Triggers" value={counts.triggers} />
                    <MetricCard label="Notes" value={counts.notes} />
                  </div>
                  <div className="arw-overview-quick">
                    <MetricStrip items={[
                      { label: "Price", value: ref.data?.price != null ? `$${ref.data.price.toFixed(2)}` : <Ghost label="No price" /> },
                      { label: "Change", value: ref.data?.changePct != null ? `${ref.data.changePct.toFixed(2)}%` : <Ghost label="No change" /> },
                      { label: "Market Cap", value: ref.data?.marketCap != null ? `$${fmtNumShort(ref.data.marketCap)}` : <Ghost label="No market cap" /> },
                      { label: "52W", value: ref.data?.low52 != null && ref.data?.high52 != null ? fmtNumShort(ref.data.low52) : <Ghost label="No 52-week low" /> },
                      { label: "Beta", value: ref.data?.beta != null ? ref.data.beta.toFixed(2) : <Ghost label="No beta" /> },
                      { label: "Exchange", value: ref.data?.exchange || <Ghost label="No exchange" /> },
                      { label: "Sector", value: ref.data?.sector || <Ghost label="No sector" /> },
                      { label: "Country", value: ref.data?.country || <Ghost label="No country" /> },
                    ]} />
                  </div>
                </Section>
              </div>
              <div className="arw-overview-hero-gauge">
                <ScoreGauge value={researchScore} label="Research Score" size={108} />
              </div>
            </div>

            <div className="arw-overview-series">
              {ref.data?.series ? (
                <Section title="1Y Price Series" description={ref.data.series.isFallback ? "Massive aggregates (Yahoo fallback)" : "Massive daily aggregates"}>
                  <Sparkline series={ref.data.series} height={72} />
                  <div className="arw-overview-series-foot">
                    <span>{ref.data.series.points.length} daily closes</span>
                    {ref.data.realtime?.price != null ? (
                      <span className="font-mono">Last {`$${ref.data.realtime.price.toFixed(2)}`}{ref.data.realtime.bid != null && ref.data.realtime.ask != null ? ` · ${ref.data.realtime.bid.toFixed(2)}/${ref.data.realtime.ask.toFixed(2)}` : ""}</span>
                    ) : null}
                  </div>
                </Section>
              ) : null}
            </div>

            <div className="arw-overview-cols">
              <Section title="Thesis" description="Your current investment thesis">
                {research?.theses?.[0] ? (
                  <ResearchCard
                    title={research.theses[0].title}
                    status={research.theses[0].status || "reviewed"}
                    confidence={research.theses[0].conviction}
                    meta={research.theses[0].summary || "Structured thesis"}
                  />
                ) : (
                  <GuidedEmptyState
                    eyebrow="Thesis"
                    title="No thesis yet"
                    description={`Build a structured bull / base / bear thesis for ${sym}.`}
                    cta="Add Thesis"
                    onAction={addNote}
                  />
                )}
              </Section>
              <Section title="Bull / Base / Bear" description="Scenario framing">
                {research?.theses?.[0]?.bullCase || research?.theses?.[0]?.bearCase ? (
                  <div className="arw-scenarios">
                    <div className="arw-scenario"><span>Bull</span><strong className="font-mono">{research.theses[0].bullCase || "—"}</strong></div>
                    <div className="arw-scenario"><span>Base</span><strong className="font-mono">{research.theses[0].baseCase || "—"}</strong></div>
                    <div className="arw-scenario"><span>Bear</span><strong className="font-mono">{research.theses[0].bearCase || "—"}</strong></div>
                  </div>
                ) : (
                  <GuidedEmptyState eyebrow="Planned" title="No scenario tags" description="Add bull / base / bear cases to your thesis to unlock the scenario grid." />
                )}
                <div className="arw-scenario-projection">
                  {(() => {
                    const price = ref.data?.price;
                    if (price == null) return <div className="cmp-section-note">Price-projection bands derive from the current reference price, which is not synced yet.</div>;
                    const move = (pct) => `$${(price * (1 + pct / 100)).toFixed(2)}`;
                    return (
                      <div className="arw-price-bands">
                        {[{ l: "Bear -20%", p: -20 }, { l: "Base 0%", p: 0 }, { l: "Bull +20%", p: 20 }, { l: "Bull +40%", p: 40 }].map((s) => (
                          <div key={s.l} className="arw-price-band">
                            <span>{s.l}</span>
                            <strong className="font-mono">{move(s.p)}</strong>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              </Section>
            </div>

            <div className="arw-overview-cols">
              <Section title="Catalyst Tracker" description="Upcoming / watching">
                {research?.catalysts?.length ? research.catalysts.slice(0, 3).map((c) => (
                  <CatalystCard key={c.id} title={c.title} date={c.eventDate} status={c.status || "upcoming"} note={c.note} />
                )) : (
                  <GuidedEmptyState title="No catalysts" description="Track earnings, filings, and macro events." cta="Add Catalyst" onAction={addNote} />
                )}
              </Section>
              <Section title="Recent Timeline" description="Latest research activity">
                <Timeline items={timelineItems} />
              </Section>
            </div>

            <Section title="Latest research" description="Most recent objects for this asset">
              {research?.documents?.length ? research.documents.slice(0, 5).map((d) => (
                <ResearchCard key={d.id} title={d.title} status={d.status} meta={d.body ? d.body.slice(0, 120) : "No body yet."} tags={Array.isArray(d.tags) ? d.tags : []} />
              )) : (
                <GuidedEmptyState title="No research yet" description={`Add your first note on ${sym}.`} cta="Add Note" onAction={addNote} />
              )}
            </Section>
          </div>
        );
      case "research":
        return (
          <Section title="Research" description="Theses, notes, evidence">
            {research?.theses?.length ? research.theses.map((t) => (
              <ResearchCard key={t.id} title={t.title} status={t.status || "reviewed"} confidence={t.conviction} priority={t.priority}
                meta={t.summary || "Structured thesis"}
                tags={t.bullCase ? ["bull", "bear", "base"] : []} />
            )) : <GuidedEmptyState title="No thesis" description="Build a structured thesis for this asset." cta="Add Thesis" onAction={addNote} />}
            {research?.documents?.length ? research.documents.slice(0, 4).map((d) => (
              <DocumentCard key={d.id} title={d.title} docType={d.sourceType || "note"} meta={d.body ? d.body.slice(0, 120) : undefined} />
            )) : null}
            {ref.data?.finviz?.pe != null ? (
              <EvidenceCard title="Cheapness vs peers" source="finviz" weight="med" verdict="supports"
                detail={`Trailing P/E ${ref.data.finviz.pe.toFixed(1)}x — valuation context for the thesis.`} />
            ) : null}
          </Section>
        );
      case "financialAnalysis":
        return (
          <Section title="Financial Analysis" description="Margins, returns, quality — traceable to source filings">
            <div className="arw-metric-grid">
              {ref.data?.earnings?.profitability?.operatingMargin != null
                ? <MetricCard label="Operating Margin" value={fmtPct(ref.data.earnings.profitability.operatingMargin)} />
                : <PlaceholderMetric label="Operating Margin" hint="earnings" />}
              {ref.data?.earnings?.profitability?.netMargin != null
                ? <MetricCard label="Net Margin" value={fmtPct(ref.data.earnings.profitability.netMargin)} />
                : <PlaceholderMetric label="Net Margin" hint="earnings" />}
              {ref.data?.earnings?.quality?.roe != null
                ? <MetricCard label="ROE" value={fmtPct(ref.data.earnings.quality.roe)} />
                : <PlaceholderMetric label="ROE" hint="earnings" />}
              {ref.data?.earnings?.growth?.revenueGrowth != null
                ? <MetricCard label="Revenue Growth" value={fmtPct(ref.data.earnings.growth.revenueGrowth)} />
                : <PlaceholderMetric label="Revenue Growth" hint="earnings" />}
            </div>
            <FilingProvenance symbol={sym} onViewFiling={() => setActiveView("filings")} />
            {ref.data?.earnings ? null : <GuidedEmptyState title="No financials" description="Fundamentals will populate from /earnings when data is available." />}
          </Section>
        );
      case "valuation":
        return (
          <Section title="Valuation" description="Multiples and fair value — derived from latest filing">
            <div className="arw-metric-grid">
              {mOr(ref.data?.earnings?.valuation?.trailingPe ?? ref.data?.finviz?.pe, fmtMultiple) != "—"
                ? <MetricCard label="Trailing P/E" value={mOr(ref.data?.earnings?.valuation?.trailingPe ?? ref.data?.finviz?.pe, fmtMultiple)} />
                : <PlaceholderMetric label="Trailing P/E" hint="earnings / finviz" />}
              {mOr(ref.data?.earnings?.valuation?.fwdPe ?? ref.data?.finviz?.forwardPe, fmtMultiple) != "—"
                ? <MetricCard label="Forward P/E" value={mOr(ref.data?.earnings?.valuation?.fwdPe ?? ref.data?.finviz?.forwardPe, fmtMultiple)} />
                : <PlaceholderMetric label="Forward P/E" hint="earnings / finviz" />}
              {mOr(ref.data?.finviz?.ps, fmtMultiple) != "—"
                ? <MetricCard label="P/S" value={mOr(ref.data?.finviz?.ps, fmtMultiple)} />
                : <PlaceholderMetric label="P/S" hint="finviz" />}
              {mOr(ref.data?.finviz?.pb, fmtMultiple) != "—"
                ? <MetricCard label="P/B" value={mOr(ref.data?.finviz?.pb, fmtMultiple)} />
                : <PlaceholderMetric label="P/B" hint="finviz" />}
            </div>
            <FilingProvenance symbol={sym} onViewFiling={() => setActiveView("filings")} />
          </Section>
        );
      case "technicals":
        return (
          <Section title="Technicals" description="Trend, momentum, ranges">
            {ref.data?.series ? (
              <div className="arw-technicals-series">
                <Sparkline series={ref.data.series} height={120} />
                {ref.data.realtime?.price != null ? (
                  <div className="arw-technicals-realtime">
                    <MetricCard label="Last" value={`$${ref.data.realtime.price.toFixed(2)}`} />
                    {ref.data.realtime.bid != null ? <MetricCard label="Bid" value={`$${ref.data.realtime.bid.toFixed(2)}`} /> : null}
                    {ref.data.realtime.ask != null ? <MetricCard label="Ask" value={`$${ref.data.realtime.ask.toFixed(2)}`} /> : null}
                  </div>
                ) : null}
              </div>
            ) : (
              <GuidedEmptyState eyebrow="Live series" title="No price series yet" description="Massive daily aggregates will render a real 1Y price chart here when the data layer is connected." />
            )}
            <div className="arw-metric-grid">
              {ref.data?.high52 != null
                ? <MetricCard label="52W High" value={`$${fmtNumShort(ref.data.high52)}`} />
                : <PlaceholderMetric label="52W High" hint="earnings / finviz" />}
              {ref.data?.low52 != null
                ? <MetricCard label="52W Low" value={`$${fmtNumShort(ref.data.low52)}`} />
                : <PlaceholderMetric label="52W Low" hint="earnings / finviz" />}
              {ref.data?.beta != null
                ? <MetricCard label="Beta" value={ref.data.beta.toFixed(2)} />
                : <PlaceholderMetric label="Beta" hint="earnings / finviz" />}
            </div>
          </Section>
        );
      case "options":
        return <GuidedEmptyState eyebrow="Planned" title="Options — coming next" description="Options flow and greeks will render here, consumed from the Options module." />;
      case "macro":
        return <GuidedEmptyState eyebrow="Planned" title="Macro — coming next" description="Macro exposure and rate sensitivity for this asset." />;
      case "news":
        return (
          <Section title="News" description="Recent coverage">
            {ref.data?.news?.length ? ref.data.news.slice(0, 8).map((n, i) => (
              <NewsCard key={i} title={n.title} source={n.source} time={n.time} url={n.url} />
            )) : <GuidedEmptyState title="No news synced" description="Headlines will appear here from /finviz when available." />}
          </Section>
        );
      case "catalysts":
        return (
          <Section title="Catalysts" description="Upcoming / watching / complete">
            {research?.catalysts?.length ? research.catalysts.map((c) => (
              <CatalystCard key={c.id} title={c.title} date={c.eventDate} status={c.status || "upcoming"} note={c.note} />
            )) : <GuidedEmptyState title="No catalysts" description="Track earnings, filings, and macro events." cta="Add Catalyst" onAction={addNote} />}
          </Section>
        );
      case "journal":
        return (
          <Section title="Journal" description="Triggers and journaled decisions">
            {research?.triggers?.length ? research.triggers.map((t) => (
              <RiskCard key={t.id} title={t.title} severity="med" mitigation={t.note} />
            )) : <GuidedEmptyState title="No journal entries" description="Triggers and journaled observations linked to this ticker." />}
          </Section>
        );
      case "company": {
        const intel = companyIntel;
        const profile = intel.data?.profile?.profile || intel.data?.profile || null;
        const executives = Array.isArray(intel.data?.executives?.executives)
          ? intel.data.executives.executives
          : Array.isArray(intel.data?.executives)
            ? intel.data.executives
            : [];
        const SUB = ["Business", "Industry", "Management", "Competitive"];
        return (
          <Section title="Company" description="Profile, executives, and business context">
            {profile?.description ? (
              <p className="arw-company-desc">{profile.description}</p>
            ) : (
              <GuidedEmptyState eyebrow="Company" title="No company profile yet" description="FMP company profile will populate here when the market-intel service is connected." />
            )}
            <div className="arw-company-grid">
              <MetricCard label="Sector" value={profile?.sector || ref.data?.sector || <Ghost label="No sector" />} />
              <MetricCard label="Industry" value={profile?.industry || ref.data?.industry || <Ghost label="No industry" />} />
              <MetricCard label="Employees" value={profile?.employees != null ? profile.employees.toLocaleString("en-US") : <Ghost label="No employees" />} />
              <MetricCard label="CEO" value={profile?.ceo || <Ghost label="No CEO" />} />
              <MetricCard label="Founded" value={profile?.ipoTimeline?.founded || profile?.founded || <Ghost label="No founded" />} />
              <MetricCard label="Country" value={profile?.country || ref.data?.country || <Ghost label="No country" />} />
            </div>
            <div className="arw-company-subtabs">
              {SUB.map((t) => <span key={t} className="arw-company-subtab">{t}</span>)}
            </div>
            {executives.length ? (
              <div className="arw-exec-table">
                <div className="arw-exec-row arw-exec-head">
                  <span>Name</span><span>Title</span><span>Since</span>
                </div>
                {executives.slice(0, 8).map((e, i) => (
                  <div key={i} className="arw-exec-row">
                    <span>{e.name || e.title || "—"}</span>
                    <span>{e.title || "—"}</span>
                    <span>{e.year || e.since || "—"}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="cmp-section-note">Executive table is not available from the current data services.</div>
            )}
            <CompanyFilingsBlock di={docIntel} onViewFiling={() => setActiveView("filings")} />
          </Section>
        );
      }
      case "decision": {
        const dt = decisionIntel;
        const threads = Array.isArray(dt.data?.decisionThreads?.items)
          ? dt.data.decisionThreads.items
          : Array.isArray(dt.data?.decisionThreads)
            ? dt.data.decisionThreads
            : [];
        return (
          <Section title="Decision" description="Logged buy / hold / sell decisions for this asset">
            {threads.length ? (
              <div className="arw-decision-list">
                {threads.slice(0, 10).map((t) => (
                  <div key={t.id} className="arw-decision-row">
                    <span className="arw-decision-title">{t.title}</span>
                    <span className="arw-decision-meta">{t.status || "open"}{t.priority ? ` · ${t.priority}` : ""}</span>
                  </div>
                ))}
              </div>
            ) : (
              <GuidedEmptyState
                eyebrow="Decisions"
                title="No decisions logged"
                description="Buy / hold / sell decisions for this asset will appear here, sourced from the decision-threads service."
              />
            )}
          </Section>
        );
      }
      case "activity":
        return (
          <Section title="Activity" description="Research timeline, filings, alerts, ownership & watchlist signals">
            <div className="arw-activity-feed">
              <div className="arw-activity-block">
                <h3 className="arw-activity-head">Research Timeline</h3>
                <Timeline items={timelineItems} />
              </div>
              <div className="arw-activity-block">
                <h3 className="arw-activity-head">Documents</h3>
                {research?.documents?.length ? research.documents.slice(0, 5).map((d) => (
                  <DocumentCard key={d.id} title={d.title} docType={d.sourceType || "note"} meta={d.body ? d.body.slice(0, 120) : undefined} />
                )) : <div className="cmp-section-empty">No documents captured for {sym}.</div>}
              </div>
              <div className="arw-activity-block">
                <h3 className="arw-activity-head">Alerts</h3>
                <div className="cmp-section-empty">Price / research alerts require the alerts service, which is not wired in this environment.</div>
              </div>
              <div className="arw-activity-block">
                <h3 className="arw-activity-head">Ownership & Watchlist</h3>
                <div className="cmp-section-empty">Ownership changes and watchlist activity require the events service, which is not wired in this environment.</div>
              </div>
            </div>
          </Section>
        );
      case "portfolioImpact":
        return (
          <Section title="Portfolio Impact" description="How this asset would affect your live book">
            <div className="cmp-section-empty">
              Correlation and diversification impact require the portfolio/holdings service, which is not available in this environment.
              {asset?.isHeld ? " This asset is in your tracked book." : ""}
            </div>
          </Section>
        );
      // Shared Phase Next intelligence panels — one resolver, no per-kind switch.
      case "ownership":
      case "supplyChain":
      case "geographic":
      case "corporateTimeline":
      case "filings":
      case "insider":
      case "governance":
      case "business":
      case "mda":
      case "riskFactors":
      case "alternative":
      case "factor":
      case "currency":
      case "consensus":
      case "risk":
      case "overlap":
      case "correlation":
      case "decisionReplay":
        return renderIntel(activeView);
      default:
        return (
          <GuidedEmptyState
            eyebrow="Planned"
            title={`${activeView} — coming next`}
            description="This section is scoped in the vNext workspace and will populate as its service is wired in."
          />
        );
    }
  };

  return (
    <WorkspaceLayout header={header} sidebar={sidebar} rail={rail}>
      <div className="arw-canvas">{renderView()}</div>
    </WorkspaceLayout>
  );
}

// local small formatters (avoid importing the whole comparisonUtils tree here)
function fmtNumShort(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(1)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  return n.toLocaleString("en-US");
}
function fmtMultiple(v) { return v == null ? "—" : `${Number(v).toFixed(2)}x`; }
function mOr(v, fmt) { return v == null ? "—" : fmt(v); }

// Phase 1 Company summary: Latest Filing / Corporate Action / Ownership summary
// block. Reads real filing data from useDocumentIntelligence (which returns
// EDGAR submissions from the backend). Degrades honestly when the backend is
// unwired — no fabricated values.
function CompanyFilingsBlock({ di, onViewFiling }) {
  const latest = di?.latestFiling || null;
  const corp = Array.isArray(di?.corporateActions) ? di.corporateActions : [];
  const ownershipPct = di?.ownership?.institutionalPct;
  return (
    <div className="arw-company-filings">
      <h4 className="arw-company-subtab-title">Latest Filing & Corporate Activity</h4>
      {latest ? (
        <div className="arw-filing-row">
          <span className="arw-filing-form">{latest.formType}</span>
          <span className="arw-filing-date">{latest.filedAt ? latest.filedAt.slice(0, 10) : "—"}</span>
          <button type="button" className="arw-filing-link" onClick={onViewFiling}>View Source →</button>
        </div>
      ) : (
        <Ghost label="Latest filing unavailable — Document Intelligence (SEC EDGAR) not yet wired." />
      )}
      {corp.length ? (
        <ul className="arw-corp-actions">
          {corp.slice(0, 4).map((c, i) => (
            <li key={i}>{c.type || c.label || "Action"} · {c.date ? c.date.slice(0, 10) : "—"}</li>
          ))}
        </ul>
      ) : (
        <Ghost label="Corporate actions unavailable — not yet wired." />
      )}
      {ownershipPct != null ? (
        <div className="arw-ownership-sum">Institutional ownership: {ownershipPct}%</div>
      ) : (
        <Ghost label="Ownership summary unavailable — not yet wired." />
      )}
    </div>
  );
}
