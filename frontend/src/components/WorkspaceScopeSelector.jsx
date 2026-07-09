import { useEffect, useRef, useState } from "react";
import { useWorkspaceScope } from "./WorkspaceScopeContext";

/**
 * Workspace Scope selector — global account-level context for the Portfolio workspace.
 * Coexists with the asset-class "Portfolio scope" filter (different concern).
 * Sourced from connectedAccounts, grouped by venue type (CEX/DEX/Broker/Prediction).
 * Monochrome; relies on existing design tokens + .workspace-scope-* styles in styles.css.
 */
export function WorkspaceScopeSelector() {
  const { scope, setScope, groupedAccounts, accountCount, isAll } = useWorkspaceScope();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const currentLabel = isAll ? "All Accounts" : (() => {
    const found = groupedAccounts
      .flatMap((g) => g.accounts)
      .find((a) => a.id === scope);
    return found ? found.provider : "Scope";
  })();

  return (
    <div className="workspace-scope" ref={ref}>
      <button
        type="button"
        className="portfolio-v2-select workspace-scope-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Workspace scope"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="workspace-scope-trigger-label">{currentLabel}</span>
        <span className="workspace-scope-caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="workspace-scope-menu" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={isAll}
            className={`workspace-scope-option${isAll ? " is-selected" : ""}`}
            onClick={() => { setScope("all"); setOpen(false); }}
          >
            <span className="workspace-scope-option-label">All Accounts</span>
            <span className="workspace-scope-option-meta">{accountCount} connected</span>
          </button>
          {groupedAccounts.length === 0 && (
            <div className="workspace-scope-empty">No connected accounts yet</div>
          )}
          {groupedAccounts.map((group) => (
            <div className="workspace-scope-group" key={group.id}>
              <div className="workspace-scope-group-label">{group.label}</div>
              {group.accounts.map((acc) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={scope === acc.id}
                  key={acc.id}
                  className={`workspace-scope-option${scope === acc.id ? " is-selected" : ""}`}
                  onClick={() => { setScope(acc.id); setOpen(false); }}
                >
                  <span
                    className={`workspace-scope-dot workspace-scope-dot--${acc.lastSyncStatus}`}
                    aria-hidden="true"
                  />
                  <span className="workspace-scope-option-label">{acc.provider}</span>
                  {acc.username ? (
                    <span className="workspace-scope-option-meta">{acc.username}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
