import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Badge — Brand v2. Hierarchy comes from contrast, not decoration.
 * Semantic variants (success/destructive/warning) carry meaning only.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-[var(--radius)] border px-2 py-0.5 text-[var(--fs-xs)] font-medium uppercase tracking-wide transition-colors",
  {
    variants: {
      variant: {
        default:
          "border-[var(--color-border-default)] bg-transparent text-[color:var(--color-text-secondary)]",
        // Solid neutral — emphasis without color.
        solid:
          "border-transparent bg-[var(--color-interactive-soft)] text-[color:inherit]",
        success:
          "border-transparent bg-[var(--color-success-soft)] text-[color:var(--color-success)]",
        destructive:
          "border-transparent bg-[var(--color-danger-soft)] text-[color:var(--color-danger)]",
        warning:
          "border-transparent bg-[var(--color-warning-soft)] text-[color:var(--color-warning)]",
        outline:
          "border-[var(--color-border-strong)] text-[color:var(--color-text-secondary)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

function Badge({ className, variant, ...props }) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
