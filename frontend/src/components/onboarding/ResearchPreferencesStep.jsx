import { OptionCard, StepPanel } from "./primitives";

// Spec's research-profile language (Growth/Value/Macro/Trading/Income),
// mapped onto the engine's existing researchStyle keys.
const PROFILES = [
  { key: "growth", label: "Growth", description: "Momentum, expanding margins." },
  { key: "value", label: "Value", description: "Cash flows, downside." },
  { key: "macro", label: "Macro", description: "Rates, FX, regime." },
  { key: "trading", label: "Trading", description: "Levels, flow, structure." },
  { key: "income", label: "Income", description: "Yield, coverage, durability." },
];

const HORIZONS = [
  { key: "intraday", label: "Intraday" },
  { key: "swing", label: "Swing" },
  { key: "long_term", label: "Long-term" },
  { key: "multi_year", label: "Multi-year" },
];

const LAYOUTS = [
  { key: "research_first", label: "Research First" },
  { key: "portfolio_first", label: "Portfolio First" },
  { key: "dashboard_first", label: "Dashboard First" },
];

export function ResearchPreferencesStep({ answers, update }) {
  return (
    <StepPanel
      eyebrow="Research"
      title="How do you analyze?"
      description="These tune the Asset Research Workspace to your lens."
    >
      <p className="ob-subhead">Primary research style</p>
      <div className="ob-opt-grid ob-opt-3">
        {PROFILES.map((s) => (
          <OptionCard key={s.key} title={s.label} description={s.description} selected={answers.researchStyle === s.key} onClick={() => update({ researchStyle: s.key })} />
        ))}
      </div>
      <p className="ob-subhead">Investment horizon</p>
      <div className="ob-opt-grid ob-opt-4">
        {HORIZONS.map((h) => (
          <OptionCard key={h.key} title={h.label} selected={answers.horizon === h.key} onClick={() => update({ horizon: h.key })} />
        ))}
      </div>
      <p className="ob-subhead">Preferred layout</p>
      <div className="ob-opt-grid ob-opt-3">
        {LAYOUTS.map((l) => (
          <OptionCard key={l.key} title={l.label} selected={answers.layout === l.key} onClick={() => update({ layout: l.key })} />
        ))}
      </div>
    </StepPanel>
  );
}

export default ResearchPreferencesStep;
