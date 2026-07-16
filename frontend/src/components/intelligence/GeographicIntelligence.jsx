// P3 Geographic Intelligence — revenue/production/country risk per asset.
// Thin IntelligencePanel wrapper. No geo feed wired → honest Unavailable.

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const BLOCKS = [
  "Revenue Exposure", "Production Footprint", "Country Risk", "Manufacturing Locations",
  "Sales Mix", "Import", "Export", "Regional Growth", "Regional Inflation",
  "Regional Currency", "Political Risk",
];

export function GeographicIntelligence({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Geographic Intelligence"
      question={`Where is ${symbol} exposed geographically, and what country risk applies?`}
      kind={kind}
      domain="geo"
      available={false}
      unavailableNote="Geographic exposure unavailable. Company filings / World Bank / IMF not yet wired."
    >
      <div className="intel-block-grid">
        {BLOCKS.map((b) => (
          <Panel key={b} title={b}><Ghost label={`${b} unavailable — no geographic feed.`} /></Panel>
        ))}
      </div>
    </IntelligencePanel>
  );
}
export default GeographicIntelligence;
