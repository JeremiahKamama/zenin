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
        id="zenin-command-palette"
        className="command-palette max-w-xl gap-0 p-0"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">
          Search sections, assets, or run an action.
        </DialogDescription>

        {/* Search row */}
        <div className="command-palette__search-row">
          <Search className="h-4 w-4 shrink-0 opacity-60" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sections, assets, desks…"
            aria-label="Search commands and assets"
            autoComplete="off"
            spellCheck="false"
            className="command-palette__search-input"
          />
          <kbd
            className="command-palette__escape"
            aria-hidden="true"
          >
            Esc
          </kbd>
        </div>

        {/* List / empty state */}
        {query.trim() && flatItems.length === 0 && !assetLoading ? (
          <div className="command-palette__empty">
            No matches for “{query}”.
          </div>
        ) : (
          <ul
            ref={listRef}
            className="command-palette__list"
            aria-label="Available commands and assets"
          >
            {groups.map(([group, items]) => (
              <li key={group} className="command-palette__group">
                <div className="command-palette__group-label">
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
                          className={cn("command-palette__item", isActive && "is-active")}
                        >
                          <span className="command-palette__item-copy">
                            <span>{cmd.label}</span>
                            {cmd.hint && (
                              <small>{cmd.hint}</small>
                            )}
                          </span>
                          {cmd.shortcut && (
                            <kbd className="command-palette__shortcut">
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
              <li className="command-palette__group">
                <div className="command-palette__group-label">
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
                          className={cn("command-palette__item", "command-palette__asset", isActive && "is-active")}
                        >
                          <span className="command-palette__item-copy">
                            <span className="command-palette__asset-identity">
                              <span className="command-palette__asset-symbol">{asset.symbol}</span>
                              {asset.name && String(asset.name).toUpperCase() !== String(asset.symbol).toUpperCase() ? (
                                <span className="command-palette__asset-name">{asset.name}</span>
                              ) : null}
                            </span>
                            <small>
                              {asset.assetClass} · {asset.exchange} · {asset.provider}
                              {asset.fallback ? " · Reference fallback" : asset.live ? " · Live" : ""}
                            </small>
                          </span>
                          <span className="command-palette__asset-meta">
                            <span>
                              {asset.category}
                            </span>
                            <span className="command-palette__asset-confidence">
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
              <li className="command-palette__loading">Searching…</li>
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
