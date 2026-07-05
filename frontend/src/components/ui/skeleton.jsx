import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Skeleton — Brand v2. Pulse between surface tokens. No gradient sheen,
 * no shimmer sweep. Motion is the only feedback.
 */
function Skeleton({ className, ...props }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[var(--radius)] bg-[var(--color-surface-elevated)]",
        className
      )}
      {...props}
    />
  );
}

export { Skeleton };
