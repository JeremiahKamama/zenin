import React, { useEffect, useRef } from "react";
import ActionStepper from "./ActionStepper";

/**
 * ActionWorkspace — shared centered floating modal that powers every guided
 * Action Center workflow across Zenin (Rebalancing, Missing Data, Volatility,
 * Research Trigger, Import Review, Tax Review, Portfolio/Sync/Risk Review,
 * Future AI Recommendations).
 *
 * Design contract (per Brandv2.md — monochrome only, token-driven):
 *  - Centered floating surface, blurred + dimmed backdrop, large elevation.
 *  - Header (eyebrow + title + description, close + ESC hint), Stepper,
 *    scrollable Main workspace, persistent sticky Footer.
 *  - Optional right diagnostics rail (advanced context, non-cluttering).
 *  - Motion: scale 95% -> 100% + fade + slide-up; backdrop blur on enter;
 *    reverse on close (handled by mount/unmount via `open`).
 *  - Accessibility: role="dialog", aria-modal, aria-labelledby/aria-describedby,
 *    focus trap, focus returns to trigger on close, ESC to close.
 *
 * This component owns NO workflow logic — it is pure shell + chrome.
 * Content per step is supplied by children / render props.
 */
export default function ActionWorkspace({
  open,
  onClose,
  eyebrow = "Action Center",
  title,
  description,
  steps = [],
  currentStep = 1,
  onStepClick,
  footer,
  diagnostics,
  children,
  width = "min(1180px, 100%)",
  describedById = "aw-desc",
  labelledById = "aw-title",
}) {
  const dialogRef = useRef(null);
  const previouslyFocused = useRef(null);

  // Capture trigger element + lock scroll + focus trap + ESC
  useEffect(() => {
    if (!open) return undefined;
    previouslyFocused.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Move focus into the dialog
    const focusTarget =
      dialogRef.current?.querySelector("[data-autofocus]") ||
      dialogRef.current?.querySelector("button, [href], input, select, textarea") ||
      dialogRef.current;
    requestAnimationFrame(() => focusTarget?.focus?.());

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.();
        return;
      }
      // Focus trap
      if (e.key === "Tab") {
        const focusables = dialogRef.current?.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", handleKeyDown);
      // Return focus to trigger
      if (previouslyFocused.current && previouslyFocused.current.focus) {
        previouslyFocused.current.focus();
      }
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="aw-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={dialogRef}
        className="aw-shell"
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledById}
        aria-describedby={description ? describedById : undefined}
        style={{ width }}
      >
        {/* Header */}
        <header className="aw-header">
          <div className="aw-header-text">
            <div className="aw-eyebrow">{eyebrow}</div>
            <h2 id={labelledById} className="aw-title">
              {title}
            </h2>
            {description ? (
              <p id={describedById} className="aw-description">
                {description}
              </p>
            ) : null}
          </div>
          <div className="aw-header-actions">
            <kbd className="aw-kbd" aria-hidden="true">
              ESC
            </kbd>
            <button
              type="button"
              className="aw-close"
              onClick={onClose}
              aria-label="Close workspace"
            >
              ✕
            </button>
          </div>
        </header>

        {/* Stepper (hidden for single-step flows) */}
        {steps.length > 1 ? (
          <div className="aw-stepper-wrap">
            <ActionStepper steps={steps} current={currentStep} onStepClick={onStepClick} />
          </div>
        ) : null}

        {/* Body + optional diagnostics rail */}
        <div className={`aw-body${diagnostics ? " has-rail" : ""}`}>
          <div className="aw-main">{children}</div>
          {diagnostics ? <aside className="aw-rail">{diagnostics}</aside> : null}
        </div>

        {/* Sticky footer */}
        {footer ? <footer className="aw-footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
