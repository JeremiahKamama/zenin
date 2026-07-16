// IntelligenceWorkspace — the single canonical Intelligence page.
//
// Per the platform refactor, Intelligence is a first-class workspace. Every
// embedded IntelligenceCenter was removed from Portfolio/Watchlist/Research/
// Analytics/Briefing/Transmission/Company/Commodity/Decisions; they all feed
// this one page through the IntelligenceBus. This component renders exactly
// one <IntelligenceCenter> plus the supplementary market-intel modules that
// belong to intelligence (Market Signals, Upcoming Events, Macro Regime,
// Research Queue). Nothing is duplicated elsewhere.
//
// URL state is supported:
//   /app?section=intelligence&context=macro
//   /app?section=intelligence&symbol=AAPL
//   /app?section=intelligence&theme=AI&horizon=Quarter
// via window.location.search (read once on mount).

import { useEffect, useMemo, useState } from "react";
import IntelligenceCenter from "./intelligence/IntelligenceCenter.jsx";
import MarketSignals2 from "./market/MarketSignals2.jsx";
import UpcomingEvents2 from "./market/UpcomingEvents2.jsx";
import { IntelligenceBus } from "../utils/intelligenceBus.js";

const VALID_CONTEXTS = ["portfolio", "watchlist", "macro", "commodity", "company", "briefing", "transmission", "decision", "research"];

function readQuery() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const ctx = p.get("context");
  const sym = p.get("symbol");
  const theme = p.get("theme");
  const horizon = p.get("horizon");
  return {
    context: VALID_CONTEXTS.includes(ctx) ? ctx : "portfolio",
    symbol: sym || undefined,
    theme: theme || undefined,
    horizon: horizon || undefined,
  };
}

function SectionShell({ title, subtitle, variant = "standard", actions, children }) {
  return (
    <section className={`intel-workspace-section intel-workspace-section--${variant}`} aria-label={title}>
      <header className="intel-workspace-section__head">
        <div>
          <h2>{title}</h2>
          {subtitle ? <p>{subtitle}</p> : null}
        </div>
        {actions ? <div className="intel-workspace-section__actions">{actions}</div> : null}
      </header>
      <div className="intel-workspace-section__body">{children}</div>
    </section>
  );
}

function formatRelativeTime(value) {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function EmptyWorkspaceState({ title, description, action, onAction }) {
  return (
    <div className="intel-workspace-empty">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action && onAction ? <button type="button" className="intel-btn intel-btn--ghost" onClick={onAction}>{action}</button> : null}
    </div>
  );
}

function MacroRegimeCard({ regime }) {
  return (
    <div className="intel-macro-regime">
      <div className="intel-macro-regime__main">
        <span>Current regime</span>
        <strong>{regime.label}</strong>
      </div>
      <div className="intel-macro-regime__meta">
        {typeof regime.score === "number" ? <span><b>{Math.round(regime.score * 100)}%</b> Confidence</span> : null}
        {regime.updatedAt ? <span><b>{formatRelativeTime(regime.updatedAt)}</b> Updated</span> : null}
        {regime.source ? <span><b>{regime.source}</b> Source</span> : null}
      </div>
      {regime.explain ? <p className="intel-macro-regime__explain">{regime.explain}</p> : null}
    </div>
  );
}

export default function IntelligenceWorkspace({ context: contextProp, symbol: symbolProp, indicatorContext, portfolio, onNavigate }) {
  const query = useMemo(() => readQuery(), []);
  const context = contextProp || query.context || "portfolio";
  const symbol = symbolProp || query.symbol;

  const [regime, setRegime] = useState(() => IntelligenceBus.getRegime());
  const [events, setEvents] = useState(() => IntelligenceBus.getEvents());
  const [diag, setDiag] = useState(() => IntelligenceBus.getDiagnostics());
  const [researchQueue, setResearchQueue] = useState(() => {
    try {
      const raw = localStorage.getItem("zenin_research_knowledge_decisions");
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    const unsub = IntelligenceBus.subscribeRegime(() => {
      setRegime(IntelligenceBus.getRegime());
    });
    const unsubE = IntelligenceBus.subscribeEvents((evts) => {
      setEvents(evts || []);
      setDiag(IntelligenceBus.getDiagnostics());
    });
    return () => { unsub(); unsubE(); };
  }, []);

  const macroRegime = regime?.label ? regime : null;

  // Single navigation entrypoint: delegate to host-provided callback so
  // routing follows App conventions (no self-managed history.pushState).
  const nav = (payload) => { if (onNavigate) onNavigate(payload); };

  // ── Decision-ready cockpit header state (Brand v2: state via text + icon +
  //    border-weight + label, never hue alone). All derived from the real
  //    IntelligenceBus — no fabricated latencies or connection states. ──
  const relevantSignals = useMemo(() => {
    const list = Array.isArray(events) ? events : [];
    if (context === "portfolio") {
      return list.filter((e) => Array.isArray(e.contexts) && (e.contexts.includes("portfolio") || e.contexts.includes("watchlist")));
    }
    return list.filter((e) => Array.isArray(e.contexts) && e.contexts.includes(context));
  }, [events, context]);
  const signalCount = relevantSignals.length;

  const feeds = diag && Array.isArray(diag.feeds) ? diag.feeds : [];
  const hasFeeds = feeds.length > 0;
  const lastPublish = diag && diag.lastPublish ? new Date(diag.lastPublish).getTime() : null;
  const nowMs = Date.now();
  const staleMs = 10 * 60 * 1000;
  const dataState = (() => {
    if (!hasFeeds && !lastPublish) return "unavailable";
    if (lastPublish && nowMs - lastPublish > staleMs) return "stale";
    if (hasFeeds && feeds.some((f) => f.status === "live")) return "live";
    if (hasFeeds) return "cached";
    return "cached";
  })();
  const connected = Array.isArray(portfolio) && portfolio.length > 0 ? true : hasFeeds;
  const DATA_STATE_LABEL = {
    live: "Live", cached: "Cached", stale: "Stale", unavailable: "Not connected",
  };
  const scopeLabel = context === "portfolio" ? "Monitoring portfolio" : `Monitoring ${context}`;
  const freshnessLabel = macroRegime?.updatedAt ? formatRelativeTime(macroRegime.updatedAt) : (lastPublish ? formatRelativeTime(lastPublish) : null);

  // Single primary action: connect first, then Macro Desk. Secondary is quieter.
  const primaryAction = connected
    ? { label: "Open Macro Desk", onClick: () => nav({ target: "macro" }) }
    : { label: "Connect portfolio", onClick: () => nav({ target: "portfolio" }) };
  const secondaryAction = connected
    ? { label: "Transmission Explorer", onClick: () => nav({ target: "transmission" }) }
    : { label: "Add watchlist asset", onClick: () => nav({ target: "watchlist" }) };

  return (
    <div className="intelligence-workspace">
      <header className="intelligence-workspace__header">
        <div>
          <h1>Intelligence</h1>
          <p className="intelligence-workspace__sub">
            Unified market intelligence — signals, transmission, timeline, and diagnostics.
            {query.theme ? ` Theme: ${query.theme}.` : ""}
            {query.horizon ? ` Horizon: ${query.horizon}.` : ""}
            {indicatorContext ? ` Focus: ${indicatorContext}.` : ""}
          </p>
        </div>
        <div className="intelligence-workspace__status" aria-live="polite">
          <span className={`intel-state-badge intel-state-badge--${dataState}`} data-state={dataState}>
            <span className="intel-state-badge__dot" aria-hidden="true" />
            <span className="intel-state-badge__label">{DATA_STATE_LABEL[dataState]}</span>
          </span>
          <span className="intel-status-line">
            <b>{scopeLabel}</b>
            <span className="intel-status-sep" aria-hidden="true">·</span>
            <span><b className="intel-mono">{signalCount}</b> active signal{signalCount === 1 ? "" : "s"}</span>
            {freshnessLabel ? (
              <><span className="intel-status-sep" aria-hidden="true">·</span><span>Updated {freshnessLabel}</span></>
            ) : null}
          </span>
          <div className="intelligence-workspace__actions">
            <button type="button" className="intel-btn intel-btn--primary" onClick={primaryAction.onClick}>{primaryAction.label}</button>
            <button type="button" className="intel-btn intel-btn--ghost" onClick={secondaryAction.onClick}>{secondaryAction.label}</button>
          </div>
        </div>
      </header>

      {/* Core consolidated intelligence platform (single IntelligenceCenter mount).
          variant="full" is the primary Intelligence page. Real portfolio holdings are
          forwarded so Affected Holdings reflects actual positions (no duplicate rail). */}
      <div className="intel-workspace-grid">
        <div className="intel-workspace-grid__primary">
          <IntelligenceCenter
            variant="full"
            context={context}
            symbol={symbol}
            holdings={Array.isArray(portfolio) ? portfolio : undefined}
            onNavigate={nav}
          />

          <SectionShell title="Market Signals" subtitle="What is changing across your markets." variant="primary">
            <MarketSignals2
              onOpenWorkspace={(p) => nav({ target: p?.workspace || p?.desk || "research", symbol: p?.entity || p?.symbol, country: p?.country })}
              onOpenResearch={(symbol) => nav({ target: "research", symbol })}
              onOpenDesk={(desk) => nav({ target: desk === "macro" ? "macro" : "research" })}
              onSelectAsset={(symbol) => nav({ target: "asset", symbol })}
            />
          </SectionShell>
        </div>

        <aside className="intel-workspace-grid__rail">
          <SectionShell title="Upcoming Events" subtitle="Events that may affect tracked assets." variant="calendar">
            <UpcomingEvents2 onOpenWorkspace={(e) => nav({ target: "transmission", symbol: e?.symbol || e?.assets?.[0] })} />
          </SectionShell>

          <SectionShell title="Macro Regime" subtitle="Current macro backdrop." variant="compact">
            {macroRegime ? <MacroRegimeCard regime={macroRegime} /> : (
              <EmptyWorkspaceState
                title="No macro regime published"
                description="The Macro Desk has not published a current regime."
                action="Open Macro Desk"
                onAction={() => nav({ target: "macro" })}
              />
            )}
          </SectionShell>

          <SectionShell title="Research Queue" subtitle="Open decisions requiring attention." variant="compact">
            {researchQueue.length > 0 ? (
              <ul className="intel-research-queue">
                {researchQueue.slice(0, 12).map((item, i) => (
                  <li key={item?.id || i} className="intel-research-queue__item">
                    <button type="button" className="intel-research-queue__btn" onClick={() => nav({ target: "asset", symbol: item?.symbol })}>
                      <span className="intel-research-queue__symbol">{item?.symbol || "—"}</span>
                      <span className="intel-research-queue__title">{item?.title || item?.label || "Untitled"}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyWorkspaceState
                title="No open research items"
                description="Research decisions will appear here when they need follow-up."
                action="Open research"
                onAction={() => nav({ target: "research" })}
              />
            )}
          </SectionShell>
        </aside>
      </div>
    </div>
  );
}
