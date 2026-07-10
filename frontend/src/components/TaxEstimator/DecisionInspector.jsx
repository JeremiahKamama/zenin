import React, { useState } from "react";
import { formatMoney } from "./lib/taxConfig";

export default function DecisionInspector({
  accountantMode,
  summaryPreview,
  netAfterTax,
  confidenceScore,
  validationState,
  reviewStateLabel,
  reviewStateCopy,
  inputWarnings,
  optimizationScore,
  summaryModel,
  advanced,
  taxRules,
  primaryJurisdiction,
  hasBlockingIssues,
  onRun,
  onSave,
  onExport,
  onShowRuleDetails,
}) {
  const [showRuleDetails, setShowRuleDetails] = useState(false);
  const currency = advanced.currency || "USD";

  return (
    <aside className="tax-workbench-panel tax-workbench-inspector" aria-label="Decision inspector">
      <div className="tax-workbench-inspector-head">
        <span className="tax-workbench-mini-title">
          <span>Decision Inspector</span>
        </span>
      </div>

      <div className="tax-workbench-inspector-stats">
        {summaryModel.map((item) => (
          <article key={item.label} className={`tax-workbench-inspector-stat ${item.tone}`.trim()}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </article>
        ))}
      </div>

      <div
        id="tax-workbench-validation-summary"
        className={`tax-workbench-validation-summary ${hasBlockingIssues ? "error" : inputWarnings.length ? "warning" : "ready"}`.trim()}
        role="status"
        aria-live="polite"
      >
        <strong>{reviewStateLabel}</strong>
        <span>{reviewStateCopy}</span>
      </div>

      {hasBlockingIssues ? (
        <ul className="tax-workbench-inspector-issues">
          {validationState.errors.map((err) => (
            <li key={err}>{err}</li>
          ))}
        </ul>
      ) : null}

      <div className="tax-workbench-confidence-meter">
        <div>
          <span>Confidence &amp; rules</span>
          <strong>{confidenceScore}%</strong>
        </div>
        <div className="tax-workbench-meter-track">
          <div className="tax-workbench-meter-fill" style={{ width: `${confidenceScore}%` }} />
        </div>
      </div>

      <div className="tax-workbench-inspector-meta">
        <div>
          <span>Optimization score</span>
          <strong>{optimizationScore}%</strong>
        </div>
        <div>
          <span>Rules freshness</span>
          <strong>Current release</strong>
        </div>
        <div>
          <span>Tax data source</span>
          <strong>Vertex (v2024.05)</strong>
        </div>
      </div>

      <button type="button" className="tax-workbench-link-btn" onClick={() => setShowRuleDetails((v) => !v)}>
        {showRuleDetails ? "Hide rule details" : "View rule details"}
      </button>
      {showRuleDetails ? (
        <div className="tax-workbench-rule-sheet">
          <div>
            <span>Base case logic</span>
            <strong>{taxRules[primaryJurisdiction]?.logic || "General capital gains treatment"}</strong>
          </div>
          <div>
            <span>Filing context</span>
            <strong>{advanced.taxRegime} · {advanced.filingStatus} · {advanced.residencyStatus}</strong>
          </div>
          <div>
            <span>Primary notes</span>
            <strong>{advanced.notes?.trim() || "No scenario notes recorded yet."}</strong>
          </div>
        </div>
      ) : null}

      <div className="tax-workbench-inspector-actions">
        <button
          type="submit"
          form="tax-workbench-form"
          className="tax-workbench-primary-btn"
          aria-describedby="tax-workbench-validation-summary"
        >
          Run scenario
        </button>
        <div className="tax-workbench-inspector-secondary">
          <button type="button" className="journal-btn secondary" onClick={onSave}>
            Save
          </button>
          <button type="button" className="journal-btn secondary" onClick={onExport}>
            Export
          </button>
        </div>
      </div>
    </aside>
  );
}
