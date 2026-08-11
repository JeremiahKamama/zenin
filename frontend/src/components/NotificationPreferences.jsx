// components/NotificationPreferences.jsx
// Notification preference controls (spec: "Provider-Neutral Transaction Notifications").
// Persists to the canonical workspace doc `settings:notificationPreferences` via the
// generic docs endpoint. Server still emits a default `metadata.popup` flag; the client
// consults these preferences to decide whether a realtime event produces an in-app popup.
//
// Monochrome — reuses design-system tokens only.
import React, { useCallback, useEffect, useState } from "react";
import { zeninFetchJson } from "@/utils/zeninFetch";

const NAMESPACE = "notificationPreferences";

const DEFAULTS = {
  transactionActivityPopups: false, // single buy/sell/fill popups off by default
  depositWithdrawalPopups: true,
  sourceHealthAlerts: true,
  largeTransactionThreshold: 0, // 0 = no large-tx popup unless deposit/withdrawal
  mutedSources: [] // provider keys to mute (no popup)
};

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="np-toggle-row">
      <span className="np-toggle-text">
        <span className="np-toggle-label">{label}</span>
        {hint ? <span className="np-toggle-hint">{hint}</span> : null}
      </span>
      <span className="np-switch">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="np-switch-track" aria-hidden="true" />
      </span>
    </label>
  );
}

export function NotificationPreferences({ baseCurrency = "USD" }) {
  const [prefs, setPrefs] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await zeninFetchJson(`/db/workspace/docs/${NAMESPACE}`, { timeoutMs: 6000 }).catch(() => null);
      const doc = data && data.document && typeof data.document === "object" ? data.document : {};
      setPrefs({ ...DEFAULTS, ...doc });
    } catch {
      /* keep defaults */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const update = useCallback(async (next) => {
    setPrefs(next);
    setSaving(true);
    setError("");
    try {
      await zeninFetchJson(`/db/workspace/docs/${NAMESPACE}`, {
        method: "PUT",
        body: JSON.stringify({ document: next }),
        timeoutMs: 8000
      });
    } catch (err) {
      setError(err?.message || "Could not save preferences.");
    } finally {
      setSaving(false);
    }
  }, []);

  const setField = (key, value) => update({ ...prefs, [key]: value });
  const toggleMuted = (provider) => {
    const muted = new Set(prefs.mutedSources || []);
    if (muted.has(provider)) muted.delete(provider); else muted.add(provider);
    setField("mutedSources", [...muted]);
  };

  if (loading) return <div className="np-loading">Loading preferences…</div>;

  return (
    <div className="np-panel" aria-label="Notification preferences">
      <h4 className="np-title">Notification preferences</h4>

      <Toggle
        label="Transaction activity popups"
        hint="Buy / sell / fill popups (off by default)"
        checked={!!prefs.transactionActivityPopups}
        onChange={(v) => setField("transactionActivityPopups", v)}
      />
      <Toggle
        label="Deposits, withdrawals & transfers"
        hint="Always popup"
        checked={!!prefs.depositWithdrawalPopups}
        onChange={(v) => setField("depositWithdrawalPopups", v)}
      />
      <Toggle
        label="Source-health alerts"
        hint="Auth expired, stale, failed, recovered"
        checked={!!prefs.sourceHealthAlerts}
        onChange={(v) => setField("sourceHealthAlerts", v)}
      />

      <div className="np-field">
        <label className="np-toggle-label" htmlFor="np-threshold">
          Large-transaction threshold ({baseCurrency})
        </label>
        <input
          id="np-threshold"
          type="number"
          min="0"
          step="100"
          className="np-input"
          value={Number(prefs.largeTransactionThreshold || 0)}
          onChange={(e) => setField("largeTransactionThreshold", Math.max(0, Number(e.target.value) || 0))}
        />
        <span className="np-toggle-hint">Popup when a single transaction exceeds this value.</span>
      </div>

      <div className="np-mute">
        <span className="np-toggle-label">Mute sources</span>
        <div className="np-mute-row">
          {["snaptrade", "binance", "bybit", "hyperliquid", "interactive_brokers"].map((p) => (
            <button
              key={p}
              type="button"
              className={`np-mute-chip ${(prefs.mutedSources || []).includes(p) ? "is-muted" : ""}`}
              onClick={() => toggleMuted(p)}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="np-foot">
        {saving ? "Saving…" : error ? <span className="np-error">{error}</span> : <span className="np-saved">Saved to workspace</span>}
      </div>
    </div>
  );
}

export default NotificationPreferences;
