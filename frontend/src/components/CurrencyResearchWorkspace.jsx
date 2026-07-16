// CurrencyResearchWorkspace — institutional FX / Currency research surface (spec §6).
//
// ONE workspace for both modes:
//   - pair     : FX pair (e.g. EUR/USD) — price-bearing, quote/history via adapter.
//   - currency : currency code (e.g. EUR) — macro/research entity; NEVER a fake price.
//
// Sections (pair): Overview, Drivers, Events, Crosses, Portfolio impact, Research.
// Sections (currency): Overview, Drivers, Events, Related crosses, Research & decisions.
//
// No fabricated data (Brand v2): currency-code shows null price + "Research only";
// FX quote is null when the provider fails, marked stale with source/timestamp.

import { useEffect, useMemo, useState } from "react";
import {
  CompactPageHeader, WorkspaceLayout, Section, Panel, MetricStrip, Tag, Ghost, SidebarGroup, SidebarItem,
} from "./CompactWorkspaceUI";
import { getAssetKind } from "../utils/assetRegistry";
import {
  normalizeInstrumentSymbol, resolveCurrencyInstrument, relatedFxPairs, FX_BASE_QUOTE, CCY_NAMES, FX_NAMES,
} from "../utils/currencyInstruments.js";
import { getAdapter } from "../utils/assetAdapters";
import { CurrencyIntelligence } from "./intelligence/CurrencyIntelligence";
import { CurrencyCompare } from "./CurrencyCompare";

const MODE_TIERS = {
  pair: ["overview", "compare", "drivers", "events", "crosses", "portfolioImpact", "research", "catalysts", "decisionLedger", "scenarioLab"],
  currency: ["overview", "compare", "drivers", "events", "crosses", "research", "catalysts", "decisionLedger", "scenarioLab"],
};
const TIER_LABEL = {
  overview: "Overview", compare: "Compare", drivers: "Drivers", events: "Events", crosses: "Crosses",
  portfolioImpact: "Portfolio Impact", research: "Research", catalysts: "Catalysts & Risks",
  decisionLedger: "Decision Ledger", scenarioLab: "Scenario Lab",
};

function StatusBadge({ stale, unavailable, source, updatedAt }) {
  if (unavailable) return <span className="badge neutral">Unavailable</span>;
  if (stale) return <span className="badge neutral">Stale · {source || "—"}</span>;
  return <span className="badge positive">{source || "Live"} · {updatedAt ? new Date(updatedAt).toLocaleTimeString() : ""}</span>;
}

export function CurrencyResearchWorkspace({ symbol, mode, view, compareSymbol, onClose, onOpenProfile, onCompare, onOpenEtf, onOpenMacro }) {
  const sym = normalizeInstrumentSymbol(symbol);
  const inst = useMemo(() => resolveCurrencyInstrument(sym), [sym]);
  const isPair = inst?.kind === "forex" || mode === "pair";
  const validViews = isPair ? MODE_TIERS.pair : MODE_TIERS.currency;
  // Spec §6: honor view=compare from route state; default to overview.
  const [activeView, setActiveView] = useState(validViews.includes(view) ? view : "overview");
  const tiers = isPair ? MODE_TIERS.pair : MODE_TIERS.currency;
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const adapter = getAdapter("currency");
    if (!adapter || !inst) { setSnap(null); return; }
    setLoading(true);
    adapter.fetchSnapshot(sym, inst).then((s) => {
      if (!cancelled) { setSnap(s); setLoading(false); }
    }).catch(() => { if (!cancelled) { setSnap(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [sym, inst]);

  const price = snap?.price ?? null;
  const dayPct = snap?.dayChangePct ?? null;
  const stale = snap?.raw?.note ? false : (snap && !price ? true : false);
  const unavailable = snap && !price && isPair === false; // currency-code: honest "research only"
  const updatedAt = snap?.updatedAt;

  const base = inst?.baseCurrency;
  const quote = inst?.quoteCurrency;
  const crosses = isPair ? relatedFxPairs(base).concat(relatedFxPairs(quote)).filter((p) => p !== sym) : relatedFxPairs(sym);

  const renderView = () => {
    if (activeView === "overview") {
      return (
        <Section title={isPair ? "FX Pair Overview" : "Currency Overview"}>
          {isPair ? (
            <MetricStrip items={[
              { label: "Pair", value: sym },
              { label: "Quote", value: price != null ? (quote === "JPY" ? price.toFixed(2) : price.toFixed(4)) : "Unavailable" },
              { label: "Day", value: dayPct != null ? `${dayPct >= 0 ? "+" : ""}${dayPct.toFixed(2)}%` : "Unavailable" },
              { label: "Base", value: base || "—" },
              { label: "Quote", value: quote || "—" },
              { label: "Session", value: "FX · 24/5" },
            ]} />
          ) : (
            <MetricStrip items={[
              { label: "Currency", value: sym },
              { label: "Name", value: CCY_NAMES[sym] || "—" },
              { label: "Quote Currency", value: "—" },
              { label: "Mode", value: "Research only" },
            ]} />
          )}
          <Panel title={isPair ? "Quote & Freshness" : "Macro Identity & Freshness"}>
            <p className="etf-note">
              {isPair
                ? `${FX_NAMES[sym] || sym}. Source: ${snap?.raw?.price ? "Yahoo Finance" : "curated FX universe"}. ${stale ? "Last successful data marked stale." : "Live quote where available."}`
                : `${CCY_NAMES[sym] || sym} is a macro / research entity. It is not tradable here and carries no standalone quote. Related pairs and macro events are navigable below.`}
            </p>
            <StatusBadge stale={stale} unavailable={unavailable} source={snap?.raw?.price ? "Yahoo Finance" : "Curated"} updatedAt={updatedAt} />
          </Panel>
        </Section>
      );
    }
    if (activeView === "compare") {
      return (
        <Section title={isPair ? "FX Pair Comparison" : "Currency Comparison"}>
          <CurrencyCompare
            primarySymbol={sym}
            primaryKind={isPair ? "forex" : "currency"}
            initialCompareSymbol={compareSymbol || null}
            onChangePrimary={(s) => { if (s) { window.history.replaceState({}, "", `${window.location.pathname}?view=compare&peer=${encodeURIComponent(s)}`); } }}
            onChangeComparison={(s) => { window.history.replaceState({}, "", `${window.location.pathname}?view=compare&peer=${encodeURIComponent(s)}`); }}
            onOpenResearch={(target) => { if (onCompare) onCompare(target); }}
          />
        </Section>
      );
    }
    if (activeView === "drivers") {
      return (
        <Section title="Drivers">
          <Panel title="Policy & Macro Drivers"><Ghost label="Policy-rate / inflation / growth differentials and risk sentiment unavailable — no macro-factor feed wired." /></Panel>
          <Panel title="Central-Bank Stance"><Ghost label="Central-bank stance pending Macro Intelligence Bus." /></Panel>
          <Panel title="Commodity Sensitivity"><Ghost label="Commodity sensitivity not computed — no feed wired." /></Panel>
        </Section>
      );
    }
    if (activeView === "events") {
      return (
        <Section title="Events">
          <Panel title="Economic Calendar"><Ghost label="Currency-relevant economic calendar unavailable — no calendar feed wired." /></Panel>
        </Section>
      );
    }
    if (activeView === "crosses") {
      return (
        <Section title="Related Crosses">
          <Panel title="Curated Pairs">
            {crosses.length ? (
              <div className="etf-nav-list">
                {crosses.map((p) => (
                  <button key={p} type="button" className="etf-nav-row" onClick={() => onCompare?.({ symbol: p, kind: "forex", compareSymbol: sym })}>{p}<span className="etf-rel-go">→</span></button>
                ))}
              </div>
            ) : <Ghost label="No related curated pairs." />}
          </Panel>
        </Section>
      );
    }
    if (activeView === "portfolioImpact") {
      if (!isPair) return null;
      return (
        <Section title="Portfolio Impact">
          <Panel title="Direct Pair Positions"><Ghost label="No direct FX pair positions detected in this workspace." /></Panel>
          <Panel title="Cash-Balance Exposure"><Ghost label="Cash-balance FX exposure pending portfolio currency conversion coverage." /></Panel>
          <Panel title="Quote-Currency Sensitivity"><Ghost label="Quote-currency sensitivity not computed — conversion feed pending." /></Panel>
        </Section>
      );
    }
    if (activeView === "research") {
      const item = { kind: isPair ? "forex" : "currency", symbol: sym };
      return (
        <Section title="Research & Decisions">
          <CurrencyIntelligence symbol={sym} kind={isPair ? "forex" : "currency"} />
          <Panel title="Notes, Theses, Catalysts"><Ghost label="No research notes yet — add one from the Research panel." /></Panel>
        </Section>
      );
    }
    return (
      <Section title={TIER_LABEL[activeView] || activeView}>
        <p className="etf-note muted">This research dimension uses the shared generic research surface (persistence-backed).</p>
      </Section>
    );
  };

  const header = (
    <CompactPageHeader
      eyebrow={isPair ? `FX Research · ${inst?.baseCurrency || ""}/${inst?.quoteCurrency || ""}` : `Currency Research · Macro Entity`}
      title={isPair ? (FX_NAMES[sym] || sym) : (CCY_NAMES[sym] || sym)}
      description={isPair ? "Should I take FX exposure to this pair? Every research object hangs off this asset." : "Macro context for this currency. Research only — no standalone quote."}
      meta={isPair ? (
        <span className="arw-header-meta">
          {price != null ? <strong className="font-mono">{quote === "JPY" ? price.toFixed(2) : price.toFixed(4)}</strong> : null}
          {dayPct != null ? <span className={`badge ${dayPct >= 0 ? "positive" : "negative"}`}>{dayPct >= 0 ? "▲" : "▼"} {Math.abs(dayPct).toFixed(2)}%</span> : null}
          {loading ? <span className="badge neutral">Loading…</span> : <StatusBadge stale={stale} unavailable={unavailable} source={snap?.raw?.price ? "Yahoo" : "Curated"} updatedAt={updatedAt} />}
        </span>
      ) : <span className="arw-header-meta"><span className="badge neutral">Research Only</span></span>}
      actions={<>
        {onOpenProfile ? <button type="button" className="research-btn secondary" onClick={() => onOpenProfile({ symbol: sym })}>Profile</button> : null}
        {onOpenMacro ? <button type="button" className="research-btn secondary" onClick={() => onOpenMacro("USA")}>Macro</button> : null}
        {onCompare ? <button type="button" className="research-btn secondary" onClick={() => onCompare({ symbol: sym, kind: isPair ? "forex" : "currency", compareSymbol: compareSymbol || null })}>Compare</button> : null}
        {onClose ? <button type="button" className="research-btn primary" onClick={onClose}>Close</button> : null}
      </>}
    />
  );

  const sidebar = (
    <nav className="arw-sidebar currency-sidebar" aria-label="Currency research sections">
      <SidebarGroup label="Research">
        {tiers.map((id) => <SidebarItem key={id} label={TIER_LABEL[id] || id} active={activeView === id} onClick={() => setActiveView(id)} />)}
      </SidebarGroup>
    </nav>
  );

  const main = (
    <>
      {renderView()}
    </>
  );

  return <WorkspaceLayout header={header} sidebar={sidebar}>{main}</WorkspaceLayout>;
}

export default CurrencyResearchWorkspace;
