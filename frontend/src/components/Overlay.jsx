// Overlay — shared accessible modal/drawer shell (Brandv2 §8, spec §5).
// Wraps an existing dialog body so we keep ONE focus-trap/a11y implementation.
// The caller still owns layout + content; Overlay provides:
//   - scrim (click-outside) that does NOT dismiss destructive confirmations
//   - Escape-to-close (disabled for destructive confirmations)
//   - focus trap + restore via useFocusTrap
//   - aria wiring passed through to the inner container
//
// variant: "center" (dialog) | "right" (drawer)

import React from "react";
import { useFocusTrap } from "../hooks/useFocusTrap";

export function Overlay({
  open,
  onClose,
  children,
  variant = "center",
  dismissable = true,
  dismissOnEscape = true,
  className = "",
  labelledBy,
  ariaLabel,
  containerRef,
}) {
  const ref = useFocusTrap({ open, onClose: dismissable ? onClose : undefined, dismissOnEscape: dismissable && dismissOnEscape, containerRef });

  if (!open) return null;

  return (
    <div className={`zentin-overlay zentin-overlay--${variant} ${className}`}>
      <div
        className="zentin-overlay__scrim"
        data-dismiss={dismissable ? "true" : "false"}
        onClick={dismissable ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={ref}
        className="zentin-overlay__surface"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={labelledBy}
      >
        {children}
      </div>
    </div>
  );
}

export default Overlay;
