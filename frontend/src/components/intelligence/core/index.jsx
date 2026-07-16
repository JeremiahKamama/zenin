// Intelligence Platform — core design primitives (Phase 1 / Phase 8 / Phase 9).
//
// These are the ONLY building blocks permitted inside IntelligenceCenter and
// its modules. They are token-driven (see styles/intelligence.css) and strictly
// monochrome (Brand v2): severity/direction is expressed via weight, border,
// opacity and shape — NEVER via hue. No green, no cyan, no success-colored dots.
//
// All primitives forward `className` and spread remaining props so callers can
// compose without raw div stacks.

import React from "react";

/* ── Shell: the outermost container. Variant drives width/scroll contract. ── */
export function IntelligenceShell({ variant = "workspace", context, className = "", children, ...rest }) {
  return (
    <section
      className={`intel intel--${variant} ${className}`}
      data-context={context || undefined}
      aria-label="Intelligence Center"
      {...rest}
    >
      {children}
    </section>
  );
}

/* ── Card: the one true container for every section. ── */
export function IntelligenceCard({ title, sub, actions, footer, className = "", bodyClassName = "", children, ...rest }) {
  return (
    <section className={`intel-card ${className}`} {...rest}>
      {(title || actions) && (
        <header className="intel-card__head">
          <div className="intel-card__titles">
            {title && <h3 className="intel-card__title">{title}</h3>}
            {sub && <span className="intel-card__sub">{sub}</span>}
          </div>
          {actions && <div className="intel-card__actions">{actions}</div>}
        </header>
      )}
      <div className={`intel-card__body ${bodyClassName}`}>{children}</div>
      {footer && <footer className="intel-card__footer">{footer}</footer>}
    </section>
  );
}

/* ── Header: page/workspace title, stats, optional workspace switcher slot. ── */
export function IntelligenceHeader({ title = "INTELLIGENCE CENTER", sub, stats, children, className = "" }) {
  return (
    <header className={`intel-header ${className}`}>
      <div className="intel-header__top">
        <div className="intel-header__titles">
          <h1 className="intel-header__title">{title}</h1>
          {sub && <p className="intel-header__sub">{sub}</p>}
        </div>
        {stats && <div className="intel-header__stats">{stats}</div>}
      </div>
      {children}
    </header>
  );
}

/* ── Section: semantic grouping wrapper (replaces IntelligencePanel body). ── */
export function IntelligenceSection({ title, description, actions, available = true, unavailableNote, children, className = "" }) {
  return (
    <IntelligenceCard title={title} sub={description} actions={actions} className={`intel-section ${className}`}>
      {available ? children : (
        <p className="intel-empty__note">{unavailableNote || "Data unavailable."}</p>
      )}
    </IntelligenceCard>
  );
}

/* ── Toolbar: filters / sort / pinned toggles. ── */
export function IntelligenceToolbar({ children, className = "" }) {
  return <div className={`intel-toolbar ${className}`}>{children}</div>;
}

/* ── Timeline: scrollable event list with severity-ranked items. ── */
export function IntelligenceTimeline({ children, className = "" }) {
  return <ul className={`intel-timeline ${className}`}>{children}</ul>;
}

export function IntelligenceTimelineItem({ rank = 3, children, expanded = false, pinned = false, ...rest }) {
  return (
    <li
      className={`intel-ev sev-${rank} ${expanded ? "is-exp" : ""} ${pinned ? "is-pinned" : ""}`}
      data-sev={rank}
      {...rest}
    >
      {children}
    </li>
  );
}

/* ── Status: LIVE / cached / offline indicator — monochrome (ring, not hue). ── */
export function IntelligenceStatus({ state = "live", label, className = "" }) {
  return (
    <span className={`intel-status intel-status--${state} ${className}`} role="status">
      <span className="intel-status__dot" aria-hidden="true" />
      <span className="intel-status__label">{label || state.toUpperCase()}</span>
    </span>
  );
}

/* ── Badge: type / kind label (e.g. MACRO, EQUITY). Monochrome chip. ── */
export function IntelligenceBadge({ children, className = "" }) {
  return <span className={`intel-badge ${className}`}>{children}</span>;
}

/* ── Chip: small metadata token (source, confidence, country…). ── */
export function IntelligenceChip({ children, className = "", onClick, ...rest }) {
  const Tag = onClick ? "button" : "span";
  return (
    <Tag className={`intel-chip ${onClick ? "intel-chip--btn" : ""} ${className}`} onClick={onClick} type={onClick ? "button" : undefined} {...rest}>
      {children}
    </Tag>
  );
}

/* ── Action: suggested-action card / button. ── */
export function IntelligenceAction({ title, note, cta = "Open", onClick, className = "" }) {
  return (
    <button type="button" className={`intel-action ${className}`} onClick={onClick}>
      <span className="intel-action__title">{title}</span>
      {note && <span className="intel-action__note">{note}</span>}
      <span className="intel-action__cta">{cta} →</span>
    </button>
  );
}

/* ── EmptyState: honest, no fabricated data. ── */
export function IntelligenceEmptyState({ mark = "○", title = "No active intelligence", sub, monitor = [], actions, className = "" }) {
  return (
    <div className={`intel-empty ${className}`}>
      <div className="intel-empty__mark" aria-hidden="true">{mark}</div>
      <h3 className="intel-empty__title">{title}</h3>
      {sub && <p className="intel-empty__sub">{sub}</p>}
      {monitor.length > 0 && (
        <>
          <p className="intel-empty__sub intel-empty__muted">Monitoring</p>
          <ul className="intel-monitor">
            {monitor.map((m) => (
              <li key={m}><span className="intel-check" aria-hidden="true">✓</span>{m}</li>
            ))}
          </ul>
        </>
      )}
      {actions && <div className="intel-empty__actions">{actions}</div>}
    </div>
  );
}

/* ── Diagnostics: collapsible real-diagnostics drawer. ── */
export function IntelligenceDiagnostics({ diag, open, onToggle, className = "" }) {
  return (
    <div className={`intel-diag ${className}`}>
      <button type="button" className="intel-diag__head" aria-expanded={open} onClick={onToggle}>
        <span className={`intel-card__title ${open ? "is-open" : ""}`}>Diagnostics</span>
        <span className={`intel-diag__chev ${open ? "is-open" : ""}`} aria-hidden="true">⌄</span>
      </button>
      {open && diag && (
        <div className="intel-diag__body">
          <div className="intel-diag__grid">
            {Object.entries(diag).map(([k, v]) => (
              <div key={k}><i>{k}</i><b>{Array.isArray(v) ? v.join(", ") : String(v)}</b></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Executive Summary: the dominant visual element of the full layout. ──
   One raised panel. Primary insight + plain-language explanation, confidence,
   freshness, source, affected-holding count, one primary + one secondary CTA.
   Never several equal-sized action cards. */
export function ExecutiveSummary({
  headline,
  explanation,
  confidence,
  freshness,
  source,
  affectedCount,
  primaryAction,   // { label, onClick }
  secondaryAction, // { label, onClick }
  variant = "full",
  className = "",
}) {
  const compact = variant !== "full" && variant !== "workspace";
  return (
    <section className={`intel-exec ${compact ? "intel-exec--compact" : ""} ${className}`} aria-label="Executive insight">
      {headline ? (
        <div className="intel-exec__head">
          <h2 className="intel-exec__headline">{headline}</h2>
        </div>
      ) : null}
      {explanation ? <p className="intel-exec__explain">{explanation}</p> : null}
      <div className="intel-exec__metrics">
        {typeof confidence === "number" ? (
          <span className="intel-exec__metric"><b>{confidence}%</b><i>Confidence</i></span>
        ) : null}
        {freshness ? <span className="intel-exec__metric"><b>{freshness}</b><i>Updated</i></span> : null}
        {source ? <span className="intel-exec__metric"><b>{source}</b><i>Source</i></span> : null}
        {typeof affectedCount === "number" ? (
          <span className="intel-exec__metric"><b>{affectedCount}</b><i>Affected</i></span>
        ) : null}
      </div>
      {primaryAction || secondaryAction ? (
        <div className="intel-exec__actions">
          {primaryAction ? (
            <button type="button" className="intel-exec__cta intel-exec__cta--primary" onClick={primaryAction.onClick}>
              {primaryAction.label}
            </button>
          ) : null}
          {secondaryAction ? (
            <button type="button" className="intel-exec__cta intel-exec__cta--secondary" onClick={secondaryAction.onClick}>
              {secondaryAction.label}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

/* ── Affected Holdings: real portfolio data, no fabricated values. ──
   Ticker · name · weight · impact direction · impact label · optional exposure. */
export function AffectedHoldings({ holdings = [], compact = false, onOpenHolding, className = "" }) {
  if (!holdings || !holdings.length) {
    return <p className="intel-empty__note">No holdings impact for this workspace.</p>;
  }
  return (
    <div className={`intel-affected ${compact ? "intel-affected--compact" : ""} ${className}`}>
      <ul className="intel-affected__list" role="list">
        {holdings.map((h) => {
          const dir = String(h.direction || "flat").toLowerCase();
          const label = h.impactLabel || (dir === "up" ? "Up" : dir === "down" ? "Down" : dir === "mixed" ? "Mixed" : "Flat");
          return (
            <li key={h.symbol} className="intel-affected__row" data-dir={dir}>
              <button
                type="button"
                className="intel-affected__sym"
                onClick={() => onOpenHolding ? onOpenHolding(h.symbol) : null}
                disabled={!onOpenHolding}
              >{h.symbol}</button>
              <span className="intel-affected__name">{h.name}</span>
              {typeof h.weight === "number" ? <span className="intel-affected__weight">{h.weight.toFixed(1)}%</span> : null}
              <span className={`intel-affected__dir is-${dir}`} aria-label={`Impact ${label}`}>
                <span className="intel-affected__dir-arrow" aria-hidden="true">{dir === "up" ? "↑" : dir === "down" ? "↓" : dir === "mixed" ? "⇄" : "→"}</span>
                <span className="intel-affected__dir-label">{label}</span>
              </span>
              {typeof h.estExposure === "number" ? <span className="intel-affected__exposure">{h.estExposure.toFixed(1)}%</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default {
  IntelligenceShell, IntelligenceCard, IntelligenceHeader, IntelligenceSection,
  IntelligenceTimeline, IntelligenceTimelineItem, IntelligenceToolbar,
  IntelligenceStatus, IntelligenceBadge, IntelligenceChip, IntelligenceAction,
  IntelligenceEmptyState, IntelligenceDiagnostics,
  ExecutiveSummary, AffectedHoldings,
};
