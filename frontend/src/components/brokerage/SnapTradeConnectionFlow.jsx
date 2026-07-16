/**
 * SnapTradeConnectionFlow
 * =======================
 *
 * Self-contained "Connect brokerage" experience for the SnapTrade pilot. Used in
 * three surfaces (onboarding, Portfolio connection drawer, Account → Connected
 * Sources). It owns the full lifecycle against the brokerage API:
 *
 *   idle → loading providers → create connection → open hosted portal
 *        → (portal returns via callback URL) → restore pending flow
 *        → refresh status → first full sync → success | pending | denied | error
 *
 * Reconnect / refresh-now / disconnect-with-confirmation are supported from the
 * connected state. The copy never implies trading or withdrawals; it is labeled
 * a "Read-only brokerage connection."
 *
 * No brokerage credentials ever touch this component or the client — the secret
 * lives encrypted server-side. The portal URL is returned by the backend.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  fetchBrokerageProviders,
  createBrokerageConnection,
  getBrokerageConnection,
  refreshBrokerageConnectionStatus,
  syncBrokerageConnection,
  deleteBrokerageConnection,
  savePendingBrokerageFlow,
  readPendingBrokerageFlow,
  clearPendingBrokerageFlow
} from "../../utils/brokerageApi.js";
import { deriveBrokerageBadge, formatLastSync, maskAccountNumber } from "../../utils/brokerageStatus.js";

const PHASE = Object.freeze({
  IDLE: "idle",
  LOADING_PROVIDERS: "loading_providers",
  NO_PROVIDER: "no_provider",
  CREATING: "creating",
  OPENING: "opening",
  PENDING: "pending",
  SYNCING: "syncing",
  SUCCESS: "success",
  DENIED: "denied",
  ERROR: "error"
});

function useFocusOnOpen(open, dialogRef) {
  const prevFocus = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    prevFocus.current = typeof document !== "undefined" ? document.activeElement : null;
    const node = dialogRef.current;
    if (node) {
      const focusable = node.querySelector("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])");
      (focusable || node).focus?.();
    }
    return () => {
      try { prevFocus.current?.focus?.(); } catch { /* noop */ }
    };
  }, [open, dialogRef]);
}

export function SnapTradeConnectionFlow({ open, onClose, onConnected, onError }) {
  const dialogRef = useRef(null);
  useFocusOnOpen(open, dialogRef);

  const [phase, setPhase] = useState(PHASE.IDLE);
  const [providers, setProviders] = useState([]);
  const [connection, setConnection] = useState(null);
  const [error, setError] = useState(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const beginRecovery = useCallback(async () => {
    const pending = readPendingBrokerageFlow();
    if (!pending?.connectionId) return false;
    try {
      const refreshed = await refreshBrokerageConnectionStatus(pending.connectionId);
      setConnection(refreshed);
      const status = String(refreshed?.status || "pending").toLowerCase();
      if (status === "connected" || status === "active" || status === "verified") {
        // First full sync after authorization.
        setPhase(PHASE.SYNCING);
        setSyncing(true);
        try {
          await syncBrokerageConnection(pending.connectionId, { mode: "full" });
          setPhase(PHASE.SUCCESS);
          onConnected?.(refreshed);
        } catch (syncErr) {
          // Sync failure is recoverable — keep the connection, surface the error.
          setPhase(PHASE.SUCCESS);
          setError({ message: syncErr?.message || "First sync failed. You can retry from Connected Accounts.", retryable: true });
          onConnected?.(refreshed);
        } finally {
          setSyncing(false);
        }
      } else if (status === "expired" || status === "revoked" || status === "disconnected") {
        setPhase(PHASE.ERROR);
        setError({ message: "Authorization was not completed. Reconnect to try again.", code: "BROKERAGE_RECONNECT" });
      } else {
        setPhase(PHASE.PENDING);
      }
      return true;
    } catch (refreshErr) {
      setPhase(PHASE.ERROR);
      setError({ message: refreshErr?.message || "Could not confirm brokerage connection." });
      return true;
    } finally {
      clearPendingBrokerageFlow();
    }
  }, [onConnected]);

  // On open: either recover a pending portal-return flow, or load providers.
  useEffect(() => {
    if (!open) return undefined;
    setError(null);
    setConfirmDisconnect(false);
    let cancelled = false;
    (async () => {
      const recovered = await beginRecovery();
      if (recovered || cancelled) return;
      setPhase(PHASE.LOADING_PROVIDERS);
      try {
        const result = await fetchBrokerageProviders();
        if (cancelled) return;
        if (!result.available || result.providers.length === 0) {
          setPhase(PHASE.NO_PROVIDER);
          setError({ message: result.reason || "Brokerage connections are not available in your workspace yet.", code: result.code });
          return;
        }
        setProviders(result.providers);
        setPhase(PHASE.IDLE);
      } catch (provErr) {
        if (cancelled) return;
        setPhase(PHASE.NO_PROVIDER);
        setError({ message: provErr?.message || "Could not load brokerage providers." });
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const startConnection = useCallback(async () => {
    setPhase(PHASE.CREATING);
    setError(null);
    try {
      const created = await createBrokerageConnection({ providerKey: "snaptrade" });
      const connectionId = created?.connectionId || created?.id;
      if (!connectionId) throw new Error("No connection id returned from brokerage service.");
      const portalUrl = created?.authorizationUrl || created?.connectionUrl || created?.redirectUrl;
      setConnection(created);
      savePendingBrokerageFlow({ connectionId });
      if (portalUrl) {
        setPhase(PHASE.OPENING);
        window.open(portalUrl, "snaptrade_portal", "noopener,noreferrer,width=960,height=760");
      } else {
        // No portal URL (e.g. sandbox): simulate pending state.
        setPhase(PHASE.PENDING);
      }
    } catch (createErr) {
      setPhase(PHASE.ERROR);
      setError({ message: createErr?.message || "Could not start brokerage connection." });
      onError?.(createErr);
    }
  }, [onError]);

  const refreshNow = useCallback(async () => {
    if (!connection) return;
    setSyncing(true);
    try {
      const refreshed = await refreshBrokerageConnectionStatus(connection.connectionId || connection.id);
      setConnection(refreshed);
      setPhase(PHASE.SUCCESS);
    } catch (err) {
      setError({ message: err?.message || "Could not refresh connection status." });
    } finally {
      setSyncing(false);
    }
  }, [connection]);

  const runSync = useCallback(async () => {
    if (!connection) return;
    setSyncing(true);
    setPhase(PHASE.SYNCING);
    try {
      await syncBrokerageConnection(connection.connectionId || connection.id, { mode: "full" });
      setPhase(PHASE.SUCCESS);
    } catch (err) {
      setPhase(PHASE.SUCCESS);
      setError({ message: err?.message || "Sync failed. Try refresh now.", retryable: true });
    } finally {
      setSyncing(false);
    }
  }, [connection]);

  const reconnect = useCallback(async () => {
    // Re-authorization: create a fresh connection and open the portal again.
    clearPendingBrokerageFlow();
    await startConnection();
  }, [startConnection]);

  const disconnect = useCallback(async () => {
    if (!connection) return;
    setSyncing(true);
    try {
      await deleteBrokerageConnection(connection.connectionId || connection.id);
      setConnection(null);
      setPhase(PHASE.IDLE);
      clearPendingBrokerageFlow();
    } catch (err) {
      setError({ message: err?.message || "Could not disconnect brokerage." });
    } finally {
      setSyncing(false);
      setConfirmDisconnect(false);
    }
  }, [connection]);

  if (!open) return null;

  const badge = deriveBrokerageBadge(connection, { syncing });
  const institution = connection?.institutionName || connection?.providerMeta?.institutionName || "Brokerage";
  const accountNumber = maskAccountNumber(connection?.accountNumber || connection?.providerMeta?.accountNumber);

  return (
    <div
      className="home-v3-drawer-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <aside
        ref={dialogRef}
        className="home-v3-detail-drawer saved-items-drawer snaptrade-flow-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Connect brokerage"
        tabIndex={-1}
        onKeyDown={(e) => { if (e.key === "Escape") onClose?.(); }}
        style={{ maxWidth: 620 }}
      >
        <div className="home-v3-drawer-head">
          <div className="saved-items-section-head">
            <strong>Connect brokerage</strong>
            <span className="snaptrade-flow-tag">Read-only brokerage connection</span>
          </div>
          <button type="button" onClick={onClose} aria-label="Close connect brokerage">×</button>
        </div>

        <div className="saved-items-drawer-content snaptrade-flow-content">
          {phase === PHASE.NO_PROVIDER && (
            <div className="snaptrade-flow-state snaptrade-flow-state--idle">
              <p className="snaptrade-flow-title">Brokerage not available yet</p>
              <p className="snaptrade-flow-copy">{error?.message || "Brokerage connections are rolling out to pilot workspaces."}</p>
            </div>
          )}

          {[PHASE.IDLE, PHASE.LOADING_PROVIDERS].includes(phase) && (
            <div className="snaptrade-flow-state">
              <p className="snaptrade-flow-title">Link a brokerage (read-only)</p>
              <p className="snaptrade-flow-copy">
                Zenin connects through SnapTrade's secure portal. We can <strong>view</strong> your
                holdings and balances to preserve portfolio context — we cannot trade or move funds.
              </p>
              <ul className="snaptrade-flow-providers">
                {phase === PHASE.LOADING_PROVIDERS
                  ? <li className="snaptrade-flow-loading">Loading available brokers…</li>
                  : providers.map((p) => (
                    <li key={p.providerKey || p.key || p.name}>
                      <span className="snaptrade-flow-provider-name">{p.displayName || p.name}</span>
                      {p.institutionCount ? <span className="snaptrade-flow-provider-count">{p.institutionCount} institutions</span> : null}
                    </li>
                  ))}
              </ul>
              <div className="snaptrade-flow-actions">
                <button
                  type="button"
                  className="btn btn--primary"
                  disabled={phase === PHASE.LOADING_PROVIDERS || providers.length === 0}
                  onClick={startConnection}
                >
                  {phase === PHASE.LOADING_PROVIDERS ? "Loading…" : "Connect with SnapTrade"}
                </button>
              </div>
            </div>
          )}

          {[PHASE.CREATING, PHASE.OPENING, PHASE.PENDING].includes(phase) && (
            <div className="snaptrade-flow-state snaptrade-flow-state--pending">
              <p className="snaptrade-flow-title">
                {phase === PHASE.OPENING ? "Authorize in the SnapTrade portal" : "Waiting for authorization"}
              </p>
              <p className="snaptrade-flow-copy">
                {phase === PHASE.OPENING
                  ? "A secure SnapTrade tab opened. Authorize there, then return to Zenin — we'll finish the connection and run the first sync."
                  : "Complete authorization in the SnapTrade portal, then return here."}
              </p>
              {phase === PHASE.OPENING && (
                <button type="button" className="btn btn--ghost" onClick={() => setPhase(PHASE.PENDING)}>
                  I've authorized — continue
                </button>
              )}
            </div>
          )}

          {phase === PHASE.SYNCING && (
            <div className="snaptrade-flow-state snaptrade-flow-state--pending">
              <p className="snaptrade-flow-title">Syncing your accounts</p>
              <p className="snaptrade-flow-copy">Pulling holdings and balances from your brokerage. This runs once on connect; updates sync in the background after.</p>
            </div>
          )}

          {phase === PHASE.SUCCESS && connection && (
            <div className="snaptrade-flow-state snaptrade-flow-state--success">
              <p className="snaptrade-flow-title">Brokerage connected</p>
              <div className="snaptrade-flow-connection">
                <div className="snaptrade-flow-connection-row">
                  <span className={`provider-trust-pill provider-trust-pill-${badge.tone === "ok" ? "verified" : badge.tone}`}>{badge.label}</span>
                  <span className="snaptrade-flow-source-kind">{connection.sourceKind || "snaptrade"}</span>
                </div>
                <div className="snaptrade-flow-connection-meta">
                  <span>{institution}</span>
                  {accountNumber ? <span>{accountNumber}</span> : null}
                  <span>{formatLastSync(connection.lastSyncedAt)}</span>
                </div>
              </div>
              <p className="snaptrade-flow-copy snaptrade-flow-readonly">Read-only. Zenin cannot trade or withdraw from this connection.</p>
              {error?.retryable && <p className="snaptrade-flow-error">{error.message}</p>}
              <div className="snaptrade-flow-actions">
                <button type="button" className="btn btn--ghost" onClick={runSync} disabled={syncing}>Refresh now</button>
                <button type="button" className="btn btn--ghost" onClick={reconnect} disabled={syncing}>Reconnect</button>
                <button type="button" className="btn btn--ghost btn--danger" onClick={() => setConfirmDisconnect(true)} disabled={syncing}>Disconnect</button>
              </div>
            </div>
          )}

          {phase === PHASE.DENIED && (
            <div className="snaptrade-flow-state snaptrade-flow-state--error">
              <p className="snaptrade-flow-title">Authorization declined</p>
              <p className="snaptrade-flow-copy">{error?.message || "You declined brokerage authorization. No data was shared."}</p>
              <div className="snaptrade-flow-actions">
                <button type="button" className="btn btn--primary" onClick={startConnection}>Try again</button>
              </div>
            </div>
          )}

          {phase === PHASE.ERROR && (
            <div className="snaptrade-flow-state snaptrade-flow-state--error">
              <p className="snaptrade-flow-title">Connection issue</p>
              <p className="snaptrade-flow-copy">{error?.message || "Something went wrong connecting your brokerage."}</p>
              <div className="snaptrade-flow-actions">
                {error?.code === "BROKERAGE_RECONNECT" ? (
                  <button type="button" className="btn btn--primary" onClick={reconnect}>Reconnect</button>
                ) : (
                  <button type="button" className="btn btn--primary" onClick={startConnection}>Try again</button>
                )}
              </div>
            </div>
          )}

          {confirmDisconnect && (
            <div className="snaptrade-flow-confirm" role="alertdialog" aria-label="Confirm disconnect">
              <p className="snaptrade-flow-copy">Disconnect this brokerage? Zenin will stop syncing its data. This does not affect your brokerage account.</p>
              <div className="snaptrade-flow-actions">
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmDisconnect(false)} disabled={syncing}>Cancel</button>
                <button type="button" className="btn btn--primary btn--danger" onClick={disconnect} disabled={syncing}>Disconnect</button>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

export default SnapTradeConnectionFlow;
