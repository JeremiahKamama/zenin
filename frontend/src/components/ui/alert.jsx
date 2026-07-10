import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Alert — inline contextual message (Phase 3).
 *
 * For errors, warnings, confirmations, and info that lives IN the page
 * (not a transient toast). Distinct from Toast (ephemeral) and Dialog
 * (blocking). Use `role="alert"` for errors (auto-announced).
 *
 *   <Alert variant="danger" title="Couldn't load">
 *     Backend unreachable — showing cached data from 2m ago.
 *   </Alert>
 */
const alertVariants = cva(
  "relative w-full rounded-[var(--radius-md)] border p-[var(--space-3)] text-[var(--fs-body)] [&>svg]:absolute [&>svg]:left-[var(--space-3)] [&>svg]:top-[var(--space-3)] [&>svg]:size-4 [&>svg]:text-current [&>svg~*]:pl-7",
  {
    variants: {
      variant: {
        info: "border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] text-[var(--color-text-secondary)]",
        success:
          "border-[var(--color-success)]/30 bg-[var(--color-success-soft)] text-[var(--color-text-primary)]",
        warning:
          "border-[var(--color-warning)]/30 bg-[var(--color-warning-soft)] text-[var(--color-text-primary)]",
        danger:
          "border-[var(--color-danger)]/30 bg-[var(--color-danger-soft)] text-[var(--color-text-primary)]",
      },
    },
    defaultVariants: { variant: "info" },
  }
);

const Alert = React.forwardRef(({ className, variant, ...props }, ref) => (
  <div ref={ref} role={variant === "danger" ? "alert" : "status"} className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={cn("mb-[var(--space-1)] font-[var(--fw-semibold)] leading-none text-[var(--color-text-primary)]", className)}
    {...props}
  />
));
AlertTitle.displayName = "AlertTitle";

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("text-[var(--fs-sm)] text-[var(--color-text-secondary)]", className)} {...props} />
));
AlertDescription.displayName = "AlertDescription";

export { Alert, AlertTitle, AlertDescription };
