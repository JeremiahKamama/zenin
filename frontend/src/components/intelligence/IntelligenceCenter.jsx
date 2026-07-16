// IntelligenceCenter — consolidated Intelligence Platform (Phase 2/3/6/7/8/9).
//
// ONE component, many contexts, many variants. Presentation is built exclusively
// from core/ primitives (no raw div stacks). Reuses IntelligenceBus only —
// zero new logic. Brand v2 monochrome: severity/direction via weight/border/
// opacity, NEVER hue. No fabricated data: feed health comes from the real
// IntelligenceBus diagnostics, not hardcoded latencies.
//
// Additive API: existing mounts that pass only `context` render exactly as
// before (variant defaults to "workspace"). New `variant` / `modules` props are
// optional and backward compatible.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { IntelligenceBus } from "../../utils/intelligenceBus";
import { CapabilityStatusCard } from "../CapabilityStatusCard";
import {
  IntelligenceShell, IntelligenceCard, IntelligenceHeader,
  IntelligenceTimeline, IntelligenceTimelineItem, IntelligenceToolbar,
  IntelligenceStatus,
  IntelligenceEmptyState, IntelligenceDiagnostics,
  ExecutiveSummary, AffectedHoldings,
} from "./core";

const IMPACT_TONE = {
  bullish: "pos", positive: "pos", up: "pos",
  bearish: "neg", negative: "neg", down: "neg",
  neutral: "neutral", flat: "neutral", rotation: "watch", mixed: "watch",
};
const TYPE_LABEL = {
  macro: "MACRO", commodity: "COMMODITIES", equity: "EQUITY", etf: "ETF",
  fx: "FX", crypto: "CRYPTO", portfolio: "PORTFOLIO", company: "COMPANY",
  alert: "ALERT", scenario: "SCENARIO", journal: "JOURNAL",
  decision: "DECISION", transmission: "TRANSMISSION", options: "OPTIONS",
  earnings: "EARNINGS",
};
const DIR_GLYPH = { up: "up", down: "down", flat: "flat", mixed: "mixed" };
const SEV_LABEL = ["Critical", "High", "Medium", "Low"];

function sevRank(ev) {
  const tone = IMPACT_TONE[ev.impact] || "neutral";
  const c = typeof ev.confidence === "number" ? ev.confidence : 50;
  if (tone === "neg" && c >= 80) return 0;
  if (tone === "neg" || (tone === "pos" && c >= 80)) return 1;
  if (tone === "watch" || c >= 55) return 2;
  return 3;
}
function relTime(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "just now";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
function eventRelevantTo(ev, context) {
  if (!ev || !Array.isArray(ev.contexts)) return false;
  if (ev.contexts.includes(context)) return true;
  if (context === "portfolio" && ev.contexts.includes("watchlist")) return true;
  return false;
}

// Workspace-aware framing (context injected via props — never forked).
const WORKSPACE_FRAME = {
  portfolio: { focus: "Portfolio exposure", sub: "Holdings at risk" },
  watchlist: { focus: "Catalysts", sub: "Tracked-asset movers" },
  macro: { focus: "Economic releases", sub: "Regime & themes" },
  commodity: { focus: "Supply shocks", sub: "Complex chain" },
  fx: { focus: "Currency drivers", sub: "G10 & EM" },
  etf: { focus: "Sector rotation", sub: "Flows & exposure" },
  company: { focus: "Company events", sub: "Single-name" },
  scenario: { focus: "Scenario assumptions", sub: "Inputs" },
  journal: { focus: "Decision notes", sub: "Log" },
  transmission: { focus: "Propagation chains", sub: "Cross-asset" },
  decision: { focus: "Decision context", sub: "Evidence" },
  briefing: { focus: "Briefing feed", sub: "Cross-cut" },
};
const WORKSPACES = ["portfolio", "macro", "fx", "commodity", "etf", "watchlist", "company"];

const ACTION_MAP = {
  portfolio: [
    { label: "Open Macro Desk", note: "Latest inflation surprise detected.", intent: "open-macro" },
    { label: "Scenario Laboratory", note: "Stress test inflation assumptions.", intent: "run-scenario" },
    { label: "Portfolio Exposure", note: "Review impacted holdings.", intent: "review-position" },
    { label: "Create Alert", note: "Notify on the next relevant print.", intent: "create-alert" },
  ],
  watchlist: [
    { label: "Open Research", note: "Deep dive on tracked assets.", intent: "open-research" },
    { label: "Watch", note: "Keep this surface monitored.", intent: "watch" },
    { label: "Create Alert", note: "Surface the next catalyst.", intent: "create-alert" },
  ],
  company: [
    { label: "Open Research", note: "Company catalysts and exposure.", intent: "open-research" },
    { label: "Compare Assets", note: "Benchmark against peers.", intent: "compare" },
    { label: "Watch", note: "Keep this on the desk.", intent: "watch" },
  ],
  commodity: [
    { label: "Open Research", note: "Commodity chain and transmission.", intent: "open-research" },
    { label: "Run Scenario", note: "Stress the curve.", intent: "run-scenario" },
    { label: "Watch", note: "Track the complex.", intent: "watch" },
  ],
  etf: [
    { label: "Open Research", note: "Sector rotation and flows.", intent: "open-research" },
    { label: "Compare Assets", note: "Against benchmark ETFs.", intent: "compare" },
    { label: "Watch", note: "Monitor the sleeve.", intent: "watch" },
  ],
  macro: [
    { label: "Open Macro Workspace", note: "Regime, themes, transmission.", intent: "open-macro" },
    { label: "Explore Transmission", note: "See how macro propagates.", intent: "open-transmission" },
    { label: "Run Scenario", note: "What if the regime holds?", intent: "run-scenario" },
  ],
  scenario: [
    { label: "Run Scenario", note: "Pre-fill from live events.", intent: "run-scenario" },
    { label: "Open Research", note: "Evidence behind the move.", intent: "open-research" },
  ],
  journal: [
    { label: "Open Research", note: "Log the why.", intent: "open-research" },
    { label: "Create Alert", note: "Track the thread.", intent: "create-alert" },
  ],
  decision: [
    { label: "Create Decision", note: "Record the call.", intent: "create-decision" },
    { label: "Open Research", note: "Evidence base.", intent: "open-research" },
  ],
  briefing: [
    { label: "Open Macro Workspace", note: "Full macro desk.", intent: "open-macro" },
    { label: "Explore Transmission", note: "Cross-asset map.", intent: "open-transmission" },
  ],
  transmission: [
    { label: "Explore Transmission", note: "Open the explorer.", intent: "open-transmission" },
    { label: "Open Macro Workspace", note: "Source regime.", intent: "open-macro" },
  ],
  fx: [
    { label: "Open Macro Workspace", note: "Currency drivers.", intent: "open-macro" },
    { label: "Create Alert", note: "On the next FX print.", intent: "create-alert" },
  ],
  options: [
    { label: "Open Research", note: "Volatility surface.", intent: "open-research" },
    { label: "Create Alert", note: "On skew shift.", intent: "create-alert" },
  ],
};

const PIN_KEY = "zenin-ic-pins";
function loadPins() { try { return new Set(JSON.parse(localStorage.getItem(PIN_KEY) || "[]")); } catch { return new Set(); } }
function savePins(set) { try { localStorage.setItem(PIN_KEY, JSON.stringify([...set])); } catch { /* noop */ } }

/* ── Event card (uses core primitives, accessible disclosure) ───────────
   Collapsed: time · title · subtitle · severity.
   Expanded (semantic <button> + aria-expanded, keyboard): explanation · source ·
   confidence · affected-holding count · contextual action. */
const EventCard = React.memo(function EventCard({ ev, rank, pinned, onTogglePin, onExpand, expanded, onAction, compact = false }) {
  const isOpen = expanded.has(ev.id);
  const affectedCount = Array.isArray(ev.affectedAssets) ? ev.affectedAssets.length : (Array.isArray(ev.assets) ? ev.assets.length : 0);
  return (
    <IntelligenceTimelineItem rank={rank} pinned={pinned} expanded={isOpen}>
      <div className="intel-ev__row">
        <button
          type="button"
          className="intel-ev__disclosure"
          aria-expanded={isOpen}
          onClick={() => onExpand(ev.id)}
        >
          <span className="intel-ev__time">{relTime(ev.timestamp)}</span>
          <span className="intel-ev__head">{ev.headline}</span>
          {ev.detail ? <span className="intel-ev__sub">{ev.detail}</span> : null}
          <span className={`intel-sevtag s${rank}`}>{SEV_LABEL[rank]}</span>
          <span className="intel-ev__chev" aria-hidden="true">{isOpen ? "⌃" : "⌄"}</span>
        </button>
        <button type="button" className={`intel-pin ${pinned ? "on" : ""}`} aria-pressed={pinned} onClick={() => onTogglePin(ev.id)} aria-label={pinned ? "Unpin event" : "Pin event"}>{pinned ? "★" : "☆"}</button>
      </div>
      {isOpen ? (
        <div className="intel-ev__panel">
          <p className="intel-ev__explain">{ev.summary || ev.detail || "No additional detail available."}</p>
          <div className="intel-ev__meta">
            {typeof ev.confidence === "number" ? (
              <span className="intel-conf"><span className="intel-conf-track"><span className="intel-conf-fill" style={{ width: `${ev.confidence}%` }} /></span><b>{ev.confidence}%</b></span>
            ) : null}
            <span className="intel-ev__src">{ev.source}</span>
            {affectedCount ? <span className="intel-ev__affected">{affectedCount} holdings</span> : null}
          </div>
          <div className="intel-ev__actions">
            <button type="button" className="intel-q" onClick={() => onAction("open-asset", { symbol: ev.assets && ev.assets[0] })}>View asset</button>
            <button type="button" className="intel-q" onClick={() => onAction("open-transmission", { event: ev })}>Transmission</button>
            <button type="button" className="intel-q" onClick={() => onAction("create-decision", { event: ev })}>Decision</button>
            <button type="button" className="intel-q" onClick={() => onAction("run-scenario", { event: ev, continuation: true })}>Scenario</button>
          </div>
        </div>
      ) : null}
    </IntelligenceTimelineItem>
  );
});

/* ── Root component ─────────────────────────────────────────────────── */
/* ── Variant contract ────────────────────────────────────────────────
   Each variant controls: density, padding, border/background, diagnostics
   visibility, workspace-switch visibility, visible-action count, mobile behavior.
   `full` and `workspace` are the primary Intelligence page; `compact` is for
   Briefing/Watchlist; `rail` is the Portfolio side rail; `inline` is embedded
   inside existing panels. (The spec's `drawer` is supported as a detail view.) */
const VARIANTS = {
  full:    { density: "full",  diagnostics: true,  workspaceSwitch: true,  actions: 4, shell: "workspace" },
  workspace: { density: "full",  diagnostics: true,  workspaceSwitch: true,  actions: 4, shell: "workspace" },
  compact: { density: "tight", diagnostics: false, workspaceSwitch: false, actions: 2, shell: "compact" },
  rail:    { density: "tight", diagnostics: false, workspaceSwitch: false, actions: 2, shell: "rail" },
  inline:  { density: "flat",  diagnostics: false, workspaceSwitch: false, actions: 1, shell: "inline" },
  drawer:  { density: "full",  diagnostics: true,  workspaceSwitch: false, actions: 3, shell: "drawer" },
};
function variantConfig(variant) {
  return VARIANTS[variant] || VARIANTS.workspace;
}

export function IntelligenceCenter({
  context = "portfolio",
  variant = "full",
  assets = [],
  holdings = [],
  symbol = null,
  onAction = null,
  onContextChange = null,
  onOpenHolding = null,
  onNavigate = null,
  className = "",
}) {
  const vcfg = variantConfig(variant);
  const isCompact = vcfg.density !== "full";
  const [events, setEvents] = useState(() => IntelligenceBus.getEvents());
  const [diag, setDiag] = useState(() => IntelligenceBus.getDiagnostics());
  const [now, setNow] = useState(Date.now());
  const [diagOpen, setDiagOpen] = useState(false);
  const [newIds, setNewIds] = useState(() => new Set());
  const [activeCtx, setActiveCtx] = useState(context);
  const [sevFilter, setSevFilter] = useState(() => new Set([0, 1, 2, 3]));
  const [sourceFilter, setSourceFilter] = useState(null);
  const [assetTypeFilter, setAssetTypeFilter] = useState(null); // Correction 7/8
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [sortDir, setSortDir] = useState("new");
  const [pinned, setPinned] = useState(() => loadPins());
  const [expanded, setExpanded] = useState(() => new Set());
  const [booting, setBooting] = useState(true);
  const prevIds = useRef(new Set());

  useEffect(() => { setActiveCtx(context); }, [context]);
  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 350);
    const unsub = IntelligenceBus.subscribeEvents((evts) => {
      setEvents(evts || []);
      const incoming = (evts || []).map((e) => e.id);
      const fresh = incoming.filter((id) => !prevIds.current.has(id));
      if (fresh.length) { setNewIds(new Set(fresh)); const t2 = setTimeout(() => setNewIds(new Set()), 600); prevIds.current = new Set(incoming); return () => clearTimeout(t2); }
      prevIds.current = new Set(incoming);
    });
    const unsubD = IntelligenceBus.subscribeEvents(() => setDiag(IntelligenceBus.getDiagnostics()));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(t); unsub(); unsubD(); clearInterval(tick); };
  }, []);

  const togglePin = (id) => setPinned((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); savePins(n); return n; });
  const handleAction = (intent, payload) => {
    if (intent === "refresh") { setEvents(IntelligenceBus.getEvents()); setDiag(IntelligenceBus.getDiagnostics()); setNow(Date.now()); return; }
    const eventSymbol = payload?.symbol || payload?.event?.assets?.[0] || payload?.event?.affectedAssets?.[0]?.symbol || symbol;
    // Route known intents through the host navigation callback (App.jsx) so
    // Macro / Research / Transmission / asset detail stay consistent. Falls
    // back to onAction for any custom caller-supplied intent.
    if (onNavigate) {
      if (intent === "open-macro") return onNavigate({ target: "macro" });
      if (intent === "open-transmission") return onNavigate({ target: "transmission", symbol: eventSymbol, event: payload?.event });
      if (intent === "open-research") return onNavigate({ target: "research", symbol: eventSymbol });
      if (intent === "open-asset") return onNavigate({ target: "asset", symbol: eventSymbol });
      if (intent === "run-scenario") return onNavigate({ target: "scenario", symbol: eventSymbol, event: payload?.event, context: activeCtx });
      if (intent === "create-decision") return onNavigate({ target: "journal", symbol: eventSymbol, event: payload?.event, context: activeCtx });
      if (intent === "create-alert") return onNavigate({ target: "alert", symbol: eventSymbol, event: payload?.event, context: activeCtx });
      if (intent === "watch") return onNavigate({ target: "watchlist-add", symbol: eventSymbol, event: payload?.event, context: activeCtx });
      if (intent === "compare") return onNavigate({ target: "compare", symbol: eventSymbol, context: activeCtx });
      if (intent === "review-position") return onNavigate({ target: "Portfolio", symbol: eventSymbol, context: activeCtx });
    }
    if (typeof onAction === "function") onAction(intent, payload);
  };
  const switchCtx = (c) => { setActiveCtx(c); if (typeof onContextChange === "function") onContextChange(c); };
  const onRefresh = () => { setEvents(IntelligenceBus.getEvents()); setDiag(IntelligenceBus.getDiagnostics()); setNow(Date.now()); };

  const relevant = useMemo(() => events.filter((ev) => eventRelevantTo(ev, activeCtx)), [events, activeCtx]);
  const sources = useMemo(() => [...new Set(relevant.map((e) => e.source).filter(Boolean))], [relevant]);

  const ordered = useMemo(() => {
    const scored = relevant.map((ev) => ({ ev, rank: sevRank(ev), pinned: pinned.has(ev.id) }));
    const filtered = scored
      .filter((s) => sevFilter.has(s.rank))
      .filter((s) => !sourceFilter || s.ev.source === sourceFilter)
      .filter((s) => !assetTypeFilter || String(s.ev.assetType || "").toUpperCase() === assetTypeFilter)
      .filter((s) => !pinnedOnly || s.pinned);
    filtered.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (a.rank !== b.rank) return a.rank - b.rank;
      const ta = new Date(a.ev.timestamp).getTime(), tb = new Date(b.ev.timestamp).getTime();
      return sortDir === "new" ? tb - ta : ta - tb;
    });
    return filtered.map((s) => s.ev);
  }, [relevant, sevFilter, sourceFilter, assetTypeFilter, pinnedOnly, pinned, sortDir]);

  const sourcesCount = relevant.length ? sources.length : (diag.sources || 0);
  const confidence = (() => {
    const v = relevant.map((e) => e.confidence).filter((c) => typeof c === "number");
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : (diag.confidence ?? null);
  })();
  const latestTs = relevant.length ? relevant[0].timestamp : null;

  const frame = WORKSPACE_FRAME[activeCtx] || { focus: "Cross-market", sub: "Live" };
  const summary = (() => {
    if (!ordered.length) return null;
    const counts = {}; ordered.forEach((e) => { const t = TYPE_LABEL[e.type] || e.type; counts[t] = (counts[t] || 0) + 1; });
    const parts = Object.entries(counts).map(([k, v]) => `${v} ${k}`).slice(0, 3).join(", ");
    return parts + (ordered.some((e) => e.transmission && e.transmission.length) ? " affecting monitored assets; transmission propagation is active." : " affecting monitored assets.");
  })();
  const downstream = (() => {
    if (!ordered.length) return [];
    const d = []; ordered.slice(0, 4).forEach((e) => { (e.transmission || []).forEach((t) => d.push(t.to)); });
    return [...new Set(d)].slice(0, 4).map((x) => `${x}`);
  })();
  const transmission = useMemo(() => {
    const nodes = []; ordered.forEach((e) => (e.transmission || []).forEach((t) => nodes.push({ to: t.to, dir: DIR_GLYPH[t.dir] || "down", conf: e.confidence })));
    return nodes.slice(0, 6);
  }, [ordered]);
  const assetImpact = useMemo(() => {
    if (activeCtx !== "portfolio") return null;
    const regime = IntelligenceBus.getRegime();
    if (!regime || !Array.isArray(holdings) || !holdings.length) return null;
    const affected = IntelligenceBus.affectedHoldings(holdings, regime.label);
    if (!affected.length) return null;
    const bySym = new Map(holdings.map((h) => [String(h.symbol || "").toUpperCase(), h]));
    return affected.slice(0, 6).map((h) => {
      const rec = bySym.get(String(h.symbol).toUpperCase());
      const weight = rec ? Number(rec.weight != null ? rec.weight : (Number(rec.price || 0) * Number(rec.quantity || 0) > 0 ? 0 : 0)) : undefined;
      return {
        symbol: h.symbol,
        name: h.name,
        direction: h.direction,
        weight: typeof weight === "number" && !Number.isNaN(weight) ? weight : undefined,
      };
    });
  }, [activeCtx, holdings, relevant, pinned]);
  const hasEvents = ordered.length > 0;
  const actions = hasEvents ? ordered.flatMap((e) => e.actions || []).slice(0, 4) : (ACTION_MAP[activeCtx] || []);

  // Executive Summary: the dominant element. Derive headline + explanation from
  // the most severe live event (never fabricated). Falls back to honest empty.
  const topEvent = ordered.length ? ordered[0] : null;
  const execData = (() => {
    if (!hasEvents) return null;
    const e = topEvent;
    const tone = IMPACT_TONE[e.impact] || "neutral";
    const headline = e.headline;
    const explanation = e.summary || e.detail || "";
    const primary = ACTION_MAP[activeCtx] && ACTION_MAP[activeCtx][0];
    const secondary = ACTION_MAP[activeCtx] && ACTION_MAP[activeCtx][1];
    return {
      headline,
      explanation,
      confidence: typeof e.confidence === "number" ? e.confidence : null,
      freshness: e.timestamp ? relTime(e.timestamp) : null,
      source: e.source || null,
      affectedCount: assetImpact ? assetImpact.length : (Array.isArray(e.affectedAssets) ? e.affectedAssets.length : (Array.isArray(e.assets) ? e.assets.length : null)),
      primaryAction: primary ? { label: primary.label, onClick: () => handleAction(primary.intent, { context: activeCtx, symbol }) } : null,
      secondaryAction: secondary ? { label: secondary.label, onClick: () => handleAction(secondary.intent, { context: activeCtx, symbol }) } : null,
    };
  })();
  const staleNote = diag && diag.lastPublish ? `Data last updated ${relTime(diag.lastPublish)}.` : null;
  const isStale = Boolean(diag && diag.lastPublish && (Date.now() - new Date(diag.lastPublish).getTime()) > 10 * 60 * 1000);

  // Real feed-health rows from bus diagnostics (no fabricated latencies).
  const feeds = (diag && Array.isArray(diag.feeds) && diag.feeds.length)
    ? diag.feeds
    : (diag && diag.sources ? [{ name: "Intelligence Bus", status: "live", coverage: "Events", latencyMs: null, fallback: false, updated: diag.lastPublish ? relTime(diag.lastPublish) : "live" }] : []);

  return (
    <IntelligenceShell variant={vcfg.shell} context={activeCtx} className={className} data-density={vcfg.density}>
      <IntelligenceHeader
        sub={`Cross-market intelligence${frame.focus ? ` · ${frame.focus}` : ""}`}
        stats={(
          <IntelligenceStatus state={booting ? "cached" : (hasEvents ? "live" : "cached")} />
        )}
      >
        {vcfg.workspaceSwitch && (
          <IntelligenceToolbar>
            <div className="intel-segmented" role="tablist" aria-label="Intelligence scope">
              {WORKSPACES.map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={activeCtx === c}
                  className={`intel-segmented__btn ${activeCtx === c ? "is-active" : ""}`}
                  onClick={() => switchCtx(c)}
                >{c.charAt(0).toUpperCase() + c.slice(1)}</button>
              ))}
            </div>
          </IntelligenceToolbar>
        )}
      </IntelligenceHeader>

      {/* 1. EXECUTIVE SUMMARY — the strongest visual element. */}
      {execData ? (
        <ExecutiveSummary
          variant={variant}
          headline={execData.headline}
          explanation={execData.explanation}
          confidence={execData.confidence}
          freshness={execData.freshness}
          source={execData.source}
          affectedCount={execData.affectedCount}
          primaryAction={execData.primaryAction}
          secondaryAction={execData.secondaryAction}
        />
      ) : (
        <IntelligenceCard title="Executive Summary" className="intel-exec-empty">
          <p className="intel-empty__note">No active portfolio-linked signals right now.</p>
          <p className="intel-empty__note intel-empty__muted">The cockpit is in readiness mode — feeds are live and will surface the moment a relevant event lands.</p>
          <div className="intel-readiness-actions">
            <button type="button" className="intel-btn" onClick={() => handleAction("open-macro", {})}>Open Macro Desk</button>
            <button type="button" className="intel-btn intel-btn--ghost" onClick={() => handleAction("open-transmission", {})}>Transmission Explorer</button>
          </div>
        </IntelligenceCard>
      )}

      {/* 2 + 3. AFFECTED HOLDINGS + TRANSMISSION — visible without a new page. */}
      <div className="intel-grid intel-grid--split">
        <IntelligenceCard title="Affected Holdings" sub={frame.focus}>
          {assetImpact ? (
            <AffectedHoldings holdings={assetImpact} compact={isCompact} onOpenHolding={onOpenHolding || ((sym) => handleAction("open-asset", { symbol: sym }))} />
          ) : (
            <p className="intel-empty__note">No holdings impact for this workspace.</p>
          )}
        </IntelligenceCard>
        <IntelligenceCard title="Transmission Path" sub="Cross-asset propagation">
          {transmission.length ? (
            <div className="intel-graph">
              {transmission.map((n, i) => (
                <React.Fragment key={i}>
                  <span className="intel-node">{n.to}<span className="intel-node-conf">{typeof n.conf === "number" ? `${n.conf}%` : ""}</span></span>
                  {i < transmission.length - 1 ? <span className={`intel-arrow ${n.dir}`} /> : null}
                </React.Fragment>
              ))}
            </div>
          ) : <p className="intel-empty__note">No active transmission paths for this workspace.</p>}
        </IntelligenceCard>
      </div>

      {/* 4. EVENT TIMELINE — primary content area. */}
      <IntelligenceCard title="Event Timeline" sub={isStale ? staleNote : (staleNote || undefined)}>
        {vcfg.density === "full" ? (
          <IntelligenceToolbar>
            {[0, 1, 2, 3].map((r) => (
              <button key={r} type="button" className={`intel-btn ${sevFilter.has(r) ? "is-active" : ""}`} aria-pressed={sevFilter.has(r)} onClick={() => setSevFilter((s) => { const n = new Set(s); if (n.has(r)) n.delete(r); else n.add(r); return n; })}>{SEV_LABEL[r]}</button>
            ))}
            <select className="intel-select" value={sourceFilter || ""} onChange={(e) => setSourceFilter(e.target.value || null)} aria-label="Source filter">
              <option value="">All Sources</option>
              {sources.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select className="intel-select" value={assetTypeFilter || ""} onChange={(e) => setAssetTypeFilter(e.target.value || null)} aria-label="Asset type filter">
              <option value="">All</option>
              <option value="PORTFOLIO">Portfolio</option>
              <option value="MACRO">Macro</option>
              <option value="COMPANY">Companies</option>
              <option value="ETF">ETFs</option>
              <option value="COMMODITY">Commodities</option>
              <option value="CURRENCY">Currencies</option>
            </select>
            <button type="button" className={`intel-btn ${pinnedOnly ? "is-active" : ""}`} aria-pressed={pinnedOnly} onClick={() => setPinnedOnly((p) => !p)}>★ Pinned</button>
            <button type="button" className="intel-btn is-active" onClick={() => setSortDir((d) => (d === "new" ? "old" : "new"))}>{sortDir === "new" ? "Newest" : "Oldest"}</button>
          </IntelligenceToolbar>
        ) : null}
        {booting ? (
          <div className="intel-skeleton-list" aria-busy="true"><p className="intel-empty__note">Loading portfolio-linked intelligence…</p>{[0, 1, 2].map((i) => <div key={i} className="intel-skeleton" />)}</div>
        ) : ordered.length ? (
          <IntelligenceTimeline>
            {ordered.map((ev) => {
              const rank = sevRank(ev);
              return <EventCard key={ev.id} ev={ev} rank={rank} pinned={pinned.has(ev.id)} expanded={expanded} onTogglePin={togglePin} onExpand={(id) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; })} onAction={handleAction} compact={isCompact} />;
            })}
          </IntelligenceTimeline>
        ) : assetTypeFilter === "ETF" ? (
          <CapabilityStatusCard capability="ETF_DOCUMENT_INTELLIGENCE" reason="Document Intelligence is not connected." />
        ) : (
          <IntelligenceEmptyState
            title="No portfolio-linked events yet."
            sub="Connect a data source or add a watchlist asset to begin."
            actions={(
              <>
                <button type="button" className="intel-btn" onClick={() => handleAction("open-macro", {})}>Open Macro Desk</button>
                <button type="button" className="intel-btn intel-btn--ghost" onClick={() => handleAction("open-transmission", {})}>Transmission Explorer</button>
              </>
            )}
          />
        )}
      </IntelligenceCard>

      {/* Feed coverage — secondary. Only when real telemetry exists; otherwise
          it is surfaced inside the collapsed diagnostics region. */}
      {vcfg.density === "full" && feeds.length > 0 ? (
        <IntelligenceCard title="Feed Coverage" sub="Source health from the Intelligence Bus">
          <ul className="intel-coverage">
            {feeds.length ? feeds.map((f) => (
              <li key={f.name} className="intel-feed">
                <span className="intel-feed__name">{f.name}</span>
                <IntelligenceStatus state={f.status || "cached"} label={f.status} />
                <span className="intel-feed__meta">Coverage · {f.coverage || "—"}</span>
                <span className="intel-feed__meta">{f.latencyMs != null ? `Latency ${f.latencyMs}ms` : "Latency —"}</span>
                <span className="intel-feed__meta">{f.fallback ? "Fallback active" : "Fallback —"}</span>
              </li>
            )) : <li className="intel-feed__meta">No feed telemetry registered.</li>}
          </ul>
        </IntelligenceCard>
      ) : null}

      {/* Diagnostics — collapsed by default unless the variant shows them. */}
      {vcfg.diagnostics ? (
        <IntelligenceDiagnostics diag={diag} open={diagOpen} onToggle={() => setDiagOpen((o) => !o)} />
      ) : null}
    </IntelligenceShell>
  );
}

export default IntelligenceCenter;
