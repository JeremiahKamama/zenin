// P12 Risk Engine — universal per-asset risk. Each risk: Score / Evidence /
// Confidence / History. Thin IntelligencePanel wrapper. No risk engine wired →
// honest Unavailable per dimension.

import React from "react";
import { Panel, Ghost, Badge, RiskCard } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const RISKS = [
  "Political", "Regulatory", "Supply Chain", "Commodity", "Liquidity",
  "FX", "Interest Rates", "Climate", "Cyber", "Legal", "Credit",
  "Concentration", "Counterparty",
];

export function RiskEngine({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Risk Engine"
      question={`What risks apply to ${symbol}, and how severe?`}
      kind={kind}
      domain="risk"
      available={false}
      unavailableNote="Risk scores unavailable. Risk engine not yet wired."
    >
      <div className="intel-block-grid">
        {RISKS.map((r) => (
          <Panel key={r} title={r}><Ghost label={`${r} score unavailable.`} /></Panel>
        ))}
      </div>
      <Panel title="Risk Dimensions Registered">
        <div className="ownership-block-list">{RISKS.map((r) => <Badge key={r} tone="watch">{r}</Badge>)}</div>
      </Panel>
    </IntelligencePanel>
  );
}
export default RiskEngine;
