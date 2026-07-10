import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Toast — the SINGLE notification primitive for Zenin (Phase 3 + 6).
 *
 * Replaces 4 competing ad-hoc systems:
 *   • JournalModule.notify / <JournalToast>
 *   • HomeModule.homeToast / home-v3-toast
 *   • App.jsx tradeToast / showTradeToast
 *   • OptionsStrategySimulator.showToast (prop-drilled)
 *
 * Usage (anywhere in the app):
 *   const { toast } = useToast();
 *   toast({ title: "Saved", description: "Review snapshot stored.", variant: "success" });
 *
 * Then mount <Toaster /> once, near the app root.
 *
 * Design: token-driven, z-index via --z-toast (always above modals),
 * respects reduced-motion (fade only, no slide), ARIA live region.
 */

const ToastContext = React.createContext(null);

const TOAST_DURATION_MS = 3200;

function toastReducer(state, action) {
  switch (action.type) {
    case "ADD":
      return { ...state, toasts: [...state.toasts, action.toast] };
    case "DISMISS":
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) };
    case "CLEAR":
      return { ...state, toasts: [] };
    default:
      return state;
  }
}

export function ToastProvider({ children }) {
  const [state, dispatch] = React.useReducer(toastReducer, { toasts: [] });
  const timers = React.useRef(new Map());

  const dismiss = React.useCallback((id) => {
    dispatch({ type: "DISMISS", id });
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = React.useCallback(
    ({ title, description, variant = "info", duration = TOAST_DURATION_MS }) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const entry = { id, title, description, variant };
      dispatch({ type: "ADD", toast: entry });
      if (duration > 0) {
        const timer = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, timer);
      }
      return id;
    },
    [dismiss]
  );

  React.useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  const value = React.useMemo(() => ({ toast, dismiss, toasts: state.toasts }), [toast, dismiss, state.toasts]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Graceful no-op if a module renders outside the provider during migration.
    // This lets components adopt useToast incrementally without a hard cutover.
    return {
      toast: () => {
        if (typeof console !== "undefined") console.warn("useToast called outside <ToastProvider> — toast dropped.");
      },
      dismiss: () => {},
      toasts: [],
    };
  }
  return ctx;
}

const toastVariants = {
  info: "border-[var(--color-border-default)] bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)]",
  success:
    "border-[var(--color-success)]/40 bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] [&_.toast-dot]:bg-[var(--color-success)]",
  danger:
    "border-[var(--color-danger)]/40 bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] [&_.toast-dot]:bg-[var(--color-danger)]",
  warning:
    "border-[var(--color-warning)]/40 bg-[var(--color-surface-elevated)] text-[var(--color-text-primary)] [&_.toast-dot]:bg-[var(--color-warning)]",
};

function ToastItem({ toast, onDismiss }) {
  return (
    <div
      role={toast.variant === "danger" ? "alert" : "status"}
      aria-live="polite"
      className={cn(
        "pointer-events-auto flex w-full items-start gap-[var(--space-2)] rounded-[var(--radius-md)] border p-[var(--space-3)] shadow-[var(--shadow-2)]",
        "animate-[toast-in_var(--duration-base)_var(--ease-out)]",
        toastVariants[toast.variant] || toastVariants.info
      )}
    >
      <span className="toast-dot mt-[var(--space-1)] h-[var(--space-2)] w-[var(--space-2)] shrink-0 rounded-[var(--radius-full)] bg-[var(--color-text-muted)]" aria-hidden="true" />
      <div className="flex-1 min-w-0">
        {toast.title ? (
          <p className="text-[var(--fs-body)] font-[var(--fw-semibold)] leading-tight">{toast.title}</p>
        ) : null}
        {toast.description ? (
          <p className="text-[var(--fs-sm)] text-[var(--color-text-secondary)]">{toast.description}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="shrink-0 rounded-[var(--radius-sm)] p-[var(--space-1)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="size-3.5" aria-hidden="true">
          <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/**
 * <Toaster /> — mount ONCE near the app root. Renders the toast stack.
 * Fixed bottom-right, z-index from --z-toast token (above modals).
 */
export function Toaster() {
  const { toasts, dismiss } = useToast();
  if (!toasts.length) return null;
  return (
    <div
      className="pointer-events-none fixed bottom-[var(--space-5)] right-[var(--space-5)] z-[var(--z-toast)] flex w-[calc(100vw-var(--space-10))] max-w-[380px] flex-col gap-[var(--space-2)]"
      aria-label="Notifications"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={dismiss} />
      ))}
    </div>
  );
}
