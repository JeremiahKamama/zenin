import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Input — Brand v2 monochrome.
 * Inherits font/colour from the surface; the focus ring is white.
 */
const Input = React.forwardRef(({ className, type = "text", ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      "flex h-[var(--control-height-md)] w-full rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-depth)] px-3 py-1 text-[var(--fs-base)] text-[color:inherit] transition-[border,box-shadow] duration-150",
      "placeholder:text-[color:var(--color-text-muted)]",
      "focus-visible:outline-none focus-visible:border-[var(--color-focus)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "file:border-0 file:bg-transparent file:text-sm file:font-medium",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
