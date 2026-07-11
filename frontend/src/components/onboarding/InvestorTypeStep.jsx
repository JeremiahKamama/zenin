import { OptionCard, StepPanel } from "./primitives";

const TYPES = [
  { key: "individual_investor", label: "Individual Investor", description: "Managing personal capital." },
  { key: "long_term_investor", label: "Long-term Investor", description: "Multi-year, conviction-led holds." },
  { key: "active_trader", label: "Active Trader", description: "Frequent entries and exits." },
  { key: "research_analyst", label: "Research Analyst", description: "Deep-dive company and macro work." },
  { key: "financial_advisor", label: "Financial Advisor", description: "Advising external clients." },
  { key: "family_office", label: "Family Office", description: "Multi-asset, multi-generational." },
  { key: "investment_team", label: "Investment Team", description: "Shared desk and workflow." },
];

export function InvestorTypeStep({ answers, update }) {
  return (
    <StepPanel
      eyebrow="Profile"
      title="What best describes you?"
      description="We use this to configure your default workspace layout and research flow."
    >
      <div className="ob-opt-grid ob-opt-2">
        {TYPES.map((t) => (
          <OptionCard
            key={t.key}
            title={t.label}
            description={t.description}
            selected={answers.persona === t.key}
            onClick={() => update({ persona: t.key })}
          />
        ))}
      </div>
    </StepPanel>
  );
}

export default InvestorTypeStep;
