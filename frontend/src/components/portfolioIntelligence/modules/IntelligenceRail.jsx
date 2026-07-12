// =============================================================================
// IntelligenceRail — Portfolio Intelligence Rail (Smart Alerts)
// -----------------------------------------------------------------------------
// Severity-ranked, category-labelled alert rail. Designed to be INDEPENDENTLY
// REFRESHABLE: it receives a `refreshToken` + `onRefresh` and a `refreshing`
// flag so the parent can re-fetch alert inputs without re-rendering the whole
// workspace. All alerts come from AlertEngine.buildAlerts. Read-only.
// =============================================================================

import { useMemo, useState } from "react";
import { Badge } from "../../ui/badge";
import { buildAlerts, summarizeAlerts } from "../services/AlertEngine";
import { ALERT_SEVERITY, ALERT_CATEGORY } from "../models/domainModels";

const SEVERITY_TONE = {
  [ALERT_SEVERITY.CRITICAL]: "destructive",
  [ALERT_SEVERITY.WARNING]: "warning",
  [ALERT_SEVERITY.INFO]: "default",
  [ALERT_SEVERITY.POSITIVE]: "success",
};

const CATEGORY_LABEL = {
  [ALERT_CATEGORY.ORDER]: "Order",
  [ALERT_CATEGORY.EXECUTION]: "Execution",
  [ALERT_CATEGORY.BROKER_CONNECTIVITY]: "Broker",
  [ALERT_CATEGORY.PORTFOLIO_DRIFT]: "Drift",
  [ALERT_CATEGORY.RISK]: "Risk",
  [ALERT_CATEGORY.MARKET_EVENT]: "Market",
  [ALERT_CATEGORY.API_HEALTH]: "API",
};

export function IntelligenceRail({ context = {}, refreshing = false, onRefresh, lastUpdated }) {
  const [filterCategory, setFilterCategory] = useState("all");

  const alerts = useMemo(() => buildAlerts(context), [context]);
  const counts = useMemo(() => summarizeAlerts(alerts), [alerts]);

  const visible = useMemo(
    () => (filterCategory === "all" ? alerts : alerts.filter((a) => a.category === filterCategory)),
    [alerts, filterCategory]
  );

  const categories = useMemo(() => {
    const present = new Set(alerts.map((a) => a.category));
    return Object.values(ALERT_CATEGORY).filter((c) => present.has(c));
  }, [alerts]);

  return (
    <section className="portfolio-command-side-card portfolio-intelligence-rail">
      <div className="portfolio-command-panel-head">
        <div>
          <h3>Portfolio Intelligence</h3>
          <p>Severity-ranked alerts across orders, executions, connectivity, drift, risk, events, and API health.</p>
        </div>
        <div className="portfolio-command-inline-actions">
          {lastUpdated ? <span className="portfolio-command-beta-pill">{lastUpdated}</span> : null}
          {onRefresh ? (
            <button type="button" className="portfolio-v2-link" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="portfolio-intelligence-summary">
        <span className="critical">{counts.critical} critical</span>
        <span className="warning">{counts.warning} warning</span>
        <span className="info">{counts.info} info</span>
      </div>

      <div className="portfolio-history-toolbar" style={{ padding: "0 16px" }}>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)} aria-label="Filter alerts by category">
          <option value="all">All categories ({alerts.length})</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c] || c} ({alerts.filter((a) => a.category === c).length})
            </option>
          ))}
        </select>
      </div>

      <div className="portfolio-intelligence-list">
        {visible.length ? (
          visible.map((alert) => (
            <article key={alert.id} className={`portfolio-intelligence-alert severity-${alert.severity}`}>
              <div className="portfolio-intelligence-alert-head">
                <Badge variant={SEVERITY_TONE[alert.severity] || "default"}>{alert.severity}</Badge>
                <span className="portfolio-intelligence-alert-cat">{CATEGORY_LABEL[alert.category] || alert.category}</span>
              </div>
              <strong>{alert.title}</strong>
              {alert.message ? <p>{alert.message}</p> : null}
              <dl className="portfolio-intelligence-alert-meta">
                <div>
                  <dt>Source</dt>
                  <dd>{alert.source}</dd>
                </div>
                <div>
                  <dt>Impact</dt>
                  <dd>{alert.impact || "—"}</dd>
                </div>
                {alert.recommendedAction ? (
                  <div className="portfolio-intelligence-alert-action">
                    <dt>Recommended</dt>
                    <dd>{alert.recommendedAction}</dd>
                  </div>
                ) : null}
              </dl>
              <span className="portfolio-intelligence-alert-time">{formatAlertTime(alert.timestamp)}</span>
            </article>
          ))
        ) : (
          <div className="portfolio-command-empty compact">
            <h3>No alerts</h3>
            <p>Nothing requiring attention across your connected venues.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function formatAlertTime(value) {
  const ts = new Date(value || 0).getTime();
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
