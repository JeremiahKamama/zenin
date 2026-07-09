import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Workspace Scope — global account-level context for the Portfolio workspace.
 * Distinct from the per-table asset-class filter (PortfolioModule.assetClassFilter).
 * Scope answers "which connected account(s)" the workspace is framed around,
 * defaulting to "all". Persisted to localStorage so it survives reloads.
 */

const SCOPE_STORAGE_KEY = "zenin_workspace_scope";

const VENUE_GROUPS = [
  { id: "cex", label: "CEX" },
  { id: "dex", label: "DEX" },
  { id: "broker", label: "Broker" },
  { id: "prediction", label: "Prediction" },
];

const WorkspaceScopeContext = createContext(null);

function readStoredScope() {
  try {
    const raw = localStorage.getItem(SCOPE_STORAGE_KEY);
    return raw ? String(raw) : "all";
  } catch {
    return "all";
  }
}

function groupAccounts(accounts) {
  if (!Array.isArray(accounts) || accounts.length === 0) return [];
  return VENUE_GROUPS.map((group) => ({
    ...group,
    accounts: accounts
      .filter((acc) => (acc.venueType || "cex") === group.id)
      .map((acc) => ({
        id: acc.id,
        provider: acc.provider || acc.exchange || "Unknown",
        username: acc.username || "",
        lastSyncStatus: acc.lastSyncStatus || "unknown",
      })),
  })).filter((group) => group.accounts.length > 0);
}

export function WorkspaceScopeProvider({ accounts = [], children }) {
  const [scope, setScopeState] = useState(() => readStoredScope());

  useEffect(() => {
    try {
      localStorage.setItem(SCOPE_STORAGE_KEY, scope);
    } catch {
      /* storage unavailable — non-fatal */
    }
  }, [scope]);

  const setScope = useCallback((next) => {
    setScopeState(next === "all" ? "all" : String(next));
  }, []);

  const groupedAccounts = useMemo(() => groupAccounts(accounts), [accounts]);
  const accountCount = Array.isArray(accounts) ? accounts.length : 0;

  const activeAccount = useMemo(() => {
    if (scope === "all" || !Array.isArray(accounts)) return null;
    return accounts.find((acc) => acc.id === scope) || null;
  }, [scope, accounts]);

  const value = useMemo(
    () => ({
      scope,
      setScope,
      accounts,
      accountCount,
      groupedAccounts,
      activeAccount,
      isAll: scope === "all",
    }),
    [scope, setScope, accounts, accountCount, groupedAccounts, activeAccount]
  );

  return (
    <WorkspaceScopeContext.Provider value={value}>
      {children}
    </WorkspaceScopeContext.Provider>
  );
}

export function useWorkspaceScope() {
  const ctx = useContext(WorkspaceScopeContext);
  if (!ctx) {
    // Safe no-op default when rendered outside the provider (e.g. isolated preview).
    return {
      scope: "all",
      setScope: () => {},
      accounts: [],
      accountCount: 0,
      groupedAccounts: [],
      activeAccount: null,
      isAll: true,
    };
  }
  return ctx;
}
