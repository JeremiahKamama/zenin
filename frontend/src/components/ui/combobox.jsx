import * as React from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/**
 * Combobox — searchable single-select (Phase 3 forms: Jurisdiction, ticker,
 * instrument picker). Replaces native <select> which cannot be searched and
 * was a recurring drift source (e.g. Tax Estimator country dropdown).
 *
 * Keyboard: open with Enter/Space/ArrowDown, type to filter, ArrowUp/Down to
 * move, Enter to choose, Esc to close. Tokens only.
 *
 * @param {Array<{value:string,label:string,keywords?:string}>} options
 * @param {string} value - selected value (controlled) or undefined (uncontrolled)
 * @param {function} onValueChange
 * @param {string} placeholder
 * @param {function} filter - (option, query) => boolean (defaults to label/keywords includes)
 */
export function Combobox({
  options = [],
  value,
  defaultValue,
  onValueChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches",
  className,
  disabled = false,
  filter,
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? "");
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputRef = React.useRef(null);
  const listRef = React.useRef(null);

  const current = value != null ? value : internal;
  const selected = options.find((o) => o.value === current);

  const matches = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) =>
      filter
        ? filter(o, q)
        : `${o.label} ${o.keywords || ""} ${o.value}`.toLowerCase().includes(q)
    );
  }, [options, query, filter]);

  React.useEffect(() => {
    setActive(0);
  }, [query, open]);

  const choose = (v) => {
    if (value == null) setInternal(v);
    onValueChange?.(v);
    setOpen(false);
    setQuery("");
  };

  const onTriggerKeyDown = (e) => {
    if (disabled) return;
    if (["Enter", " ", "ArrowDown"].includes(e.key) && !open) {
      e.preventDefault();
      setOpen(true);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  };

  const onInputKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(matches.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const opt = matches[active];
      if (opt) choose(opt.value);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  React.useEffect(() => {
    if (open && active >= matches.length) setActive(0);
  }, [matches.length, active, open]);

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-haspopup="listbox"
          disabled={disabled}
          onClick={() => !open && requestAnimationFrame(() => inputRef.current?.focus())}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            "flex h-[var(--control-height-md)] w-full items-center justify-between gap-2 rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-depth)] px-3 py-2 text-[var(--fs-base)] text-[color:inherit]",
            "focus-visible:outline-none focus-visible:border-[var(--color-focus)] focus-visible:ring-2 focus-visible:ring-[var(--color-focus)]",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className
          )}
        >
          <span className={cn("truncate", !selected && "text-[color:var(--color-text-muted)]")}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[12rem] p-0"
        align="start"
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border-subtle)] px-3">
          <Search className="h-4 w-4 shrink-0 text-[color:var(--color-text-muted)]" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            className="h-9 w-full bg-transparent text-[var(--fs-base)] text-[color:inherit] outline-none placeholder:text-[color:var(--color-text-muted)]"
          />
        </div>
        <ul ref={listRef} role="listbox" className="max-h-60 overflow-auto p-1">
          {matches.length === 0 ? (
            <li className="px-2 py-3 text-center text-[var(--fs-sm)] text-[color:var(--color-text-muted)]">
              {emptyText}
            </li>
          ) : (
            matches.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === current}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.value)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded-[var(--radius)] px-2 py-1.5 text-[var(--fs-sm)]",
                  i === active ? "bg-[var(--color-surface-hover)]" : "",
                  o.value === current ? "text-[color:inherit]" : "text-[color:var(--color-text-secondary)]"
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.value === current && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
