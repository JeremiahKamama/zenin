import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * EmptyState — canonical empty/zero-data surface (Phase 3).
 *
 * Replaces the 40+ bespoke empty-state classes across modules. Use this
 * instead of inventing `<div className="my-module-empty">`.
 *
 * Structure (per design-system plan):
 *   <EmptyState
 *     icon={<Inbox />}
 *     title="No decisions yet"
 *     description="Record your first trade to start the decision loop."
 *     action={<Button>Record decision</Button>}
 *     secondary={<Button variant="ghost">Import</Button>}
 *   />
 */
const EmptyState = React.forwardRef(
  ({ className, icon, title, description, action, secondary, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-[var(--space-8)] text-center",
        className
      )}
      {...props}
    >
      {icon ? (
        <div
          className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-full)] bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      {title ? (
        <h3 className="text-[var(--fs-md)] font-[var(--fw-semibold)] text-[var(--color-text-primary)]">
          {title}
        </h3>
      ) : null}
      {description ? (
        <p className="max-w-[42ch] text-[var(--fs-body)] text-[var(--color-text-secondary)]">
          {description}
        </p>
      ) : null}
      {action || secondary ? (
        <div className="mt-[var(--space-1)] flex flex-wrap items-center justify-center gap-[var(--space-2)]">
          {action}
          {secondary}
        </div>
      ) : null}
    </div>
  )
);
EmptyState.displayName = "EmptyState";

export { EmptyState };
