import { ComparisonOverview } from "./sections/ComparisonOverview";
import { ComparisonPricePerformance } from "./sections/ComparisonPricePerformance";
import { ComparisonFundamentals } from "./sections/ComparisonFundamentals";
import { ComparisonValuation } from "./sections/ComparisonValuation";
import {
  ComparisonOwnershipNews,
  ComparisonCatalysts,
  ComparisonRisks,
  ComparisonScenario,
  ComparisonPlaceholderFallback
} from "./sections/ComparisonStubSections";
import { ComparisonDecisionSection } from "./ComparisonMatrix";
import { SharedIntelligence } from "./SharedIntelligence";

// Maps a section key to its component. Pruned from 22 → 10 items (C). Every
// section receives the same { assetA, assetB, intelA, intelB, ... } props so
// layout stays identical across assets. One FMP fetch per asset (in the
// Workspace) is shared via intelA/intelB into Decision Matrix + Fundamentals.
const REGISTRY = {
  decision: ComparisonDecisionSection,
  overview: ComparisonOverview,
  pricePerformance: ComparisonPricePerformance,
  valuation: ComparisonValuation,
  fundamentals: ComparisonFundamentals,
  ownershipNews: ComparisonOwnershipNews,
  catalysts: ComparisonCatalysts,
  risks: ComparisonRisks,
  shared: SharedIntelligence,
  scenario: ComparisonScenario
};

export function ComparisonCanvas({
  section,
  assetA,
  assetB,
  loadingA,
  loadingB,
  matrixRows,
  verdict,
  intelA,
  intelB,
  onOpenSection,
  onViewResearch,
}) {
  const Comp = REGISTRY[section] || ComparisonDecisionSection;
  const isDecision = section === "decision";
  return (
    <section className={`cmp-canvas ${isDecision ? "cmp-canvas-decision" : ""}`.trim()} aria-label={section}>
      <Comp
        assetA={assetA}
        assetB={assetB}
        loadingA={loadingA}
        loadingB={loadingB}
        intelA={intelA}
        intelB={intelB}
        matrixRows={matrixRows}
        verdict={verdict}
        onOpenSection={onOpenSection}
        onViewResearch={onViewResearch}
      />
    </section>
  );
}
