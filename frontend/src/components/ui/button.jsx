import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Button — Brand System v2 monochrome.
 *
 * Exactly five variants. No gradient, no branded variant.
 * Sizes map to Zenin control-height tokens (34 / 40px).
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius)] text-sm font-medium transition-[background,color,opacity,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[var(--color-interactive-hover)]",
        // White fill on dark / near-black on light. The institutional default.
        primary:
          "bg-primary text-primary-foreground hover:bg-[var(--color-interactive-hover)]",
        // Elevated surface with primary text — recedes, still legible.
        secondary:
          "bg-secondary text-secondary-foreground border border-[var(--color-border-default)] hover:bg-[var(--color-surface-hover)]",
        // Utility actions: refresh, export, save-view, filters, and other
        // supporting workflow actions. Quiet by default; only surface-hover on hover.
        tertiary:
          "bg-transparent text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[color:var(--color-text-primary)]",
        // Transparent until hovered. Motion (opacity / surface) is the feedback.
        ghost:
          "bg-transparent text-[color:inherit] hover:bg-[var(--color-surface-hover)]",
        // Semantic — destructive only.
        destructive:
          "bg-destructive text-destructive-foreground hover:opacity-90",
        // Semantic — success / completed action.
        success:
          "bg-success text-success-foreground hover:opacity-90",
        // Ghost variant kept for outline parity in shadcn consumers.
        outline:
          "border border-[var(--color-border-strong)] bg-transparent text-[color:inherit] hover:bg-[var(--color-surface-hover)]",
        link:
          "text-[color:inherit] underline-offset-4 hover:underline p-0 h-auto",
      },
      size: {
        sm: "h-[var(--control-height-sm)] px-3 text-[var(--fs-body)]",
        md: "h-[var(--control-height-md)] px-4 text-[var(--fs-base)]",
        lg: "h-[var(--control-height-md)] px-6 text-[var(--fs-md)]",
        icon: "h-[var(--control-height-standard)] w-[var(--control-height-standard)] min-h-[var(--control-height-standard)] min-w-[var(--control-height-standard)] p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  }
);

const Button = React.forwardRef(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
