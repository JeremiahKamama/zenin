import * as React from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SortableHeader — Zenin Brand v2 sortable table-column header.
 *
 * Renders the column label plus a direction cue:
 *   - ChevronUp / ChevronDown (active sort on this column, matching direction)
 *   - ChevronsUpDown (inactive — dimmed)
 *
 * Color & typography pull the EXISTING table-header tokens (no new colors):
 *   - active label:  var(--color-text-primary)   (#FFFFFF)
 *   - inactive label: var(--color-text-dim)      (the .portfolio-command-table thead th token)
 * The icon opacity mirrors DataTable's existing SortIcon convention (inactive = opacity-40).
 *
 * Pass `active` + `direction` to reflect external sort state, or let the
 * column's own `sortable` flag drive DataTable's internal `SortIcon` instead.
 */
export function SortableHeader({
  label,
  active = false,
  direction = "desc",
  onClick,
  className,
  iconClassName,
  align = "left",
}) {
  const labelClass = active
    ? "text-[var(--color-text-primary)]"
    : "text-[color:var(--color-text-dim)]";
  // `direction` of null/undefined (unsorted) collapses to inactive so the
  // dimmed ChevronsUpDown renders instead of a stale up/down chevron.
  const isSorted = active && direction !== null && direction !== undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      // Strip native <button> chrome (border/bg/padding) that the global
      // `* { border-color: var(--color-border-default) }` + UA stylesheet
      // otherwise surface as a visible box on header cells. Non-sortable
      // <th> cells have no <button> so they stay borderless by default.
      style={{ border: "none", background: "transparent", padding: 0, margin: 0 }}
      className={cn(
        "inline-flex items-center gap-1 font-weight-800 uppercase tracking-[0.14em]",
        "whitespace-nowrap",
        "border-none bg-transparent",
        "text-[var(--fs-xs)]",
        `text-${align}`,
        "transition-opacity",
        active ? "opacity-100" : "opacity-60 hover:opacity-80",
        "focus-visible:outline-none focus-visible:text-[var(--color-text-primary)]",
        "cursor-pointer select-none",
        className
      )}
      aria-sort={isSorted ? `${direction === "asc" ? "ascending" : "descending"}` : "none"}
    >
      <span className={cn(labelClass, "whitespace-nowrap")}>{label}</span>
      <span className="inline-flex items-center" aria-hidden="true">
        {isSorted ? (
          direction === "asc" ? (
            <ChevronUp className={cn("h-3 w-3", iconClassName)} />
          ) : (
            <ChevronDown className={cn("h-3 w-3", iconClassName)} />
          )
        ) : (
          <ChevronsUpDown className={cn("h-3 w-3 opacity-40", iconClassName)} />
        )}
      </span>
    </button>
  );
}

export default SortableHeader;
