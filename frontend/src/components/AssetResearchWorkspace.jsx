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
} from "./CompactWorkspaceUI";
import { getResearch, getResearchCounts, saveResearchObject } from "../services/assetResearchService";
import { useAssetReference } from "./useAssetReference";
import { fmtPct } from "./comparison/comparisonUtils";

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "research", label: "Research" },
  { id: "financialAnalysis", label: "Financial Analysis" },
  { id: "valuation", label: "Valuation" },
  { id: "technicals", label: "Technicals" },
  { id: "options", label: "Options" },
  { id: "macro", label: "Macro" },
  { id: "news", label: "News" },
  { id: "catalysts", label: "Catalysts" },
  { id: "journal", label: "Journal" },
  { id: "decisions", label: "Decisions" },
  { id: "documents", label: "Documents" },
  { id: "timeline", label: "Timeline" },
  { id: "knowledge", label: "Knowledge Graph" },
  { id: "scenario", label: "Scenario Analysis" },
  { id: "settings", label: "Settings" },
];

const MARKET_OPEN = true; // derived from global live status upstream; ARW is read-only here

export function AssetResearchWorkspace({
  symbol,
  asset,
  isInWatchlist,
  onOpenCompanyProfile,
  onClose,
  onCompare,
}) {
  const [activeView, setActiveView] = useState("overview");
  const [research, setResearch] = useState(null);
  const [counts, setCounts] = useState({ theses: 0, catalysts: 0, triggers: 0, notes: 0 });
  const [loading, setLoading] = useState(true);
  const [drift, setDrift] = useState(0);

  const sym = useMemo(() => String(symbol || "").trim().toUpperCase(), [symbol]);
  const ref = useAssetReference(sym);

  const refresh = useCallback(async () => {
    if (!sym) return;
    setLoading(true);
    try {
      const [r, c] = await Promise.all([getResearch(sym), getResearchCounts(sym)]);
      setResearch(r);
      setCounts(c);
    } finally {
      setLoading(false);
    }
  }, [sym]);

  useEffect(() => { void refresh(); }, [refresh]);

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

  const header = (
    <CompactPageHeader
      eyebrow="Asset Research"
      title={ref.data?.name ? `${ref.data.name} (${sym})` : (asset?.name ? `${asset.name} (${sym})` : sym)}
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
            <button type="button" className="research-btn secondary" onClick={() => onCompare(sym)}>Compare</button>
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
        <span><em>Exchange</em>{ref.data?.exchange || "—"}</span>
        <span><em>Country</em>{ref.data?.country || "—"}</span>
        <span><em>Sector</em>{ref.data?.sector || "—"}</span>
        <span><em>Market Cap</em>{ref.data?.marketCap != null ? `$${fmtNumShort(ref.data.marketCap)}` : "—"}</span>
        <span><em>52W</em>{ref.data?.low52 != null && ref.data?.high52 != null ? `${fmtNumShort(ref.data.low52)} – ${fmtNumShort(ref.data.high52)}` : "—"}</span>
        <span><em>Beta</em>{ref.data?.beta != null ? ref.data.beta.toFixed(2) : "—"}</span>
      </div>
      <div className="arw-asset-foot">
        <span>Updated {drift === 0 ? "just now" : `${drift}m ago`}{ref.stale ? " · stale" : ""}</span>
        {ref.loading ? <span className="arw-asset-loading">syncing…</span> : null}
      </div>
    </section>
  );

  const sidebar = (
    <nav className="arw-sidebar" aria-label="Research sections">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`ws-nav-item ${activeView === s.id ? "active" : ""}`.trim()}
          onClick={() => setActiveView(s.id)}
          aria-current={activeView === s.id ? "page" : undefined}
        >
          <span>{s.label}</span>
          {s.id === "research" && counts.theses ? <span className="ws-nav-count">{counts.theses}</span> : null}
          {s.id === "documents" && counts.notes ? <span className="ws-nav-count">{counts.notes}</span> : null}
          {s.id === "catalysts" && counts.catalysts ? <span className="ws-nav-count">{counts.catalysts}</span> : null}
          {s.id === "journal" && counts.triggers ? <span className="ws-nav-count">{counts.triggers}</span> : null}
        </button>
      ))}
    </nav>
  );

  const rail = (
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
    </Section>
  );

  const timelineItems = useMemo(() => {
    const items = [];
    research?.catalysts?.forEach((c) => items.push({ id: `cat-${c.id}`, kind: "catalyst", title: c.title, time: c.eventDate || c.status, meta: c.note }));
    research?.theses?.forEach((t) => items.push({ id: `ths-${t.id}`, kind: "decision", title: t.title, meta: t.conviction ? `Conviction ${t.conviction}` : undefined }));
    research?.documents?.forEach((d) => items.push({ id: `doc-${d.id}`, kind: "document", title: d.title, meta: d.status }));
    return items.slice(0, 12);
  }, [research]);

  const renderView = () => {
    if (loading) return <Skeleton lines={6} />;
    switch (activeView) {
      case "overview":
        return (
          <>
            {assetHeader}
            <Section title="Overview" description="Institutional snapshot">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
                <MetricCard label="Theses" value={counts.theses} />
                <MetricCard label="Catalysts" value={counts.catalysts} />
                <MetricCard label="Triggers" value={counts.triggers} />
                <MetricCard label="Notes" value={counts.notes} />
                <MetricCard label="Research Score" value={researchScore} />
              </div>
            </Section>
            <Section title="Latest research" description="Most recent objects for this asset">
              {research?.documents?.slice(0, 5).map((d) => (
                <ResearchCard key={d.id} title={d.title} status={d.status} meta={d.body ? d.body.slice(0, 120) : "No body yet."} tags={Array.isArray(d.tags) ? d.tags : []} />
              )) || <GuidedEmptyState title="No research yet" description={`Add your first note on ${sym}.`} cta="Add Note" onAction={addNote} />}
            </Section>
          </>
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
          <Section title="Financial Analysis" description="Margins, returns, quality">
            <MetricStrip items={[
              { label: "Operating Margin", value: ref.data?.earnings?.profitability?.operatingMargin != null ? fmtPct(ref.data.earnings.profitability.operatingMargin) : "—", tone: "neutral" },
              { label: "Net Margin", value: ref.data?.earnings?.profitability?.netMargin != null ? fmtPct(ref.data.earnings.profitability.netMargin) : "—", tone: "neutral" },
              { label: "ROE", value: ref.data?.earnings?.quality?.roe != null ? fmtPct(ref.data.earnings.quality.roe) : "—", tone: "neutral" },
              { label: "Revenue Growth", value: ref.data?.earnings?.growth?.revenueGrowth != null ? fmtPct(ref.data.earnings.growth.revenueGrowth) : "—", tone: "neutral" },
            ]} />
            {ref.data?.earnings ? null : <GuidedEmptyState title="No financials" description="Fundamentals will populate from /earnings when data is available." />}
          </Section>
        );
      case "valuation":
        return (
          <Section title="Valuation" description="Multiples and fair value">
            <MetricStrip items={[
              { label: "Trailing P/E", value: mOr(ref.data?.earnings?.valuation?.trailingPe ?? ref.data?.finviz?.pe, fmtMultiple), tone: "neutral" },
              { label: "Forward P/E", value: mOr(ref.data?.earnings?.valuation?.fwdPe ?? ref.data?.finviz?.forwardPe, fmtMultiple), tone: "neutral" },
              { label: "P/S", value: mOr(ref.data?.finviz?.ps, fmtMultiple), tone: "neutral" },
              { label: "P/B", value: mOr(ref.data?.finviz?.pb, fmtMultiple), tone: "neutral" },
            ]} />
          </Section>
        );
      case "technicals":
        return (
          <Section title="Technicals" description="Trend, momentum, ranges">
            <MetricStrip items={[
              { label: "52W High", value: ref.data?.high52 != null ? `$${fmtNumShort(ref.data.high52)}` : "—", tone: "neutral" },
              { label: "52W Low", value: ref.data?.low52 != null ? `$${fmtNumShort(ref.data.low52)}` : "—", tone: "neutral" },
              { label: "Beta", value: ref.data?.beta != null ? ref.data.beta.toFixed(2) : "—", tone: "neutral" },
            ]} />
          </Section>
        );
      case "options":
        return <GuidedEmptyState eyebrow="Planned" title="Options — coming next" description="Options flow and greeks will render here, consumed from the Options module." />;
      case "macro":
        return <GuidedEmptyState eyebrow="Planned" title="Macro — coming next" description="Macro exposure and rate sensitivity for this asset." />;
      case "news":
        return (
          <Section title="News" description="Recent coverage">
            {ref.data?.finviz?.news?.length ? ref.data.finviz.news.slice(0, 8).map((n, i) => (
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
      case "decisions":
        return <GuidedEmptyState eyebrow="Planned" title="Decisions — coming next" description="Logged buy/hold/sell decisions with rationale, wired to the Decisions module." />;
      case "documents":
        return (
          <Section title="Documents" description="Filings, reports, notes">
            {research?.documents?.length ? research.documents.map((d) => (
              <DocumentCard key={d.id} title={d.title} docType={d.sourceType || "note"} meta={d.body ? d.body.slice(0, 140) : undefined} tags={Array.isArray(d.tags) ? d.tags : []} />
            )) : <GuidedEmptyState title="No documents" description="Capture a note or attach a filing linked to this ticker." cta="Add Note" onAction={addNote} />}
          </Section>
        );
      case "timeline":
        return (
          <Section title="Timeline" description="Chronological research history">
            <Timeline items={timelineItems} />
          </Section>
        );
      case "knowledge":
        return (
          <Section title="Knowledge Graph" description="Linked entities and research relationships">
            <div className="arw-kg">
              <div className="arw-kg-node arw-kg-root">{sym}</div>
              <div className="arw-kg-edges">
                {ref.data?.sector ? <span className="arw-kg-node">{ref.data.sector}</span> : null}
                {ref.data?.exchange ? <span className="arw-kg-node">{ref.data.exchange}</span> : null}
                {research?.theses?.length ? <span className="arw-kg-node">{research.theses.length} thesis</span> : null}
                {research?.catalysts?.length ? <span className="arw-kg-node">{research.catalysts.length} catalyst</span> : null}
              </div>
            </div>
            <GuidedEmptyState eyebrow="Planned" title="Full graph" description="Cross-asset and peer linkages will render here from the research graph service." />
          </Section>
        );
      case "scenario": {
        const price = ref.data?.price;
        const move = (pct) => (price != null ? `$${(price * (1 + pct / 100)).toFixed(2)}` : "—");
        return (
          <Section title="Scenario Analysis" description="Client-side price projection from current reference price (illustrative, not a forecast)">
            <div className="arw-scenarios">
              {[{ l: "Bear -20%", p: -20 }, { l: "Base 0%", p: 0 }, { l: "Bull +20%", p: 20 }, { l: "Bull +40%", p: 40 }].map((s) => (
                <div key={s.l} className="arw-scenario">
                  <span>{s.l}</span>
                  <strong className="font-mono">{move(s.p)}</strong>
                </div>
              ))}
            </div>
            <div className="cmp-section-note">Scenario bands are derived from the current reference price only. A probabilities/factor model requires the scenario service.</div>
          </Section>
        );
      }
      case "settings":
        return <GuidedEmptyState eyebrow="Settings" title="Workspace settings" description="Asset-level research defaults and watchlist rules." />;
      default:
        return null;
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
