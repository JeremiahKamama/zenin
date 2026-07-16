// P11 Consensus Intelligence — analyst ratings / target prices / estimate
// revisions / recommendation trend / dispersion / revenue & EPS revisions /
// surprise history. Thin IntelligencePanel wrapper. No consensus feed wired →
// honest Unavailable.

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const BLOCKS = [
  "Analyst Ratings", "Target Prices", "Estimate Revisions", "Recommendation Trend",
  "Estimate Dispersion", "Revenue Revisions", "EPS Revisions", "Surprise History",
];

export function ConsensusIntelligence({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Consensus Intelligence"
      question={`What is the analyst consensus on ${symbol}?`}
      kind={kind}
      domain="consensus"
      available={false}
      unavailableNote="Consensus data unavailable. Yahoo / FMP / Polygon not yet wired."
    >
      <div className="intel-block-grid">
        {BLOCKS.map((b) => (
          <Panel key={b} title={b}><Ghost label={`${b} unavailable — no consensus feed.`} /></Panel>
        ))}
      </div>
    </IntelligencePanel>
  );
}
export default ConsensusIntelligence;
