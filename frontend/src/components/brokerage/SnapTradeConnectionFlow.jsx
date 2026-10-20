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

  const [portalUrl, setPortalUrl] = useState(null);
  const [popupBlocked, setPopupBlocked] = useState(false);

  const startConnection = useCallback(async () => {
    setPhase(PHASE.CREATING);
    setError(null);
    setPopupBlocked(false);
    try {
      const created = await createBrokerageConnection({ providerKey: "snaptrade" });
      const connectionId = created?.connectionId || created?.id;
      if (!connectionId) throw new Error("No connection id returned from brokerage service.");
      const url = created?.authorizationUrl || created?.connectionUrl || created?.redirectUrl;
      setConnection(created);
      setPortalUrl(url || null);
      savePendingBrokerageFlow({ connectionId });
      setPhase(PHASE.OPENING);

      if (url) {
        // window.open() called AFTER an await is blocked by Safari and Firefox:
        // the click's user-activation has already expired, so no tab opens and
        // the user is left staring at "Waiting for authorization" forever.
        // We cannot open before the await (the URL does not exist yet), so we
        // attempt it and treat a null return as "blocked" — then provide a real
        // link the user can click, which is always allowed.
        const opened = window.open(url, "snaptrade_portal", "noopener,noreferrer,width=960,height=760");
        if (!opened) setPopupBlocked(true);
      }
    } catch (createErr) {
      setPhase(PHASE.ERROR);
      setError({ message: createErr?.message || "Could not start brokerage connection." });
      onError?.(createErr);
    }
  }, [onError]);

  // Re-check the connection and advance the flow if the portal has completed.
  //
  // This is the fix for the stuck modal. Previously OPENING and PENDING were
  // TERMINAL states: the only affordance was "I've authorized — continue",
  // which merely moved OPENING to PENDING and rendered the same message with no
  // button at all. Nothing ever asked the server whether authorization had
  // actually finished, so the modal waited forever unless the user happened to
  // close it during the redirect callback.
  const checkAuthorization = useCallback(async ({ silent = false } = {}) => {
    const connectionId = connection?.connectionId || connection?.id;
    if (!connectionId) return false;
    if (!silent) setSyncing(true);
    try {
      const refreshed = await refreshBrokerageConnectionStatus(connectionId);
      setConnection(refreshed);
      const status = String(refreshed?.status || "pending").toLowerCase();

      if (status === "connected" || status === "active" || status === "verified") {
        clearPendingBrokerageFlow();
        setPhase(PHASE.SYNCING);
        setError(null);
        try {
          await syncBrokerageConnection(connectionId, { mode: "full" });
        } catch (syncErr) {
          // A sync failure must not hide the fact that the authorization
          // SUCCEEDED; the connection exists and can be refreshed later.
          setError({ message: syncErr?.message || "Connected, but the first sync failed. Use Refresh now.", retryable: true });
        }
        setPhase(PHASE.SUCCESS);
        onConnected?.(refreshed);
        return true;
      }

      if (status === "expired" || status === "revoked" || status === "disconnected" || status === "failed") {
        clearPendingBrokerageFlow();
        setPhase(PHASE.ERROR);
        setError({ message: "Authorization was not completed. Reconnect to try again.", code: "BROKERAGE_RECONNECT" });
        return true;
      }

      // Still pending — stay put, but tell the user we checked.
      if (!silent) setError(null);
      setPhase(PHASE.PENDING);
      return false;
    } catch (err) {
      if (!silent) {
        setError({ message: err?.message || "Could not check the authorization status.", retryable: true });
      }
      return false;
    } finally {
      if (!silent) setSyncing(false);
    }
  }, [connection, onConnected]);

  // Poll while waiting, so returning from the portal completes the flow on its
  // own. Backs off from 3s to 15s and gives up after ~4 minutes rather than
  // polling forever on a modal the user has walked away from.
  useEffect(() => {
    if (!open) return undefined;
    if (phase !== PHASE.OPENING && phase !== PHASE.PENDING) return undefined;
    if (!(connection?.connectionId || connection?.id)) return undefined;

    let cancelled = false;
    let attempt = 0;
    let timer = null;
    const MAX_ATTEMPTS = 20;

    const tick = async () => {
      if (cancelled) return;
      attempt += 1;
      const done = await checkAuthorization({ silent: true });
      if (cancelled || done) return;
      if (attempt >= MAX_ATTEMPTS) {
        // Stop polling but DO NOT strand the user: surface a clear state with
        // actions, rather than an indefinite "Waiting for authorization".
        setPhase(PHASE.PENDING);
        setError({
          message: "Still waiting on the brokerage portal. Finish authorizing there, then check again.",
          retryable: true
        });
        return;
      }
      const delay = Math.min(3000 * Math.pow(1.25, attempt - 1), 15000);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, 3000);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [open, phase, connection, checkAuthorization]);

  // Re-check when the tab regains focus: the user comes back from the portal
  // tab, and this is the moment authorization has most likely just completed.
  useEffect(() => {
    if (!open) return undefined;
    if (phase !== PHASE.OPENING && phase !== PHASE.PENDING) return undefined;
    const onVisible = () => {
      if (document.visibilityState === "visible") checkAuthorization({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [open, phase, checkAuthorization]);

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
                {phase === PHASE.CREATING ? "Preparing a secure connection" : "Waiting for authorization"}
              </p>

              {/* Show the handoff as steps. The old version was one sentence,
                  so nothing indicated whether anything was still happening —
                  which is what made this feel stuck. */}
              <ol className="snaptrade-flow-steps">
                <li className="snaptrade-flow-step is-done">
                  <span className="snaptrade-flow-step-marker" aria-hidden="true">✓</span>
                  <span className="snaptrade-flow-step-body">
                    <span className="snaptrade-flow-step-label">Connection created</span>
                    <span className="snaptrade-flow-step-detail">Zenin opened a read-only request with SnapTrade.</span>
                  </span>
                </li>
                <li className={`snaptrade-flow-step ${phase === PHASE.CREATING ? "is-active" : popupBlocked ? "" : "is-active"}`}>
                  <span className="snaptrade-flow-step-marker" aria-hidden="true">
                    {popupBlocked ? "!" : phase === PHASE.CREATING ? "2" : "→"}
                  </span>
                  <span className="snaptrade-flow-step-body">
                    <span className="snaptrade-flow-step-label">Authorize at your brokerage</span>
                    <span className="snaptrade-flow-step-detail">
                      {popupBlocked
                        ? "Your browser blocked the pop-up — use the button below to open the portal."
                        : "In the SnapTrade tab, sign in to your brokerage and grant read-only access."}
                    </span>
                  </span>
                </li>
                <li className={`snaptrade-flow-step ${syncing ? "is-active" : ""}`}>
                  <span className="snaptrade-flow-step-marker" aria-hidden="true">{syncing ? "…" : "3"}</span>
                  <span className="snaptrade-flow-step-body">
                    <span className="snaptrade-flow-step-label">Zenin finishes automatically</span>
                    <span className="snaptrade-flow-step-detail">
                      Once you approve, this updates on its own and runs the first sync — no need to come back and confirm.
                    </span>
                  </span>
                </li>
              </ol>
              {popupBlocked && portalUrl && (
                <div className="snaptrade-flow-blocked" role="alert">
                  <p className="snaptrade-flow-copy">
                    Your browser blocked the SnapTrade pop-up. Open the portal with the button below.
                  </p>
                  <a
                    className="btn btn--primary"
                    href={portalUrl}
                    target="snaptrade_portal"
                    rel="noopener noreferrer"
                  >
                    Open SnapTrade portal
                  </a>
                </div>
              )}

              {syncing ? (
                <p className="snaptrade-flow-checking" role="status">
                  <span className="snaptrade-flow-spinner" aria-hidden="true" />
                  Checking with SnapTrade…
                </p>
              ) : (
                <>
                  {error?.retryable && <p className="snaptrade-flow-error">{error.message}</p>}
                  <div className="snaptrade-flow-actions">
                    {/* A real action, not a state toggle. The old button only
                        moved OPENING to PENDING, which rendered this same
                        message with NO button — an unrecoverable dead end. */}
                    <button type="button" className="btn btn--primary" onClick={() => checkAuthorization()}>
                      I've authorized — check now
                    </button>
                    {portalUrl && (
                      <a className="btn btn--ghost" href={portalUrl} target="snaptrade_portal" rel="noopener noreferrer">
                        Reopen portal
                      </a>
                    )}
                    <button type="button" className="btn btn--ghost" onClick={reconnect} disabled={syncing}>
                      Start over
                    </button>
                  </div>
                </>
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
