// Universal Alert Builder (Phase 5).
//
// One builder for every asset kind (stock / etf / crypto / fx / commodity /
// indicator). The condition set is registry-driven (see assetActionRegistry
// ALERT_CONDITIONS + ALERT_POST_ACTIONS) so adding a condition is a one-line
// change.
//
// Persistence: alerts are now written to the real backend via
// POST /api/market/alerts (no more localStorage-only stub). The backend
// AlertRulesEngine evaluates PRICE_CHANGE events from the live quote stream and
// dispatches an in-app notification when a rule matches.
//
// Only the three conditions the engine can actually evaluate today are offered
// in the builder UI (above / below / pctChange). The remaining registry entries
// (maCross, yoy, mom, volatility, releaseDay, transmission) have no backend
// evaluator yet and would silently never fire, so they are hidden here rather
// than promised.

import React, { useState, useCallback } from "react";
import { ALERT_CONDITIONS, ALERT_POST_ACTIONS } from "../utils/assetActionRegistry";
import { zeninFetch } from "../utils/zeninFetch";

// Conditions the backend AlertRulesEngine can evaluate against live PRICE_CHANGE
// events. See market-intel/application/AlertRulesEngine._matchRule.
const EVALUABLE_CONDITIONS = ["above", "below", "pctChange"];
const BUILDER_CONDITIONS = ALERT_CONDITIONS.filter((c) => EVALUABLE_CONDITIONS.includes(c.key));

function buildConditions(condition, threshold) {
  const value = threshold === "" || threshold == null ? null : Number(threshold);
  switch (condition) {
    case "above":
      return { priceAbove: value };
    case "below":
      return { priceBelow: value };
    case "pctChange":
      return { changePercentAbove: value };
    default:
      return {};
  }
}

/**
 * @param {{open:boolean, asset:{kind:string,symbol:string,label?:string}}} props
 * @param {() => void} onClose
 * @param {(msg:string)=>void} onToast
 */
export function AssetAlertBuilder({ open, asset, onClose, onToast }) {
  const [condition, setCondition] = useState("above");
  const [threshold, setThreshold] = useState("");
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  const symbol = asset?.symbol;
  const label = asset?.label || symbol;

  const save = async () => {
    const numericThreshold = threshold === "" ? null : Number(threshold);
    if (numericThreshold == null || Number.isNaN(numericThreshold)) {
      if (onToast) onToast("Enter a threshold value for the alert.");
      return;
    }
    const conditions = buildConditions(condition, numericThreshold);
    const name = `${label || symbol} ${condition === "above" ? "above" : condition === "below" ? "below" : "pct change"} ${numericThreshold}`;
    const payload = {
      name,
      eventType: "PRICE_CHANGE",
      symbol: String(symbol || "").toUpperCase(),
      conditions,
      channels: ["inApp"],
      enabled: true
    };

    setSaving(true);
    try {
      const res = await zeninFetch("/api/market/alerts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Failed to save alert (${res.status})`);
      }
      if (onToast) onToast(`Alert created for ${label || symbol}.`);
      onClose && onClose();
    } catch (error) {
      if (onToast) onToast(error?.message || "Could not save alert.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay alert-builder-overlay" onClick={onClose}>
      <div className="modal-content alert-builder" onClick={(e) => e.stopPropagation()}>
        <header className="alert-builder-header">
          <div>
            <div className="alert-builder-eyebrow">ALERT BUILDER · {String(asset?.kind || "indicator").toUpperCase()}</div>
            <h3>{label || symbol}</h3>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">&times;</button>
        </header>

        <div className="alert-builder-body">
          <label className="alert-field">
            <span>Condition</span>
            <select value={condition} onChange={(e) => setCondition(e.target.value)}>
              {BUILDER_CONDITIONS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <small>{BUILDER_CONDITIONS.find((c) => c.key === condition)?.hint}</small>
          </label>

          <label className="alert-field">
            <span>Threshold value</span>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="e.g. 4"
            />
          </label>

          <div className="alert-field">
            <span>Then</span>
            <div className="alert-post-actions">
              {ALERT_POST_ACTIONS.map((a) => (
                <label key={a.key} className="alert-post on">
                  <input type="checkbox" checked={a.key === "notify"} readOnly />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <footer className="alert-builder-footer">
          <button className="alert-cancel" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="alert-save" onClick={save} disabled={saving}>
            {saving ? "Creating…" : "Create Alert"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export default AssetAlertBuilder;
