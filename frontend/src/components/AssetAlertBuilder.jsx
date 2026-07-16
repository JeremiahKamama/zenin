// Universal Alert Builder (Phase 5).
//
// One builder for every asset kind (stock / etf / crypto / fx / commodity /
// indicator). The condition set is registry-driven (see assetActionRegistry
// ALERT_CONDITIONS + ALERT_POST_ACTIONS) so adding a condition is a one-line
// change. Persistence is local (localStorage) — there is no alert backend yet,
// so saves are confirmed via the in-app toast and stored for the Alert Center
// to consume later. No fake server state, no fabricated success.

import React, { useState, useCallback } from "react";
import { ALERT_CONDITIONS, ALERT_POST_ACTIONS } from "../utils/assetActionRegistry";

const LS_ALERT = "zenin.indicatorAlerts";
const readLS = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
const writeLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

function loadAlerts() { return readLS(LS_ALERT, []); }

/**
 * @param {{open:boolean, asset:{kind:string,symbol:string,label?:string}}} props
 * @param {() => void} onClose
 * @param {(msg:string)=>void} onToast
 */
export function AssetAlertBuilder({ open, asset, onClose, onToast }) {
  const [condition, setCondition] = useState("above");
  const [threshold, setThreshold] = useState("");
  const [maPeriod, setMaPeriod] = useState("20");
  const [postActions, setPostActions] = useState(["notify"]);

  const togglePost = useCallback((key) => {
    setPostActions((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  if (!open) return null;

  const symbol = asset?.symbol;
  const label = asset?.label || symbol;

  const save = () => {
    const alerts = loadAlerts();
    alerts.push({
      id: `al_${Date.now()}`,
      kind: asset?.kind || "indicator",
      symbol: String(symbol || "").toUpperCase(),
      label,
      condition,
      threshold: threshold === "" ? null : Number(threshold),
      maPeriod: condition === "maCross" ? Number(maPeriod) : null,
      postActions,
      createdAt: new Date().toISOString(),
      active: true,
    });
    writeLS(LS_ALERT, alerts);
    if (onToast) onToast(`Alert saved for ${label || symbol} (${ALERT_CONDITIONS.find((c) => c.key === condition)?.label}).`);
    onClose && onClose();
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
              {ALERT_CONDITIONS.map((c) => (
                <option key={c.key} value={c.key}>{c.label}</option>
              ))}
            </select>
            <small>{ALERT_CONDITIONS.find((c) => c.key === condition)?.hint}</small>
          </label>

          {condition === "maCross" ? (
            <label className="alert-field">
              <span>Moving Average Period</span>
              <input type="number" value={maPeriod} onChange={(e) => setMaPeriod(e.target.value)} placeholder="20" />
            </label>
          ) : (
            <label className="alert-field">
              <span>Threshold {condition === "releaseDay" || condition === "transmission" ? "(not required)" : "value"}</span>
              <input
                type="number"
                value={threshold}
                onChange={(e) => setThreshold(e.target.value)}
                placeholder="e.g. 4"
                disabled={condition === "releaseDay" || condition === "transmission"}
              />
            </label>
          )}

          <div className="alert-field">
            <span>Then</span>
            <div className="alert-post-actions">
              {ALERT_POST_ACTIONS.map((a) => (
                <label key={a.key} className={`alert-post ${postActions.includes(a.key) ? "on" : ""}`}>
                  <input type="checkbox" checked={postActions.includes(a.key)} onChange={() => togglePost(a.key)} />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <footer className="alert-builder-footer">
          <button className="alert-cancel" onClick={onClose}>Cancel</button>
          <button className="alert-save" onClick={save}>Create Alert</button>
        </footer>
      </div>
    </div>
  );
}

export default AssetAlertBuilder;
