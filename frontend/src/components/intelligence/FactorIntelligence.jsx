// P7 Factor Intelligence — growth/value/quality/momentum/low-vol/dividend/
// profitability/investment/size/carry/duration/commodity-beta/fx-beta. Thin
// IntelligencePanel wrapper. No factor feed wired → honest Unavailable. Portfolio
// aggregates factors (future) once holdings feed exists.

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const FACTORS = [
  "Growth", "Value", "Quality", "Momentum", "Low Vol", "Dividend",
  "Profitability", "Investment", "Size", "Carry", "Duration",
  "Commodity Beta", "FX Beta",
];

export function FactorIntelligence({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Factor Intelligence"
      question={`What factor exposures drive ${symbol}?`}
      kind={kind}
      domain="factor"
      available={false}
      unavailableNote="Factor model unavailable. No factor/returns feed wired."
    >
      <div className="intel-block-grid">
        {FACTORS.map((f) => (
          <Panel key={f} title={f}><Ghost label={`${f} exposure unavailable.`} /></Panel>
        ))}
      </div>
      <Panel title="Factors Registered">
        <div className="ownership-block-list">{FACTORS.map((f) => <Badge key={f} tone="watch">{f}</Badge>)}</div>
      </Panel>
    </IntelligencePanel>
  );
}
export default FactorIntelligence;
