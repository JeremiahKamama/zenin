// P2 Supply Chain Intelligence — Company → Supplier → Commodity → Country →
// Shipping Lane → Portfolio. Thin wrapper over IntelligencePanel (universal
// reliability layer). No supply-chain feed wired → honest Unavailable states.
// Relationship Graph edges (company→commodity) exist but are sparse; this panel
// declares intent and degrades gracefully.

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const BLOCKS = [
  "Major Suppliers", "Largest Customers", "Country Dependencies", "Shipping Routes",
  "Raw Materials", "Commodity Dependencies", "Energy Dependencies", "Logistics Risks",
  "Supply Chain Concentration", "Alternative Suppliers",
];

export function SupplyChainIntelligence({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Supply Chain Intelligence"
      question={`How does ${symbol} depend on suppliers, commodities, countries, and shipping?`}
      kind={kind}
      domain="supplychain"
      available={false}
      unavailableNote="Supply-chain mapping unavailable. Company filings / SEC / curated mappings not yet wired."
    >
      <div className="intel-block-grid">
        {BLOCKS.map((b) => (
          <Panel key={b} title={b}><Ghost label={`${b} unavailable — no supply-chain feed.`} /></Panel>
        ))}
      </div>
      <Panel title="Sub-panels Registered">
        <div className="ownership-block-list">{BLOCKS.map((b) => <Badge key={b} tone="watch">{b}</Badge>)}</div>
      </Panel>
    </IntelligencePanel>
  );
}
export default SupplyChainIntelligence;
