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
  ComparisonScenario,
  ComparisonJournalPanel
} from "./sections/ComparisonStubSections";
import { ComparisonDecisionSection } from "./ComparisonMatrix";
import { SharedIntelligence } from "./SharedIntelligence";

// Maps a section key to its component. Every section receives the same
// { assetA, assetB, ... } props so layout stays identical across assets.
const REGISTRY = {
  decision: ComparisonDecisionSection,
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
  shared: SharedIntelligence,
  scenario: ComparisonScenario,
  timeline: ComparisonTimeline,
  ai: ComparisonAI,
  portfolioImpact: ComparisonPortfolioImpact,
  journal: ComparisonJournalPanel
};

export function ComparisonCanvas({ section, assetA, assetB, loadingA, loadingB, matrixRows, verdict, onOpenSection }) {
  const Comp = REGISTRY[section] || ComparisonDecisionSection;
  const isDecision = section === "decision";
  return (
    <section className={`cmp-canvas ${isDecision ? "cmp-canvas-decision" : ""}`.trim()} aria-label={section}>
      <Comp
        assetA={assetA}
        assetB={assetB}
        loadingA={loadingA}
        loadingB={loadingB}
        matrixRows={matrixRows}
        verdict={verdict}
        onOpenSection={onOpenSection}
      />
    </section>
  );
}
