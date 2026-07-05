import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * cn — merge conditional class names with Tailwind-aware de-duplication.
 *
 * Use wherever a shadcn component or Zenin wrapper composes Tailwind
 * utilities with conditional variants:
 *
 *   <button className={cn("px-4 py-2", isPrimary && "bg-primary", className)} />
 *
 * twMerge resolves conflicting Tailwind utilities (last-wins) so consumer
 * overrides via `className` always take precedence.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
