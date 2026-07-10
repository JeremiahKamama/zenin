import { ComparisonOverview } from "./sections/ComparisonOverview";
import { ComparisonPrice } from "./sections/ComparisonPrice";
import { ComparisonPerformance } from "./sections/ComparisonPerformance";
import { ComparisonFundamentals } from "./sections/ComparisonFundamentals";
import { ComparisonValuation } from "./sections/ComparisonValuation";
import { ComparisonFinancials } from "./sections/ComparisonFinancials";
import {
  ComparisonGrowth,
  ComparisonProfitability,
  ComparisonQuality,
  ComparisonTechnical,
  ComparisonMacro,
  ComparisonOwnership,
  ComparisonNews,
  ComparisonCatalysts,
  ComparisonRisks,
  ComparisonTimeline,
  ComparisonAI,
  ComparisonPortfolioImpact,
  ComparisonDecisionPanel,
  ComparisonJournalPanel
} from "./sections/ComparisonStubSections";

// Maps a section key to its component. Every section receives the same
// { assetA, assetB, ... } props so layout stays identical across assets.
const REGISTRY = {
  overview: ComparisonOverview,
  price: ComparisonPrice,
  performance: ComparisonPerformance,
  fundamentals: ComparisonFundamentals,
  valuation: ComparisonValuation,
  financials: ComparisonFinancials,
  growth: ComparisonGrowth,
  profitability: ComparisonProfitability,
  quality: ComparisonQuality,
  technical: ComparisonTechnical,
  macro: ComparisonMacro,
  ownership: ComparisonOwnership,
  news: ComparisonNews,
  catalysts: ComparisonCatalysts,
  risks: ComparisonRisks,
  timeline: ComparisonTimeline,
  ai: ComparisonAI,
  portfolioImpact: ComparisonPortfolioImpact,
  decision: ComparisonDecisionPanel,
  journal: ComparisonJournalPanel
};

export function ComparisonCanvas({ section, assetA, assetB, loadingA, loadingB, onOpenSection }) {
  const Comp = REGISTRY[section] || ComparisonOverview;
  return (
    <section className="cmp-canvas" aria-label={section}>
      <Comp
        assetA={assetA}
        assetB={assetB}
        loadingA={loadingA}
        loadingB={loadingB}
        onOpenSection={onOpenSection}
      />
    </section>
  );
}
