// Onboarding shared primitives — institutional "Workspace Setup" presentation.
// Presentation ONLY. No business logic, persistence, or validation here.
// Reuses the monochrome Zenin token system (no bespoke color language).
import { useEffect, useRef } from "react";

/* ============================================================
   Field — shared input primitive (44px, label above, helper below,
   10px radius, focus ring). Replaces browser-default inputs.
   ============================================================ */
export function Field({ id, label, helper, as = "input", children, ...rest }) {
  const generated = useRef(`fld-${Math.random().toString(36).slice(2, 8)}`).current;
  const fieldId = id || generated;
  const helpId = `${fieldId}-help`;
  return (
    <label className="ob-field" htmlFor={fieldId}>
      {label ? <span className="ob-field-label">{label}</span> : null}
      {as === "select" ? (
        <select id={fieldId} className="ob-input ob-input-select" aria-describedby={helper ? helpId : undefined} {...rest}>
          {children}
        </select>
      ) : (
        <input id={fieldId} className="ob-input" aria-describedby={helper ? helpId : undefined} {...rest} />
      )}
      {helper ? <span id={helpId} className="ob-field-help">{helper}</span> : null}
    </label>
  );
}

/* ============================================================
   SetupNavigator — LEFT column. Timeline progress. NO app sidebar.
   Current step highlighted; completed ✓; future ○ muted.
   ============================================================ */
export function SetupNavigator({ plan, currentIndex, total, steps, remainingLabel, onJump }) {
  return (
    <nav className="ob-navigator" aria-label="Workspace setup progress">
      <div className="ob-nav-brand">ZENIN</div>
      <div className="ob-nav-plan">
        <span className="ob-nav-plan-name">{plan ? `${plan[0].toUpperCase()}${plan.slice(1)} Workspace` : "Workspace"}</span>
      </div>
      <div className="ob-nav-progress">
        <span className="ob-nav-count">Step {Math.min(currentIndex + 1, total)} of {total}</span>
        <span className="ob-nav-bar" role="progressbar" aria-valuenow={Math.round((currentIndex / Math.max(total - 1, 1)) * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span className="ob-nav-bar-fill" style={{ width: `${(currentIndex / Math.max(total - 1, 1)) * 100}%` }} />
        </span>
      </div>
      <ol className="ob-timeline">
        {steps.map((s, i) => {
          const state = i < currentIndex ? "done" : i === currentIndex ? "current" : "todo";
          return (
            <li key={s.key} className={`ob-tl-item is-${state}`}>
              <button
                type="button"
                className="ob-tl-node"
                aria-current={i === currentIndex ? "step" : undefined}
                disabled={state === "todo"}
                onClick={() => state === "done" && onJump?.(i)}
              >
                <span className="ob-tl-dot" aria-hidden="true">{state === "done" ? "✓" : ""}</span>
                <span className="ob-tl-text">{s.title}</span>
              </button>
              {i < steps.length - 1 ? <span className="ob-tl-line" aria-hidden="true" /> : null}
            </li>
          );
        })}
      </ol>
      {remainingLabel ? <div className="ob-nav-remaining">{remainingLabel}</div> : null}
    </nav>
  );
}

/* ============================================================
   StepPanel — CENTER column wrapper. Panel + DensePanelHeader vocab,
   32px padding, type scale (hero 36 / title 28 / desc 16 / label 13 /
   help 12 / btn 14).
   ============================================================ */
export function StepPanel({ eyebrow, title, description, children, footer }) {
  return (
    <section className="ob-panel" aria-label={title}>
      <header className="ob-panel-head">
        {eyebrow ? <p className="ob-panel-eyebrow">{eyebrow}</p> : null}
        <h1 className="ob-panel-title">{title}</h1>
        {description ? <p className="ob-panel-desc">{description}</p> : null}
      </header>
      <div className="ob-panel-body">{children}</div>
      {footer ? <footer className="ob-panel-footer">{footer}</footer> : null}
    </section>
  );
}

/* ============================================================
   OptionCard — selectable tile (radio/checkbox). Animated selection.
   ============================================================ */
export function OptionCard({ selected, onClick, title, description, multi = false, disabled = false }) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      disabled={disabled}
      className={`ob-opt ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}
      onClick={onClick}
    >
      <span className="ob-opt-mark" aria-hidden="true" />
      <span className="ob-opt-body">
        <span className="ob-opt-title">{title}</span>
        {description ? <span className="ob-opt-desc">{description}</span> : null}
      </span>
    </button>
  );
}

/* ============================================================
   SelectCard — larger import/connect option.
   ============================================================ */
export function SelectCard({ selected, onClick, title, description, badge, disabled = false }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      className={`ob-sel ${selected ? "is-selected" : ""} ${disabled ? "is-disabled" : ""}`}
      onClick={onClick}
    >
      <span className="ob-sel-mark" aria-hidden="true" />
      <span className="ob-sel-body">
        <span className="ob-sel-title">{title}</span>
        {description ? <span className="ob-sel-desc">{description}</span> : null}
      </span>
      {badge ? <span className="ob-sel-badge">{badge}</span> : null}
    </button>
  );
}

/* ============================================================
   ToggleCard — notification toggles (on/off, label + helper).
   ============================================================ */
export function ToggleCard({ on, onClick, title, description }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`ob-toggle ${on ? "is-on" : ""}`} onClick={onClick}>
      <span className="ob-toggle-body">
        <span className="ob-toggle-title">{title}</span>
        {description ? <span className="ob-toggle-desc">{description}</span> : null}
      </span>
      <span className="ob-toggle-track" aria-hidden="true"><span className="ob-toggle-knob" /></span>
    </button>
  );
}

/* ============================================================
   SetupPreview — RIGHT column. Live workspace preview. Updates per answer.
   ============================================================ */
export function SetupPreview({ plan, answers }) {
  const region = answers.country ? answers.country : answers.timezone ? "Auto" : "—";
  const markets = (answers.markets || []).map((m) => m.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()));
  const portfolio = answers.portfolio?.method
    ? answers.portfolio.method === "empty"
      ? "Not imported"
      : answers.portfolio.method.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
    : "Not imported";
  const modules = plan === "plus" || plan === "pro"
    ? ["Research", "Journal", "Decisions", "Portfolio", "Options Desk"]
    : plan === "premium" || plan === "desk"
    ? ["Research", "Journal", "Decisions", "Portfolio", "Team"]
    : ["Research", "Journal", "Decisions", "Portfolio"];
  const optMode = answers.horizon ? answers.horizon.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : "—";
  const rows = [
    ["Region", region],
    ["Markets", markets.length ? markets.join(", ") : "—"],
    ["Research Mode", optMode],
    ["Default Currency", answers.currency || "—"],
    ["Watchlists", answers.markets?.length ? String(answers.markets.length) : "0"],
    ["Portfolio", portfolio],
  ];
  return (
    <aside className="ob-review" aria-label="Workspace preview">
      <p className="ob-review-title">Workspace Preview</p>
      <dl className="ob-review-list">
        {rows.map(([k, v]) => (
          <div className="ob-review-row" key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="ob-review-modules">
        <p className="ob-review-subtitle">Modules Enabled</p>
        <ul className="ob-review-mods">
          {modules.map((m) => (
            <li key={m} className="ob-review-mod"><span className="ob-review-check" aria-hidden="true">✓</span>{m}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/* ============================================================
   Provisioning + Completion visuals (animation handled in CSS).
   ============================================================ */
export function ProvisioningList({ items, revealed }) {
  return (
    <ul className="ob-provision" aria-label="Workspace provisioning">
      {items.map((it, i) => {
        const done = i < revealed;
        return (
          <li key={it.key} className={`ob-prov-item ${done ? "is-done" : "is-pending"}`} style={{ "--ob-delay": `${i * 120}ms` }}>
            <span className="ob-prov-check" aria-hidden="true">{done ? "✓" : ""}</span>
            <span className="ob-prov-label">{it.label}</span>
            {done && it.sub ? <span className="ob-prov-sub">{it.sub}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function CompletionHero({ name, plan, configured }) {
  return (
    <div className="ob-hero">
      <p className="ob-hero-eyebrow">Workspace Ready</p>
      <h1 className="ob-hero-title">Your research workspace has been created.</h1>
      {name ? <p className="ob-hero-name">Configured for {name}</p> : null}
      {configured?.length ? (
        <ul className="ob-hero-list">
          {configured.map((c) => (
            <li key={c}><span className="ob-hero-check" aria-hidden="true">✓</span>{c}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ============================================================
   Buttons — hierarchy: primary (Continue) / ghost (Previous) /
   secondary (Skip). Never equal visual weight.
   ============================================================ */
export function StepFooter({ onBack, onContinue, canContinue, continueLabel = "Continue", isFirst = false, onSkip, skipLabel = "Skip" }) {
  return (
    <div className="ob-footer">
      <div className="ob-footer-left">
        {!isFirst ? (
          <button type="button" className="ob-btn ob-btn-ghost" onClick={onBack}>Previous</button>
        ) : (
          <span />
        )}
      </div>
      <div className="ob-footer-right">
        {onSkip ? (
          <button type="button" className="ob-btn ob-btn-secondary" onClick={onSkip}>{skipLabel}</button>
        ) : null}
        <button type="button" className="ob-btn ob-btn-primary" onClick={onContinue} disabled={!canContinue} aria-disabled={!canContinue}>
          {continueLabel}
        </button>
      </div>
    </div>
  );
}

/* Focus trap — Escape does nothing (spec: Esc must not exit setup). */
export function useFocusTrap(ref, active) {
  useEffect(() => {
    if (!active || !ref?.current) return undefined;
    const el = ref.current;
    const prev = document.activeElement;
    const focusables = () =>
      Array.from(el.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter(
        (n) => !n.disabled && n.offsetParent !== null
      );
    const onKey = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        return;
      }
      if (e.key === "Enter" && e.target?.tagName === "BUTTON" && e.target?.getAttribute("aria-current") !== "step") {
        // Enter on step buttons advances (handled by their own onClick)
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener("keydown", onKey);
    if (!el.contains(prev)) focusables()[0]?.focus();
    return () => {
      el.removeEventListener("keydown", onKey);
      if (prev && prev.focus) prev.focus();
    };
  }, [ref, active]);
}
