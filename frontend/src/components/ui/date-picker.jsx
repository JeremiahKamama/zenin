import * as React from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * DatePicker — shared date input (Phase 3 forms). Accessible calendar with
 * keyboard navigation. Tokens only. Native fall-back input type="date" is
 * avoided because it cannot be themed to the monochrome system.
 *
 * @param {string} value - ISO yyyy-mm-dd (controlled) or undefined
 * @param {function} onValueChange - (isoString) => void
 */
export function DatePicker({ value, defaultValue, onValueChange, placeholder = "Select date", className, disabled = false }) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const current = value != null ? value : internal;
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState(() => {
    const d = current ? new Date(`${current}T00:00:00`) : new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });

  const parsed = current ? new Date(`${current}T00:00:00`) : null;
  const set = (iso) => {
    if (value == null) setInternal(iso);
    onValueChange?.(iso);
    setOpen(false);
  };

  const firstDay = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const monthName = new Date(view.year, view.month, 1).toLocaleString("en-US", { month: "long" });

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const shiftMonth = (delta) => {
    setView((v) => {
      const m = v.month + delta;
      const year = v.year + Math.floor(m / 12);
      const month = ((m % 12) + 12) % 12;
      return { year, month };
    });
  };

  const onGridKeyDown = (e) => {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      const base = parsed ? parsed.getDate() : 1;
      const target = new Date(view.year, view.month, Math.min(daysInMonth, Math.max(1, base + delta)));
      setView({ year: target.getFullYear(), month: target.getMonth() });
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-expanded={open}
          className={cn(
            "flex h-[var(--control-height-md)] w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-depth)] px-3 py-2 text-[var(--fs-base)] text-[color:inherit]",
            "focus-visible:outline-none focus-visible:border-[var(--color-focus)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn(!current && "text-[color:var(--color-text-muted)]")}>
            {current || placeholder}
          </span>
          <Calendar className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-[var(--space-3)]" align="start">
        <div className="mb-[var(--space-2)] flex items-center justify-between">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => shiftMonth(-1)}
            className="rounded-[var(--radius)] px-2 py-1 text-[var(--fs-sm)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            ‹
          </button>
          <div className="text-[var(--fs-sm)] font-[var(--fw-semibold)]" aria-live="polite">
            {monthName} {view.year}
          </div>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => shiftMonth(1)}
            className="rounded-[var(--radius)] px-2 py-1 text-[var(--fs-sm)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]"
          >
            ›
          </button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center text-[var(--fs-xs)] text-[color:var(--color-text-muted)]" role="presentation">
          {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
            <div key={i} className="py-1" aria-hidden="true">{d}</div>
          ))}
        </div>
        <div
          role="grid"
          aria-label="Calendar"
          onKeyDown={onGridKeyDown}
          className="grid grid-cols-7 gap-0.5"
        >
          {cells.map((d, i) => {
            if (d == null) return <div key={`e${i}`} />;
            const iso = `${view.year}-${String(view.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
            const isSel = iso === current;
            return (
              <button
                key={iso}
                type="button"
                role="gridcell"
                aria-selected={isSel}
                aria-label={iso}
                onClick={() => set(iso)}
                className={cn(
                  "h-8 w-8 rounded-[var(--radius)] text-[var(--fs-sm)] transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus)]",
                  isSel
                    ? "bg-[var(--color-interactive)] font-[var(--fw-semibold)] text-[var(--color-text-inverse)]"
                    : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                )}
              >
                {d}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
