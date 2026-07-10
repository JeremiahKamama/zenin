import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * MetricCard — the canonical financial stat card (Phase 3 + Phase 5).
 *
 * Replaces 12 distinct ad-hoc "big number in a card" treatments. This is
 * the ONE way to render a metric value. Numerics use the mono stack +
 * tabular figures (`.numeric`) so decimals align across the dashboard.
 *
 *   <MetricCard
 *     label="Realized P&L"
 *     value={12834.5}
 *     format="currency"
 *     delta="+12.4%"
 *     deltaTone="positive"
 *   />
 *
 * Variant `ghost` drops the border/shadow for inline use inside panels.
 */
const metricCardVariants = cva(
  "flex flex-col gap-[var(--space-1)] rounded-[var(--radius-md)] p-[var(--card-padding-standard)]",
  {
    variants: {
      variant: {
        card: "border border-[var(--color-border-default)] bg-[var(--color-surface-card)] shadow-[var(--shadow-1)]",
        ghost: "bg-transparent",
        elevated: "border border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]",
      },
    },
    defaultVariants: { variant: "card" },
  }
);

const deltaToneClass = {
  positive: "text-[var(--color-success)]",
  negative: "text-[var(--color-danger)]",
  neutral: "text-[var(--color-text-muted)]",
  warning: "text-[var(--color-warning)]",
};

const MetricCard = React.forwardRef(
  ({ className, variant, label, value, valueClassName, hint, delta, deltaTone = "neutral", children, ...props }, ref) => (
    <div ref={ref} className={cn(metricCardVariants({ variant }), className)} {...props}>
      {label ? (
        <span className="text-[var(--fs-xs)] uppercase tracking-[0.08em] text-[var(--color-text-muted)]">
          {label}
        </span>
      ) : null}
      {value != null ? (
        <span
          className={cn(
            "numeric text-[var(--fs-2xl)] font-[var(--fw-semibold)] leading-tight text-[var(--color-text-primary)]",
            valueClassName
          )}
        >
          {value}
        </span>
      ) : null}
      {children}
      {delta ? (
        <span className={cn("text-[var(--fs-sm)] font-[var(--fw-medium)]", deltaToneClass[deltaTone] || deltaToneClass.neutral)}>
          {delta}
        </span>
      ) : null}
      {hint ? (
        <span className="text-[var(--fs-xs)] text-[var(--color-text-muted)]">{hint}</span>
      ) : null}
    </div>
  )
);
MetricCard.displayName = "MetricCard";

export { MetricCard, metricCardVariants };
