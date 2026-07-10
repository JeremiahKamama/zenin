import React, { useState } from "react";
import { DensePanelHeader } from "../CompactWorkspaceUI";
import { countryFlag, formatMoney } from "./lib/taxConfig";

function InsightsPanel({ taxLossSuggestions, currency, showInsights, onToggleInsights }) {
  return (
    <div className="tax-workbench-insights-block">
      <div className="tax-workbench-insights-head">
        <span>Harvest opportunities</span>
        <button type="button" className="tax-workbench-link-btn" onClick={onToggleInsights} aria-expanded={showInsights}>
          {showInsights ? "Hide" : "Show"}
        </button>
      </div>
      <div className="tax-workbench-warning-list" role="status" aria-live="polite">
        {taxLossSuggestions.length === 0 ? (
          <span className="tax-workbench-insight-empty">No harvest candidates from current holdings.</span>
        ) : (
          taxLossSuggestions.map((idea) => (
            <article key={idea.symbol} className="tax-workbench-insight-card">
              <div>
                <strong>{idea.symbol}</strong>
                <span>{idea.name}</span>
              </div>
              <dl>
                <div>
                  <dt>Unrealized loss</dt>
                  <dd>{formatMoney(idea.unrealizedLoss, currency)}</dd>
                </div>
                <div>
                  <dt>Offset available</dt>
                  <dd>{formatMoney(idea.offsetAmount, currency)}</dd>
                </div>
                <div>
                  <dt>Estimated saving</dt>
                  <dd>{formatMoney(idea.estimatedSaving, currency)}</dd>
                </div>
              </dl>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

export default function OptimizationWorkspace({
  jurisdictionRecommendations,
  taxLossSuggestions,
  jurisdictions,
  currency,
  onApplyRecommendation,
}) {
  const [showInsights, setShowInsights] = useState(false);
  const hasRecommendations = jurisdictionRecommendations.length > 0;

  return (
    <section className="tax-workbench-panel tax-workbench-optimization">
      <DensePanelHeader
        title="Optimization Workspace"
        subtitle="Lower-liability alternatives and tax-loss harvesting based on the current gains mix."
      />

      {hasRecommendations ? (
        <div className="tax-workbench-idea-grid">
          {jurisdictionRecommendations.map((row) => {
            const isApplied = jurisdictions.includes(row.key);
            return (
              <article key={row.key} className={`tax-workbench-idea-card ${isApplied ? "is-applied" : ""}`.trim()}>
                <strong>
                  {countryFlag(row.key)} {row.name}
                </strong>
                <span>{row.logic}</span>
                <div>
                  <em>Potential saving</em>
                  <strong>{formatMoney(row.saving, currency)}</strong>
                </div>
                <button
                  type="button"
                  className="tax-workbench-idea-apply"
                  onClick={() => onApplyRecommendation(row.key)}
                  aria-pressed={isApplied}
                >
                  {isApplied ? "Remove" : "Apply"}
                </button>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="tax-workbench-empty">No lower-liability jurisdictions available from the current gains mix.</p>
      )}

      <InsightsPanel
        taxLossSuggestions={taxLossSuggestions}
        currency={currency}
        showInsights={showInsights}
        onToggleInsights={() => setShowInsights((v) => !v)}
      />
    </section>
  );
}
