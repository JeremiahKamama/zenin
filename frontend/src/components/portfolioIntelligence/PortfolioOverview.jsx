// =============================================================================
// PortfolioOverview — feature shell
// -----------------------------------------------------------------------------
// Owns the top reading-order blocks: Portfolio Summary → What Needs Attention →
// Recommended Changes. It is a thin orchestration shell; the actual cards
// (summaryCards, attentionCards, rebalance blocks) are computed in
// PortfolioModule and passed in via props/slots. This keeps business logic in
// PortfolioModule (single owner) while satisfying the "feature module"
// boundary required by the spec.
//
// Default export = memoized for re-render performance.
// =============================================================================

import { memo } from "react";
import { PortfolioTransmission } from "../../transmission/TransmissionSurfaces";
import { StatusIndicator } from "../StatusIndicator.jsx";

function PortfolioOverviewImpl({ summary, attention, recommendedChanges }) {
  return (
    <>
      <section className="portfolio-command-summary">
        <div className="portfolio-command-section-head">
          <span>Portfolio Summary</span>
          {summary?.eyebrow ? <em>{summary.eyebrow}</em> : null}
        </div>
        <div className="portfolio-command-summary-grid">
          {(summary?.cards || []).map((card) => (
            <article key={card.label} className={`portfolio-command-summary-card ${card.tone || "neutral"}`}>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <em>{card.detail}</em>
            </article>
          ))}
        </div>
      </section>

      <section className="portfolio-command-attention">
        <div className="portfolio-command-section-head">
          <span>What Needs Attention</span>
          {attention?.onViewAll ? (
            <button type="button" className="portfolio-v2-link" onClick={attention.onViewAll}>
              View All
            </button>
          ) : null}
        </div>
        <div className="portfolio-command-attention-grid">
          {(attention?.cards || []).map((card) => {
            const toneMap = { risk: "risk", warning: "warning", accent: "warning", negative: "risk", healthy: "healthy", neutral: "neutral", info: "info" };
            const stTone = toneMap[card.tone] || "neutral";
            return (
              <button
                key={card.id}
                type="button"
                className={`portfolio-command-attention-card ${card.tone || "neutral"}`}
                onClick={card.onClick}
              >
                <div>
                  <span className="portfolio-command-attention-head">
                    {card.title}
                    <StatusIndicator tone={stTone} detail={card.metric} />
                  </span>
                  <strong>{card.metric}</strong>
                  <em>{card.detail}</em>
                </div>
                <b>{card.action}</b>
              </button>
            );
          })}
        </div>
      </section>

      <section className="portfolio-command-rebalance">{recommendedChanges}</section>

      <PortfolioTransmission
        topDriver="Oil"
        currentEffect={{ label: "Negative Technology", tone: "negative" }}
        affectedHoldings={6}
        exposure="Medium"
      />
    </>
  );
}

export const PortfolioOverview = memo(PortfolioOverviewImpl);
export default PortfolioOverview;
