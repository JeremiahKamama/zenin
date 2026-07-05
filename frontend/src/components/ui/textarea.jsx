import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "flex min-h-[80px] w-full rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-depth)] px-3 py-2 text-[var(--fs-base)] text-[color:inherit]",
      "placeholder:text-[color:var(--color-text-muted)]",
      "focus-visible:outline-none focus-visible:border-[var(--color-focus)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";

export { Textarea };
