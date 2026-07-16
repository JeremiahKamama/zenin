import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";

/**
 * DataHealthBadge — canonical loading / stale / ok indicator.
 *
 * Consolidates the hand-rolled `<span className="status-icon spinner">⟳</span>`
 * blocks repeated across OptionsModule, Watchlist, PredictionMarketModule,
 * AssetChart, IndicatorCountryModal, etc. Uses the existing `.status-icon`
 * / `.spinner` CSS (styles.css:4638) so visual behavior is unchanged.
 *
 * status: "loading" | "stale" | "ok"
 *   loading -> ⟳ spinning
 *   stale   -> ⚠ (data is cached / degraded)
 *   ok      -> ✓
 */
const GLYPH = { loading: "⟳", refreshing: "⟳", stale: "⚠", error: "!", ok: "✓", live: "●" };
const LABEL = {
  loading: "Loading data",
  refreshing: "Refreshing data",
  stale: "Data is cached or degraded",
  error: "Data unavailable",
  ok: "Data is current",
  live: "Data is live",
};

export function DataHealthBadge({ status = "ok", className, ...props }) {
  const spinning = status === "loading";
  return (
    <span
      className={cn("status-icon", spinning && "spinner", className)}
      role="img"
      aria-label={LABEL[status] || LABEL.ok}
      title={LABEL[status] || LABEL.ok}
      {...props}
    >
      {GLYPH[status] || GLYPH.ok}
    </span>
  );
}

/**
 * AsyncState — single vocabulary for the five data states.
 *
 * loading    -> Skeleton (or `loading` node)
 * refreshing -> children with a secondary status strip when provided
 * stale      -> children with a secondary status strip when provided
 * error      -> message + Retry (recovery)
 * empty      -> EmptyState (or `empty` node)
 * ready      -> children
 *
 * This is the standard container for any async surface. Replace ad-hoc
 * `if (loading) return <Spinner/>` / `if (error) return <div>...` chains with
 * one <AsyncState status=...>. Monochrome, token-driven, Brand v2.
 */
export function AsyncState({
  status, // "loading" | "refreshing" | "stale" | "error" | "empty" | "ready"
  error,
  onRetry,
  retryLabel = "Retry",
  stateTitle,
  stateDescription,
  stale,
  refreshing,
  loading,
  empty,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  emptySecondary,
  className,
  children,
  ...props
}) {
  if (status === "loading") {
    return <>{loading ?? <Skeleton className={cn("w-full h-24", className)} />}</>;
  }
  if (status === "error") {
    return (
      <div
        role="alert"
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-medium)] bg-[var(--color-surface-card)] p-[var(--space-8)] text-center",
          className
        )}
        {...props}
      >
        {stateTitle ? (
          <strong className="text-[var(--fs-lg)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]">
            {stateTitle}
          </strong>
        ) : null}
        <p className="max-w-[42ch] text-[var(--fs-body)] text-[var(--color-text-secondary)]">
          {typeof error === "string" ? error : stateDescription || "Something went wrong while loading this data."}
        </p>
        {onRetry ? (
          <button type="button" className={cn(buttonVariants({ variant: "secondary" }))} onClick={onRetry}>
            {retryLabel}
          </button>
        ) : null}
      </div>
    );
  }
  if (status === "empty") {
    if (empty) return <>{empty}</>;
    return (
      <EmptyState
        icon={emptyIcon}
        title={emptyTitle}
        description={emptyDescription}
        action={emptyAction}
        secondary={emptySecondary}
        className={className}
        {...props}
      />
    );
  }
  if ((status === "stale" || status === "refreshing") && (stale || refreshing)) {
    return (
      <>
        {status === "refreshing" ? refreshing : stale}
        {children}
      </>
    );
  }
  return <>{children}</>;
}

export function normalizeFreshnessStatus({
  updatedAt,
  generatedAt,
  stale = false,
  refreshing = false,
  sourceLabel = "",
  nextAction = "",
  maxFreshMinutes = 15,
} = {}) {
  const timestamp = updatedAt || generatedAt || "";
  const parsed = timestamp ? new Date(timestamp) : null;
  const ageMs = parsed && !Number.isNaN(parsed.getTime()) ? Date.now() - parsed.getTime() : null;
  const ageMinutes = ageMs == null ? null : Math.max(0, Math.round(ageMs / 60000));
  const ageLabel =
    ageMinutes == null
      ? "Data age unknown"
      : ageMinutes < 1
        ? "Updated just now"
        : ageMinutes < 60
          ? `Updated ${ageMinutes}m ago`
          : ageMinutes < 1440
            ? `Updated ${Math.round(ageMinutes / 60)}h ago`
            : `Updated ${Math.round(ageMinutes / 1440)}d ago`;
  const isStale = Boolean(stale || (ageMinutes != null && ageMinutes > maxFreshMinutes));
  return {
    generatedAt: generatedAt || timestamp || "",
    updatedAt: updatedAt || timestamp || "",
    dataAgeLabel: ageLabel,
    freshnessTone: refreshing ? "refreshing" : isStale ? "stale" : "ok",
    sourceLabel,
    isStale,
    isRefreshing: Boolean(refreshing),
    nextAction,
  };
}

export function DataFreshnessSummary({
  generatedAt,
  updatedAt,
  dataAgeLabel,
  freshnessTone = "ok",
  sourceLabel,
  nextAction,
  className,
}) {
  const status = freshnessTone === "refreshing" ? "refreshing" : freshnessTone === "stale" ? "stale" : "ok";
  const generatedLabel = generatedAt ? new Date(generatedAt).toLocaleString() : "";
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString() : "";
  return (
    <div className={cn("data-freshness-summary", `data-freshness-summary--${status}`, className)} role="status" aria-live="polite">
      <DataHealthBadge status={status} />
      <span>{dataAgeLabel || (updatedLabel ? `Updated ${updatedLabel}` : "Freshness unknown")}</span>
      {generatedLabel ? <span>Generated {generatedLabel}</span> : null}
      {sourceLabel ? <span>Source: {sourceLabel}</span> : null}
      {nextAction ? <strong>{nextAction}</strong> : null}
    </div>
  );
}

export function ResponsiveActionBar({ primary, secondary, overflow, className, ...props }) {
  return (
    <div className={cn("responsive-action-bar", className)} {...props}>
      {primary ? <div className="responsive-action-bar__primary">{primary}</div> : null}
      {secondary ? <div className="responsive-action-bar__secondary">{secondary}</div> : null}
      {overflow ? <div className="responsive-action-bar__overflow">{overflow}</div> : null}
    </div>
  );
}

export function PasswordRequirementsList({ value = "", confirmValue = "", includeMatch = false, className }) {
  const password = String(value || "");
  const rules = [
    { key: "length", label: "At least 10 characters", ok: password.length >= 10 },
    { key: "lower", label: "Lowercase letter", ok: /[a-z]/.test(password) },
    { key: "upper", label: "Uppercase letter", ok: /[A-Z]/.test(password) },
    { key: "number", label: "Number", ok: /\d/.test(password) },
    { key: "symbol", label: "Symbol", ok: /[^A-Za-z0-9]/.test(password) },
  ];
  if (includeMatch) {
    rules.push({ key: "match", label: "Passwords match", ok: Boolean(password) && password === String(confirmValue || "") });
  }
  return (
    <ul className={cn("password-requirements-list", className)} aria-label="Password requirements" aria-live="polite">
      {rules.map((rule) => (
        <li key={rule.key} data-state={rule.ok ? "met" : "unmet"}>
          <span aria-hidden="true">{rule.ok ? "✓" : "○"}</span>
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

export default DataHealthBadge;
