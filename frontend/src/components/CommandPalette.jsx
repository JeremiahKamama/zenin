import { useEffect, useMemo, useRef, useState } from "react";

/**
 * CommandPalette — Koyfin-style ⌘K launcher.
 *
 * Props:
 *   open            boolean   controlled visibility
 *   onClose         () => void
 *   commands        Array<{ id, label, group?, hint?, shortcut?, run, keywords? }>
 *                   where run: () => void  (call after closing the palette)
 *
 * Keyboard:
 *   ⌘/Ctrl+K        toggles open (handled by the host, or by mounting this component)
 *   ↑/↓             move selection
 *   Enter           execute highlighted command
 *   Esc             close
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

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    // Defer focus to next paint so the overlay has mounted.
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (activeIndex >= filtered.length) setActiveIndex(0);
  }, [filtered.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const handler = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
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
          // Run after close so the host can unmount the overlay first if needed.
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

  if (!open) return null;

  const groups = useMemo(() => {
    const out = new Map();
    filtered.forEach((cmd) => {
      const key = cmd.group || "Commands";
      if (!out.has(key)) out.set(key, []);
      out.get(key).push(cmd);
    });
    return Array.from(out.entries());
  }, [filtered]);

  let runningIndex = -1;

  return (
    <div className="cmdk-overlay" role="dialog" aria-modal="true" aria-label="Command palette" onMouseDown={onClose}>
      <div className="cmdk-window" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cmdk-input-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="11" cy="11" r="7" strokeLinecap="round" strokeLinejoin="round" />
            <path d="m20 20-3.2-3.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sections, jump to a desk, run an action…"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck="false"
          />
          <kbd className="cmdk-esc" aria-hidden="true">Esc</kbd>
        </div>
        {filtered.length === 0 ? (
          <div className="cmdk-empty">No matches for “{query}”.</div>
        ) : (
          <ul ref={listRef} className="cmdk-list" aria-label="Available commands">
            {groups.map(([group, items]) => (
              <li key={group} className="cmdk-group">
                <div className="cmdk-group-label">{group}</div>
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
                          className={isActive ? "cmdk-row active" : "cmdk-row"}
                          aria-selected={isActive}
                          onMouseEnter={() => setActiveIndex(idx)}
                          onClick={() => {
                            onClose();
                            setTimeout(() => cmd.run(), 0);
                          }}
                        >
                          <span className="cmdk-row-label">
                            {cmd.label}
                            {cmd.hint && <small>{cmd.hint}</small>}
                          </span>
                          {cmd.shortcut && <kbd className="cmdk-shortcut">{cmd.shortcut}</kbd>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
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