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
import { fmtPct } from "./comparison/comparisonUtils";

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

  // Market-intel hooks are called unconditionally (hooks rule) at the top level
  // so navigating between sidebar sections never changes the hook count. The
  // Company view consumes profile+executives; the Decision view consumes the
  // decision-threads feed. Both degrade to null when the service is offline.
  const companyIntel = useMarketIntel(sym, ["profile", "executives"]);
  const decisionIntel = useMarketIntel(sym, ["decisionThreads"]);

  const refresh = useCallback(async () => {
    if (!sym) return;
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

  const sidebar = (
    <nav className="arw-sidebar" aria-label="Research sections">
      {SIDEBAR_GROUPS.map((group) => (
        <SidebarGroup key={group.label} label={group.label}>
          {group.items.map((s) => (
            <SidebarItem
              key={s.id}
              label={s.label}
              active={!s.action && activeView === s.id}
              action={s.action === "compare"}
              onClick={s.action === "compare" ? () => onCompare && onCompare(sym) : () => setActiveView(s.id)}
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
          <Section title="Financial Analysis" description="Margins, returns, quality">
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
            {ref.data?.earnings ? null : <GuidedEmptyState title="No financials" description="Fundamentals will populate from /earnings when data is available." />}
          </Section>
        );
      case "valuation":
        return (
          <Section title="Valuation" description="Multiples and fair value">
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
