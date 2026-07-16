import { useEffect, useId, useRef, useState } from "react";

export function CompactPageHeader({
  eyebrow,
  title,
  description,
  meta,
  actions,
  className = "",
}) {
  return (
    <header className={`compact-page-header ${className}`.trim()}>
      <div className="compact-page-header-copy">
        {eyebrow ? <div className="compact-page-eyebrow">{eyebrow}</div> : null}
        <div className="compact-page-title-row">
          <h2>{title}</h2>
          {meta ? <div className="compact-page-meta">{meta}</div> : null}
        </div>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="compact-page-actions">{actions}</div> : null}
    </header>
  );
}

export function MetricStrip({ items = [], className = "" }) {
  return (
    <section className={`metric-strip ${className}`.trim()} aria-label="Summary metrics">
      {items.map((item) => (
        <article key={item.label} className={`metric-strip-item ${item.tone || "neutral"}`.trim()}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.helper ? <em>{item.helper}</em> : null}
        </article>
      ))}
    </section>
  );
}

export function DensePanelHeader({
  title,
  subtitle,
  meta,
  actions,
  className = "",
}) {
  return (
    <div className={`dense-panel-header ${className}`.trim()}>
      <div className="dense-panel-copy">
        {title ? <h3>{title}</h3> : null}
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      <div className="dense-panel-actions">
        {meta ? <span className="dense-panel-meta">{meta}</span> : null}
        {actions}
      </div>
    </div>
  );
}

export function InlineControlGroup({ children, className = "" }) {
  return <div className={`inline-control-group ${className}`.trim()}>{children}</div>;
}

export function GuidedEmptyState({
  eyebrow = "Next Step",
  title,
  description,
  steps = [],
  cta,
  onAction,
  secondaryCta,
  onSecondaryAction,
  tone = "default",
  className = "",
}) {
  return (
    <section className={`guided-empty-state ${tone} ${className}`.trim()} role="status" aria-live="polite">
      <div className="guided-empty-copy">
        <span>{eyebrow}</span>
        <h3>{title}</h3>
        {description ? <p>{description}</p> : null}
      </div>
      {steps.length ? (
        <div className="guided-empty-steps">
          {steps.map((step, index) => (
            <div key={`${step}-${index}`} className="guided-empty-step">
              <strong>{index + 1}</strong>
              <span>{step}</span>
            </div>
          ))}
        </div>
      ) : null}
      {(cta || secondaryCta) ? (
        <div className="guided-empty-actions">
          {cta ? (
            <button type="button" className="journal-btn primary" onClick={onAction}>
              {cta}
            </button>
          ) : null}
          {secondaryCta ? (
            <button type="button" className="journal-btn secondary" onClick={onSecondaryAction}>
              {secondaryCta}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function FilterPopover({
  open,
  onToggle,
  label = "Filters",
  children,
  className = "",
}) {
  const wrapperRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (!wrapperRef.current?.contains(event.target)) {
        onToggle(false);
      }
    };
    const handleEscape = (event) => {
      if (event.key === "Escape") onToggle(false);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open, onToggle]);

  return (
    <div className={`filter-popover ${className}`.trim()} ref={wrapperRef}>
      <button
        type="button"
        className={`compact-filter-trigger ${open ? "active" : ""}`.trim()}
        onClick={() => onToggle(!open)}
        aria-expanded={open}
      >
        {label}
      </button>
      {open ? <div className="compact-filter-surface">{children}</div> : null}
    </div>
  );
}

export function RightRailDrawer({
  open,
  onClose,
  title,
  subtitle,
  actions,
  children,
  className = "",
}) {
  const [isMounted, setIsMounted] = useState(open);
  const [isClosing, setIsClosing] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (open) {
      setIsMounted(true);
      setIsClosing(false);
    } else if (isMounted) {
      setIsClosing(true);
      const timer = window.setTimeout(() => {
        setIsMounted(false);
        setIsClosing(false);
      }, 180);
      return () => window.clearTimeout(timer);
    }
    if (!open && !isMounted) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);
    if (open) closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [isMounted, onClose, open]);

  if (!isMounted) return null;
  return (
    <div className={`right-rail-drawer-overlay ${isClosing ? "is-closing" : ""}`.trim()} onMouseDown={onClose}>
      <aside
        className={`right-rail-drawer ${isClosing ? "is-closing" : ""} ${className}`.trim()}
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title ? undefined : "Drawer"}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={subtitle ? descriptionId : undefined}
      >
        <div className="right-rail-drawer-head">
          <div>
            {title ? <h2 id={titleId}>{title}</h2> : null}
            {subtitle ? <p id={descriptionId}>{subtitle}</p> : null}
          </div>
          <div className="right-rail-drawer-actions">
            {actions}
            <button
              ref={closeButtonRef}
              type="button"
              className="compact-close-btn icon-button"
              onClick={onClose}
              aria-label="Close drawer"
            >
              ×
            </button>
          </div>
        </div>
        <div className="right-rail-drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/**
 * WorkspaceLayout — shared 3-column workspace shell (header / sidebar / main / rail).
 * Used by the Asset Research Workspace (ARW). Pure flexbox; no bespoke styling
 * beyond the monochrome tokens in styles.css (.workspace-layout et al).
 */
export function WorkspaceLayout({ header, sidebar, children, rail, className = "" }) {
  return (
    <div className={`workspace-layout ${className}`.trim()}>
      {header ? <div className="workspace-layout-header">{header}</div> : null}
      <div className="workspace-layout-body">
        {sidebar ? <nav className="workspace-layout-sidebar" aria-label="Workspace sections">{sidebar}</nav> : null}
        <main className="workspace-layout-main">{children}</main>
        {rail ? <aside className="workspace-layout-rail" aria-label="Intelligence">{rail}</aside> : null}
      </div>
    </div>
  );
}

/** Panel — a bordered content surface (card). */
export function Panel({ title, meta, actions, footer, children, className = "", as: Tag = "section" }) {
  return (
    <Tag className={`ws-panel ${className}`.trim()}>
      {(title || actions) ? (
        <div className="ws-panel-head">
          <div className="ws-panel-head-copy">
            {title ? <h3>{title}</h3> : null}
            {meta ? <span className="ws-panel-meta">{meta}</span> : null}
          </div>
          {actions ? <div className="ws-panel-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="ws-panel-body">{children}</div>
      {footer ? <div className="ws-panel-footer">{footer}</div> : null}
    </Tag>
  );
}

/** Section — an in-page region with a heading. */
export function Section({ title, description, actions, children, className = "" }) {
  return (
    <section className={`ws-section ${className}`.trim()}>
      {(title || actions) ? (
        <div className="ws-section-head">
          <div>
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="ws-section-actions">{actions}</div> : null}
        </div>
      ) : null}
      <div className="ws-section-body">{children}</div>
    </section>
  );
}

/** MetricCard — a single labelled metric. */
export function MetricCard({ label, value, helper, tone = "neutral", className = "" }) {
  return (
    <div className={`ws-metric-card ${tone} ${className}`.trim()}>
      <span className="ws-metric-label">{label}</span>
      <strong className="ws-metric-value">{value}</strong>
      {helper ? <span className="ws-metric-helper">{helper}</span> : null}
    </div>
  );
}

/** Badge — small status/label pill. Never color-only: pair with text. */
export function Badge({ children, tone = "neutral", className = "" }) {
  return <span className={`ws-badge ${tone} ${className}`.trim()}>{children}</span>;
}

/** Tag — removable/static keyword chip. */
export function Tag({ children, onRemove, className = "" }) {
  return (
    <span className={`ws-tag ${className}`.trim()}>
      {children}
      {onRemove ? (
        <button type="button" className="ws-tag-remove" onClick={onRemove} aria-label={`Remove ${typeof children === "string" ? children : "tag"}`}>×</button>
      ) : null}
    </span>
  );
}

/** InsightCard — a compact insight (thesis line, catalyst, note). */
export function InsightCard({ title, meta, tone = "neutral", actions, children, className = "" }) {
  return (
    <article className={`ws-insight-card ${tone} ${className}`.trim()}>
      {(title || meta || actions) ? (
        <header className="ws-insight-head">
          <div>
            {title ? <h4>{title}</h4> : null}
            {meta ? <span className="ws-insight-meta">{meta}</span> : null}
          </div>
          {actions ? <div className="ws-insight-actions">{actions}</div> : null}
        </header>
      ) : null}
      {children ? <div className="ws-insight-body">{children}</div> : null}
    </article>
  );
}

/** Skeleton — neutral loading placeholder (no color-only comms). */
export function Skeleton({ lines = 3, className = "" }) {
  return (
    <div className={`ws-skeleton ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="ws-skeleton-line" style={{ width: `${90 - (i % 3) * 18}%` }} />
      ))}
    </div>
  );
}

/** Table — minimal accessible table built from column defs (no bespoke CSS). */
export function Table({ columns, rows, rowKey = (r, i) => String(i), emptyState }) {
  return (
    <div className="ws-table-wrap table-scroll">
      <table className="ws-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, i) => (
              <tr key={rowKey(row, i)}>
                {columns.map((c) => (
                  <td key={c.key}>{c.cell ? c.cell(row) : row[c.key]}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td colSpan={columns.length} className="empty-table-msg">
                {emptyState || "No data."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/**
 * CONTRACT: the eight primitives below are the shared vocabulary for the
 * vNext Asset Research Workspace (ARW) and Compare Workspace. They are
 * presentation-only and data-source-agnostic (accept plain items/rows/
 * children); both workspaces compose them so the two screens share layouts,
 * spacing, typography, and interactions per the vNext design spec.
 */

/**
 * ResearchCard — a linked research object (thesis / note / brief).
 * Supports the vNext Research Object contract: author, status, confidence,
 * priority, linked objects, last reviewed.
 */
export function ResearchCard({
  title,
  meta,
  author,
  status,
  confidence,
  priority,
  tags = [],
  links = [],
  onOpen,
  className = "",
}) {
  return (
    <article
      className={`ws-research-card ${status ? `status-${status}` : ""} ${className}`.trim()}
      onClick={onOpen ? () => onOpen() : undefined}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
    >
      <header className="ws-research-card-head">
        <h4>{title}</h4>
        {status ? <Badge tone={status === "approved" ? "positive" : status === "rejected" ? "negative" : "warning"}>{status}</Badge> : null}
      </header>
      {meta ? <p className="ws-research-card-meta">{meta}</p> : null}
      <div className="ws-research-card-facts">
        {author ? <span><em>Author</em>{author}</span> : null}
        {confidence != null ? <span><em>Confidence</em>{confidence}</span> : null}
        {priority ? <span><em>Priority</em>{priority}</span> : null}
      </div>
      {tags.length ? (
        <div className="ws-research-card-tags">{tags.map((t) => <Tag key={t}>{t}</Tag>)}</div>
      ) : null}
      {links.length ? (
        <div className="ws-research-card-links">
          {links.map((l) => <span key={l.label} className="ws-link-chip">{l.label}</span>)}
        </div>
      ) : null}
    </article>
  );
}

/**
 * EvidenceCard — a single piece of supporting evidence with provenance.
 * `weight` is qualitative (low/med/high) so scoring stays evidence-backed.
 */
export function EvidenceCard({ title, source, detail, weight, verdict, className = "" }) {
  return (
    <article className={`ws-evidence-card weight-${weight || "med"} ${className}`.trim()}>
      <header className="ws-evidence-head">
        <h5>{title}</h5>
        {verdict ? <Badge tone={verdict === "supports" ? "positive" : verdict === "contradicts" ? "negative" : "warning"}>{verdict}</Badge> : null}
      </header>
      {detail ? <p>{detail}</p> : null}
      <footer className="ws-evidence-foot">
        {source ? <span className="ws-evidence-source">{source}</span> : null}
        {weight ? <span className="ws-evidence-weight">weight: {weight}</span> : null}
      </footer>
    </article>
  );
}

/**
 * RiskCard — a risk with severity, likelihood, and mitigation.
 */
export function RiskCard({ title, severity = "med", likelihood, mitigation, className = "" }) {
  return (
    <article className={`ws-risk-card severity-${severity} ${className}`.trim()}>
      <header className="ws-risk-head">
        <h5>{title}</h5>
        <Badge tone={severity === "high" ? "negative" : severity === "med" ? "warning" : "neutral"}>{severity}</Badge>
      </header>
      {likelihood ? <p className="ws-risk-likelihood"><em>Likelihood</em> {likelihood}</p> : null}
      {mitigation ? <p className="ws-risk-mitigation">{mitigation}</p> : null}
    </article>
  );
}

/**
 * CatalystCard — a dated catalyst event with state.
 */
export function CatalystCard({ title, date, status = "upcoming", note, className = "" }) {
  const tone = status === "complete" ? "positive" : status === "watching" ? "warning" : "neutral";
  return (
    <article className={`ws-catalyst-card status-${status} ${className}`.trim()}>
      <header className="ws-catalyst-head">
        <h5>{title}</h5>
        <Badge tone={tone}>{status}</Badge>
      </header>
      {date ? <time className="ws-catalyst-date">{date}</time> : null}
      {note ? <p className="ws-catalyst-note">{note}</p> : null}
    </article>
  );
}

/**
 * NewsCard — a news item with source + timestamp.
 */
export function NewsCard({ title, source, time, summary, url, className = "" }) {
  const body = (
    <>
      <header className="ws-news-head">
        <h5>{title}</h5>
        <span className="ws-news-source">{source}{time ? ` · ${time}` : ""}</span>
      </header>
      {summary ? <p className="ws-news-summary">{summary}</p> : null}
    </>
  );
  return (
    <article className={`ws-news-card ${className}`.trim()}>
      {url ? <a href={url} target="_blank" rel="noreferrer" className="ws-news-link">{body}</a> : body}
    </article>
  );
}

/**
 * DocumentCard — a reference document (filing / report / note) with type.
 */
export function DocumentCard({ title, docType, meta, url, onOpen, className = "" }) {
  const inner = (
    <>
      <header className="ws-doc-head">
        <h5>{title}</h5>
        {docType ? <Badge>{docType}</Badge> : null}
      </header>
      {meta ? <p className="ws-doc-meta">{meta}</p> : null}
    </>
  );
  return (
    <article
      className={`ws-doc-card ${className}`.trim()}
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen ? () => onOpen() : undefined}
      onKeyDown={onOpen ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } } : undefined}
    >
      {url ? <a href={url} target="_blank" rel="noreferrer" className="ws-doc-link">{inner}</a> : inner}
    </article>
  );
}

/**
 * Timeline — chronological research timeline mixing journal/decisions/news/
 * catalysts/earnings/filings/price events. `items` = [{ id, kind, title,
 * meta, time }]; `kind` drives the monochrome marker style (no color-only).
 */
export function Timeline({ items = [], className = "" }) {
  if (!items.length) return <p className="ws-timeline-empty">No timeline events yet.</p>;
  return (
    <ol className={`ws-timeline ${className}`.trim()} aria-label="Research timeline">
      {items.map((it) => (
        <li key={it.id} className={`ws-timeline-item kind-${it.kind || "event"}`.trim()}>
          <span className="ws-timeline-marker" aria-hidden="true" />
          <div className="ws-timeline-content">
            <div className="ws-timeline-row">
              <span className="ws-timeline-kind">{it.kind}</span>
              {it.time ? <time className="ws-timeline-time">{it.time}</time> : null}
            </div>
            <h5>{it.title}</h5>
            {it.meta ? <p className="ws-timeline-meta">{it.meta}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}

/**
 * SidebarGroup — a labelled group in a workflow-oriented sidebar.
 * Renders an uppercase eyebrow header. Children are SidebarItems.
 */
export function SidebarGroup({ label, children, className = "" }) {
  return (
    <div className={`ws-sidebar-group ${className}`.trim()}>
      {label ? <div className="ws-sidebar-group-label">{label}</div> : null}
      <div className="ws-sidebar-group-items">{children}</div>
    </div>
  );
}

/**
 * SidebarItem — a single workflow sidebar entry. <button> (focusable,
 * keyboard-native). `active` shows a left-border accent (semantic, not
 * color-only — pair with weight/highlight). `badge` renders a count chip.
 */
export function SidebarItem({ icon, label, badge, active, action, onClick, className = "" }) {
  return (
    <button
      type="button"
      className={`ws-sidebar-item ${active ? "active" : ""} ${action ? "action" : ""} ${className}`.trim()}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
    >
      {icon ? <span className="ws-sidebar-item-icon" aria-hidden="true">{icon}</span> : null}
      <span className="ws-sidebar-item-label">{label}</span>
      {action ? <span className="ws-sidebar-item-chevron" aria-hidden="true">↗</span> : null}
      {badge != null && badge !== 0 ? <span className="ws-sidebar-item-badge">{badge}</span> : null}
    </button>
  );
}

/**
 * ScoreGauge — circular SVG gauge, 0–100, monochrome track with a semantic
 * arc. Tone is reinforced by a numeric label (never color-only). Used for
 * Research Score / conviction.
 */
export function ScoreGauge({ value = 0, label, size = 72, className = "" }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const stroke = 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;
  const tone = v >= 70 ? "high" : v >= 40 ? "mid" : "low";
  return (
    <div className={`ws-gauge tone-${tone} ${className}`.trim()} role="img" aria-label={`${label || "Score"} ${v} of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ws-gauge-svg">
        <circle cx={size / 2} cy={size / 2} r={r} className="ws-gauge-track" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2} cy={size / 2} r={r} className="ws-gauge-fill"
          strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="ws-gauge-readout">
        <strong>{v}</strong>
        {label ? <span className="ws-gauge-label">{label}</span> : null}
      </div>
    </div>
  );
}

/**
 * ConfidenceBadge — pill showing NN% confidence with a thin underlying meter
 * bar tinted by semantic token (success/warning/danger). Text + bar, never
 * color-only.
 */
export function ConfidenceBadge({ value = 0, label, className = "" }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const tone = v >= 66 ? "high" : v >= 33 ? "mid" : "low";
  return (
    <span className={`ws-confidence-badge tone-${tone} ${className}`.trim()}>
      <span className="ws-confidence-badge-label">{label || "Confidence"}</span>
      <span className="ws-confidence-badge-value">{v}%</span>
      <span className="ws-confidence-meter" aria-hidden="true">
        <span className="ws-confidence-meter-fill" style={{ width: `${v}%` }} />
      </span>
    </span>
  );
}

/**
 * PlaceholderMetric — a MetricCard variant for missing data. Renders a neutral
 * skeleton-gauge (dashed track) + "Awaiting data" label + optional hint,
 * replacing em-dash-only cells. Carries role="status" so SR users hear it.
 */
export function PlaceholderMetric({ label, hint, className = "" }) {
  return (
    <div className={`ws-metric-card placeholder ${className}`.trim()} role="status" aria-label={`${label}: awaiting data`}>
      <span className="ws-metric-label">{label}</span>
      <span className="ws-placeholder-gauge" aria-hidden="true">
        <span className="ws-placeholder-gauge-ring" />
      </span>
      <span className="ws-metric-helper">Awaiting data{hint ? ` · ${hint}` : ""}</span>
    </div>
  );
}

/**
 * Ghost — the lightest "value not yet populated" primitive for inline facts
 * (em-dash replacement in header/fact strips). Renders a muted token-driven
 * label instead of a raw "—", so a missing value reads as "stale / not yet
 * synced" rather than an empty dash. Pair: keep the <em> fact name so the
 * field position is preserved (no layout shift).
 */
export function Ghost({ label = "Not yet synced", className = "" }) {
  return (
    <span className={`ws-ghost ${className}`.trim()} title={label}>
      <span className="ws-ghost-pulse" aria-hidden="true" />
      {label}
    </span>
  );
}

/**
 * Sparkline — monochrome inline OHLCV mini-chart for a single series. Used by
 * the ARW Overview / Technicals to render the Massive daily aggregates (data.series)
 * instead of two static 52W numbers. Degrades to null (caller shows GuidedEmptyState).
 * Token-driven: stroke uses --color-data-* so it stays in the monochrome system.
 */
export function Sparkline({ series, height = 56, stroke = "var(--color-data-primary)", fill = "var(--color-data-muted)", className = "" }) {
  if (!series || !Array.isArray(series.points) || series.points.length < 2) return null;
  const pts = series.points;
  const W = 240;
  const H = height;
  const pad = 4;
  const closes = pts.map((p) => p.c);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const x = (i) => pad + (i / (pts.length - 1)) * (W - pad * 2);
  const y = (v) => H - pad - ((v - min) / span) * (H - pad * 2);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${H - pad} L${x(0).toFixed(1)},${H - pad} Z`;
  return (
    <svg
      className={`ws-sparkline ${className}`.trim()}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`1Y price series, ${pts.length} points, ${min.toFixed(2)}–${max.toFixed(2)}`}
    >
      <path d={area} fill={fill} fillOpacity={0.12} stroke="none" />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} />
    </svg>
  );
}

/**
 * AssetSummaryCard — vertical summary for one asset (Compare Overview).
 * ticker (large) + name, exchange·sector, price + change (semantic), market
 * cap, a 6-cell mini-metric grid, a small ScoreGauge conviction, and a
 * "View full research →" link. Identical structure for A and B → side-by-side.
 */
export function AssetSummaryCard({
  asset,
  score,
  metrics = [],
  onViewResearch,
  className = "",
}) {
  const data = asset || {};
  const changePct = data.changePct;
  const up = changePct != null ? Number(changePct) >= 0 : null;
  return (
    <article className={`ws-asset-summary ${className}`.trim()}>
      <header className="ws-asset-summary-head">
        <div className="ws-asset-summary-id">
          <span className="ws-asset-summary-sym">{data.symbol || "—"}</span>
          {data.name ? <span className="ws-asset-summary-name">{data.name}</span> : null}
        </div>
        <div className="ws-asset-summary-meta">
          {data.exchange ? <span>{data.exchange}</span> : null}
          {data.sector ? <span>· {data.sector}</span> : null}
        </div>
      </header>
      <div className="ws-asset-summary-price">
        {data.price != null ? <strong className="font-mono">${Number(data.price).toFixed(2)}</strong> : <span className="ws-asset-summary-no-price">—</span>}
        {up != null ? (
          <span className={`ws-asset-summary-change ${up ? "up" : "down"}`}>
            {up ? "▲" : "▼"} {Math.abs(Number(changePct)).toFixed(2)}%
          </span>
        ) : null}
      </div>
      <div className="ws-asset-summary-grid">
        {metrics.map((m) => (
          <div key={m.label} className="ws-asset-summary-cell">
            <span className="ws-asset-summary-cell-label">{m.label}</span>
            <span className="ws-asset-summary-cell-value">{m.value}</span>
          </div>
        ))}
      </div>
      <footer className="ws-asset-summary-foot">
        {score != null ? <ScoreGauge value={score} label="conviction" size={44} /> : null}
        {onViewResearch ? (
          <button type="button" className="ws-asset-summary-link" onClick={onViewResearch}>
            View full research →
          </button>
        ) : null}
      </footer>
    </article>
  );
}

/**
 * ResultBanner — decision summary banner above the Compare matrix.
 *  - insufficient-data: neutral, "Not enough data to declare a winner" + CTAs.
 *  - winner: semantic accent, winner symbol, ConfidenceBadge, one-line breakdown.
 */
export function ResultBanner({
  state = "winner",
  winner,
  confidence,
  breakdown,
  cta,
  secondaryCta,
  onAction,
  onSecondaryAction,
  className = "",
}) {
  if (state === "insufficient-data") {
    return (
      <section className={`ws-result-banner insufficient ${className}`.trim()} role="status" aria-live="polite">
        <div className="ws-result-banner-copy">
          <h3>Not enough data to declare a winner</h3>
          <p>Populate fundamentals for both assets to build the decision matrix.</p>
        </div>
        {(cta || secondaryCta) ? (
          <div className="ws-result-banner-actions">
            {cta ? <button type="button" className="journal-btn primary" onClick={onAction}>{cta}</button> : null}
            {secondaryCta ? <button type="button" className="journal-btn secondary" onClick={onSecondaryAction}>{secondaryCta}</button> : null}
          </div>
        ) : null}
      </section>
    );
  }
  return (
    <section className={`ws-result-banner winner ${className}`.trim()} aria-live="polite">
      <div className="ws-result-banner-copy">
        <span className="ws-result-banner-eyebrow">Decision</span>
        <h3>Winner · <strong>{winner}</strong></h3>
        <ConfidenceBadge value={confidence} />
        {breakdown ? <p className="ws-result-banner-breakdown">{breakdown}</p> : null}
      </div>
      {(cta || secondaryCta) ? (
        <div className="ws-result-banner-actions">
          {cta ? <button type="button" className="journal-btn primary" onClick={onAction}>{cta}</button> : null}
          {secondaryCta ? <button type="button" className="journal-btn secondary" onClick={onSecondaryAction}>{secondaryCta}</button> : null}
        </div>
      ) : null}
    </section>
  );
}

/**
 * DecisionMatrixEmpty — structure preview when no verdict exists: lists the
 * canonical dimensions as empty rows (PlaceholderMetric cells) + the explanatory
 * message + action buttons. Replaces the dead "Winner Tie 0%".
 */
export const DECISION_DIMENSIONS = [
  "Valuation", "Growth", "Profitability", "Moat", "Execution", "Risk",
];

export function DecisionMatrixEmpty({ cta, secondaryCta, onAction, onSecondaryAction, className = "" }) {
  return (
    <div className={`ws-decision-empty ${className}`.trim()}>
      <div className="ws-decision-empty-rows">
        {DECISION_DIMENSIONS.map((d) => (
          <div key={d} className="ws-decision-empty-row">
            <span className="ws-decision-empty-dim"><strong>{d}</strong></span>
            <PlaceholderMetric label="A" />
            <span className="ws-decision-empty-win"><Badge tone="neutral">Tie</Badge></span>
            <PlaceholderMetric label="B" />
          </div>
        ))}
      </div>
      <div className="ws-decision-empty-foot">
        <p>Insufficient data to score these dimensions. The matrix populates as fundamentals arrive.</p>
        {(cta || secondaryCta) ? (
          <div className="ws-decision-empty-actions">
            {cta ? <button type="button" className="journal-btn primary" onClick={onAction}>{cta}</button> : null}
            {secondaryCta ? <button type="button" className="journal-btn secondary" onClick={onSecondaryAction}>{secondaryCta}</button> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * ComparisonMatrix — the Compare Workspace decision-matrix centerpiece.
 * Rows are scored dimensions; the winner is derived from evidence, never
 * asserted arbitrarily. `rows` = [{
 *   id, label, weight,
 *   a: { score, display, evidence }, b: { score, display, evidence },
 *   winner: "A" | "B" | "tie", confidence, explanation
 * }].
 * `showEvidence` toggles the evidence/explanations column.
 */
export function ComparisonMatrix({ rows = [], assetA, assetB, showEvidence = true, className = "" }) {
  if (!rows.length) return <p className="ws-matrix-empty">No comparison dimensions scored yet.</p>;
  return (
    <div className={`ws-comparison-matrix ${className}`.trim()}>
      <div className="ws-matrix-grid" role="table" aria-label="Decision matrix">
        <div className="ws-matrix-head" role="row">
          <span role="columnheader" className="ws-matrix-dim">Dimension</span>
          <span role="columnheader" className="ws-matrix-asset-a">{assetA || "Asset A"}</span>
          <span role="columnheader" className="ws-matrix-winner">Winner</span>
          <span role="columnheader" className="ws-matrix-asset-b">{assetB || "Asset B"}</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} className={`ws-matrix-row ${r.winner === "A" ? "win-a" : r.winner === "B" ? "win-b" : "win-tie"}`.trim()} role="row">
            <span role="cell" className="ws-matrix-dim">
              <strong>{r.label}</strong>
              {r.weight != null ? <em className="ws-matrix-weight">w {r.weight}</em> : null}
            </span>
            <span role="cell" className={`ws-matrix-score a ${r.winner === "A" ? "is-winner" : ""}`.trim()}>
              <span className="ws-matrix-bar" aria-hidden="true"><span className="ws-matrix-bar-fill" style={{ width: `${matrixFill(r.a?.score)}%` }} /></span>
              <strong>{r.a?.display ?? r.a?.score ?? "—"}</strong>
              {showEvidence && r.a?.evidence ? <em className="ws-matrix-evidence">{r.a.evidence}</em> : null}
            </span>
            <span role="cell" className="ws-matrix-winner-cell">
              <Badge tone={r.winner === "tie" ? "warning" : "neutral"}>
                {r.winner === "A" ? (assetA || "A") : r.winner === "B" ? (assetB || "B") : "Tie"}
              </Badge>
              {r.confidence != null ? <em className="ws-matrix-confidence">{r.confidence}</em> : null}
            </span>
            <span role="cell" className={`ws-matrix-score b ${r.winner === "B" ? "is-winner" : ""}`.trim()}>
              <span className="ws-matrix-bar" aria-hidden="true"><span className="ws-matrix-bar-fill" style={{ width: `${matrixFill(r.b?.score)}%` }} /></span>
              <strong>{r.b?.display ?? r.b?.score ?? "—"}</strong>
              {showEvidence && r.b?.evidence ? <em className="ws-matrix-evidence">{r.b.evidence}</em> : null}
            </span>
          </div>
        ))}
      </div>
      {showEvidence ? (
        <div className="ws-matrix-explanations">
          {rows.filter((r) => r.explanation).map((r) => (
            <p key={r.id} className="ws-matrix-explanation-row">
              <strong>{r.label}:</strong> {r.explanation}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Relative fill for a matrix score cell. Raw scores vary by unit (P/E, %, etc.),
// so the bar is a normalized 0–100 visual cue keyed to `score` as a percentage
// when it is already 0–100, else a flat mid-fill so the track still reads.
// Never the sole carrier of meaning — the numeric display + winner badge are.
function matrixFill(score) {
  const n = Number(score);
  if (!Number.isFinite(n)) return 0;
  if (n >= 0 && n <= 100) return n;
  if (n < 0) return 0;
  return Math.min(100, (n / (n * 2)) * 100); // unknown scale → neutral half-fill
}
