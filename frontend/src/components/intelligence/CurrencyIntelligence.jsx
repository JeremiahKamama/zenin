// P10 Currency Intelligence — revenue/prod currency, FX exposure, natural hedge,
// FX risk, FX correlation, USD sensitivity, EM FX, cross-currency. Thin
// IntelligencePanel wrapper. No FX feed wired → honest Unavailable. Portfolio
// aggregates net FX exposure (future).

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const BLOCKS = [
  "Revenue Currency", "Production Currency", "FX Exposure", "Natural Hedge",
  "FX Risk", "FX Correlation", "USD Sensitivity", "Emerging FX", "Cross Currency",
];

export function CurrencyIntelligence({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Currency Intelligence"
      question={`What FX exposure does ${symbol} carry?`}
      kind={kind}
      domain="currency"
      available={false}
      unavailableNote="FX exposure unavailable. No currency/fx feed wired."
    >
      <div className="intel-block-grid">
        {BLOCKS.map((b) => (
          <Panel key={b} title={b}><Ghost label={`${b} unavailable — no FX feed.`} /></Panel>
        ))}
      </div>
    </IntelligencePanel>
  );
}
export default CurrencyIntelligence;
