import { OptionCard, StepPanel } from "./primitives";

const MARKETS = [
  { key: "us_equities", label: "Stocks", description: "US & global equities" },
  { key: "crypto", label: "Crypto", description: "Spot & derivatives" },
  { key: "macro", label: "Macro", description: "Indices, FX, rates" },
  { key: "options", label: "Options", description: "Chains & flow" },
  { key: "bonds", label: "Bonds", description: "Credit & duration" },
  { key: "commodities", label: "Commodities", description: "Metals & energy" },
  { key: "europe", label: "Europe", description: "LSE, XETRA, EU" },
  { key: "asia", label: "Asia", description: "JP, HK, SG" },
];

export function MarketSelectionStep({ answers, update }) {
  const selected = Array.isArray(answers.markets) ? answers.markets : [];
  const toggle = (key) => {
    const next = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
    update({ markets: next });
  };
  return (
    <StepPanel
      eyebrow="Coverage"
      title="Which markets matter most?"
      description="Each selection lights up a module in your workspace — watchlist, research, briefings, and alerts."
    >
      <div className="ob-opt-grid ob-opt-3">
        {MARKETS.map((m) => (
          <OptionCard
            key={m.key}
            multi
            title={m.label}
            description={m.description}
            selected={selected.includes(m.key)}
            onClick={() => toggle(m.key)}
          />
        ))}
      </div>
    </StepPanel>
  );
}

export default MarketSelectionStep;
