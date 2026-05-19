import { useEffect, useId, useRef } from "react";

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
  const titleId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape") onClose();
    };
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleEscape);
    closeButtonRef.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose, open]);

  if (!open) return null;
  return (
    <div className="right-rail-drawer-overlay" onMouseDown={onClose}>
      <aside
        className={`right-rail-drawer ${className}`.trim()}
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
              className="compact-close-btn"
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
