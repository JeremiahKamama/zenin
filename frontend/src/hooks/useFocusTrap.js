// useFocusTrap — shared keyboard-complete modal/drawer behavior (Brandv2 §8, spec §5).
// Used by every Home/Portfolio overlay so we don't maintain N independent traps.
//
// Behavior:
//  - Move focus to the dialog heading or first meaningful control on open.
//  - Trap Tab / Shift+Tab inside the active overlay.
//  - Close on Escape (unless the overlay is marked non-dismissable, e.g. a
//    destructive confirmation that must be answered explicitly).
//  - Restore focus to the trigger that opened it.
//  - Prevent background interaction (caller renders a scrim).
//
// Returns a ref to attach to the overlay container.

import { useEffect, useRef } from "react";

const FOCUSABLE = [
  "a[href]", "button:not([disabled])", "textarea:not([disabled])",
  "input:not([disabled])", "select:not([disabled])", "[tabindex]:not([tabindex='-1'])",
].join(",");

export function useFocusTrap({
  open,
  onClose,
  dismissOnEscape = true,
  restoreFocus = true,
  containerRef: externalRef,
} = {}) {
  const internalRef = useRef(null);
  const ref = externalRef || internalRef;
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const container = ref.current;
    if (!container) return undefined;

    previouslyFocused.current = document.activeElement;

    // Focus the heading first, else the first focusable control.
    const heading = container.querySelector("h1, h2, h3, [data-autofocus]");
    const focusables = () => Array.from(container.querySelectorAll(FOCUSABLE))
      .filter((el) => el.offsetParent !== null || el === document.activeElement);
    const target = heading || focusables()[0];
    if (target) {
      // Defer one frame so portals/animations settle.
      requestAnimationFrame(() => target.focus({ preventScroll: true }));
    }

    const onKeyDown = (event) => {
      if (event.key === "Escape" && dismissOnEscape) {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // lock background scroll

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      if (restoreFocus && previouslyFocused.current && document.contains(previouslyFocused.current)) {
        previouslyFocused.current.focus?.({ preventScroll: true });
      }
    };
  }, [open, onClose, dismissOnEscape, restoreFocus, ref]);

  return ref;
}

export default useFocusTrap;
