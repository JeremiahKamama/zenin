import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * CommandPalette — Koyfin-style ⌘K launcher.
 *
 * Built on the shadcn Dialog primitive (Brand v2 monochrome) with the custom
 * keyboard navigation, filtering, and grouping preserved. The Dialog handles
 * focus-trap, scroll-lock, and Escape; we keep ↑/↓/Enter ourselves.
 *
 * Props:
 *   open            boolean   controlled visibility
 *   onClose         () => void
 *   commands        Array<{ id, label, group?, hint?, shortcut?, run, keywords? }>
 *                   where run: () => void  (call after closing the palette)
 */
export function CommandPalette({ open, onClose, commands = [] }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const hay = `${cmd.label} ${cmd.group || ""} ${cmd.keywords || ""} ${cmd.hint || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  const groups = useMemo(() => {
    const out = new Map();
    filtered.forEach((cmd) => {
      const key = cmd.group || "Commands";
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(cmd);
    });
    return Array.from(out.entries());
  }, [filtered]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      // Escape is handled by Radix Dialog's onEscapeKey; only nav keys here.
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, filtered.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const cmd = filtered[activeIndex];
        if (cmd) {
          onClose();
          setTimeout(() => cmd.run(), 0);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, filtered, activeIndex, onClose]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const node = listRef.current.querySelector(`[data-cmd-index="${activeIndex}"]`);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex, open]);

  let runningIndex = -1;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        className="max-w-xl gap-0 p-0"
        // Hide the default shadcn close X — palette has its own esc/kbd affordance.
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search sections, jump to a desk, or run an action.
        </DialogDescription>

        {/* Search row */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sections, jump to a desk, run an action…"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck="false"
            className="flex-1 bg-transparent text-[var(--fs-base)] text-[color:inherit] outline-none placeholder:text-[color:var(--color-text-muted)]"
          />
          <kbd
            className="hidden h-5 items-center rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-elevated)] px-1.5 text-[var(--fs-xs)] uppercase tracking-wide text-[color:var(--color-text-muted)] sm:inline-flex"
            aria-hidden="true"
          >
            Esc
          </kbd>
        </div>

        {/* List / empty state */}
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center text-[var(--fs-sm)] text-[color:var(--color-text-muted)]">
            No matches for “{query}”.
          </div>
        ) : (
          <ul
            ref={listRef}
            className="max-h-[360px] overflow-y-auto p-2"
            aria-label="Available commands"
          >
            {groups.map(([group, items]) => (
              <li key={group} className="mb-2">
                <div className="mb-2-label px-2 py-1.5 text-[var(--fs-xs)] uppercase tracking-wide text-[color:var(--color-text-muted)]">
                  {group}
                </div>
                <ul>
                  {items.map((cmd) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const isActive = idx === activeIndex;
                    return (
                      <li key={cmd.id}>
                        <button
                          type="button"
                          data-cmd-index={idx}
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => {
                            onClose();
                            setTimeout(() => cmd.run(), 0);
                          }}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-[var(--radius)] px-2 py-2 text-left text-[var(--fs-sm)] transition-colors",
                            isActive
                              ? "bg-[var(--color-selected)] text-[color:var(--color-text-primary)]"
                              : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                          )}
                        >
                          <span className="flex flex-col">
                            <span>{cmd.label}</span>
                            {cmd.hint && (
                              <small className="text-[var(--fs-xs)] text-[color:var(--color-text-muted)]">{cmd.hint}</small>
                            )}
                          </span>
                          {cmd.shortcut && (
                            <kbd className="shrink-0 rounded-[var(--radius)] border border-[var(--color-border-default)] bg-[var(--color-surface-elevated)] px-1.5 py-0.5 text-[var(--fs-xs)] tracking-widest text-[color:var(--color-text-muted)]">
                              {cmd.shortcut}
                            </kbd>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * useCommandPaletteLauncher — wires the global ⌘/Ctrl+K hotkey to toggle
 * an open state. Returns [open, setOpen].
 */
export function useCommandPaletteLauncher() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const handler = (event) => {
      if ((event.metaKey || event.ctrlKey) && (event.key === "k" || event.key === "K")) {
        event.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  return [open, setOpen];
}
