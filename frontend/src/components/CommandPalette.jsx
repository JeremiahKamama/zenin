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
 * Built on the shadcn Dialog primitive (Brand v3 monochrome) with custom
 * keyboard navigation, filtering, and grouping preserved. The Dialog handles
 * focus-trap, scroll-lock, and Escape; we keep ↑/↓/Enter ourselves.
 *
 * Props:
 *   open            boolean   controlled visibility
 *   onClose         () => void
 *   commands        Array<{ id, label, group?, hint?, shortcut?, run, keywords? }>
 *   assetSearch     (q: string) => Promise<Asset[]> | Asset[]   global asset search
 *   onSelectAsset   (asset) => void                            select an asset result
 *
 * Asset result shape: { symbol, name, kind, assetClass, exchange, category, provider, coverage, confidence }
 */
export function CommandPalette({ open, onClose, commands = [], assetSearch, onSelectAsset }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [assetResults, setAssetResults] = useState([]);
  const [assetLoading, setAssetLoading] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  // Command filtering (unchanged behaviour).
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((cmd) => {
      const hay = `${cmd.label} ${cmd.group || ""} ${cmd.keywords || ""} ${cmd.hint || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [commands, query]);

  // Async asset search (commodities / companies / ETFs / currencies / indices / countries).
  useEffect(() => {
    let cancelled = false;
    const q = query.trim();
    if (!q || !assetSearch) {
      setAssetResults([]);
      return undefined;
    }
    setAssetLoading(true);
    Promise.resolve(assetSearch(q)).then((res) => {
      if (cancelled) return;
      setAssetResults(Array.isArray(res) ? res : []);
      setAssetLoading(false);
    }).catch(() => {
      if (!cancelled) { setAssetResults([]); setAssetLoading(false); }
    });
    return () => { cancelled = true; };
  }, [query, assetSearch]);

  const groups = useMemo(() => {
    const out = new Map();
    filtered.forEach((cmd) => {
      const key = cmd.group || "Commands";
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(cmd);
    });
    return Array.from(out.entries());
  }, [filtered]);

  // Unified, flattened result list = command results + asset results, for keyboard nav.
  const flatItems = useMemo(() => {
    const cmds = filtered.map((c) => ({ type: "command", data: c }));
    const assets = assetResults.map((a) => ({ type: "asset", data: a }));
    return [...cmds, ...assets];
  }, [filtered, assetResults]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    setAssetResults([]);
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= flatItems.length) setActiveIndex(0);
  }, [flatItems.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((prev) => Math.min(prev + 1, flatItems.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = flatItems[activeIndex];
        if (!item) return;
        if (item.type === "command") {
          onClose();
          setTimeout(() => item.data.run(), 0);
        } else if (item.type === "asset" && onSelectAsset) {
          onClose();
          setTimeout(() => onSelectAsset(item.data), 0);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, flatItems, activeIndex, onClose, onSelectAsset]);

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
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search sections, assets, or run an action.
        </DialogDescription>

        {/* Search row */}
        <div className="flex items-center gap-3 border-b border-[var(--color-border-default)] px-4 py-3">
          <Search className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sections, assets, desks…"
            aria-label="Search commands and assets"
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
        {query.trim() && flatItems.length === 0 && !assetLoading ? (
          <div className="px-4 py-8 text-center text-[var(--fs-sm)] text-[color:var(--color-text-muted)]">
            No matches for “{query}”.
          </div>
        ) : (
          <ul
            ref={listRef}
            className="max-h-[360px] overflow-y-auto p-2"
            aria-label="Available commands and assets"
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
                          onClick={() => { onClose(); setTimeout(() => cmd.run(), 0); }}
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

            {assetResults.length > 0 && (
              <li className="mb-2">
                <div className="mb-2-label px-2 py-1.5 text-[var(--fs-xs)] uppercase tracking-wide text-[color:var(--color-text-muted)]">
                  Assets
                </div>
                <ul>
                  {assetResults.map((asset) => {
                    runningIndex += 1;
                    const idx = runningIndex;
                    const isActive = idx === activeIndex;
                    return (
                      <li key={`asset-${asset.symbol}-${asset.kind}`}>
                        <button
                          type="button"
                          data-cmd-index={idx}
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => { onClose(); setTimeout(() => onSelectAsset?.(asset), 0); }}
                          className={cn(
                            "flex w-full items-center justify-between gap-3 rounded-[var(--radius)] px-2 py-2 text-left text-[var(--fs-sm)] transition-colors",
                            isActive
                              ? "bg-[var(--color-selected)] text-[color:var(--color-text-primary)]"
                              : "text-[color:var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
                          )}
                        >
                          <span className="flex flex-col">
                            <span className="font-medium">{asset.symbol}</span>
                            <span className="text-[var(--fs-xs)] text-[color:var(--color-text-muted)]">
                              {asset.assetClass} · {asset.exchange} · {asset.provider}
                            </span>
                          </span>
                          <span className="flex items-center gap-2">
                            <span className="text-[var(--fs-xs)] text-[color:var(--color-text-muted)]">
                              {asset.category}
                            </span>
                            <span className="text-[var(--fs-xs)] text-[color:var(--color-interactive)]">
                              {asset.confidence}%
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            )}

            {assetLoading && (
              <li className="px-2 py-2 text-[var(--fs-xs)] text-[color:var(--color-text-muted)]">Searching…</li>
            )}
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
