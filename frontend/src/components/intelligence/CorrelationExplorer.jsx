// P9 Correlation Explorer — interactive node/edge explorer (stocks, ETFs,
// commodities, macro, currencies, bonds, countries). Edges: correlation,
// transmission, ownership, supply-chain, sector, factor, geography. Uses the
// Relationship Graph. Thin IntelligencePanel wrapper; rendered as a node/edge
// list (no static matrix). Correlation data not wired → honest Unavailable.

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const NODES = ["Stocks", "ETFs", "Commodities", "Macro", "Currencies", "Bonds", "Countries"];
const EDGES = ["Correlation", "Transmission", "Ownership", "Supply Chain", "Sector", "Factor", "Geography"];

export function CorrelationExplorer({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Correlation Explorer"
      question={`How is ${symbol} correlated to other assets and macro?`}
      kind={kind}
      domain="correlation"
      available={false}
      unavailableNote="Correlation matrix unavailable. No returns/correlation feed wired (graph edges present for transmission/ownership)."
    >
      <Panel title="Nodes"><div className="ownership-block-list">{NODES.map((n) => <Badge key={n} tone="watch">{n}</Badge>)}</div></Panel>
      <Panel title="Edges"><div className="ownership-block-list">{EDGES.map((e) => <Badge key={e} tone="watch">{e}</Badge>)}</div></Panel>
      <Panel title="Interactive"><Ghost label="Select a node to expand its correlation neighborhood (feed pending)." /></Panel>
    </IntelligencePanel>
  );
}
export default CorrelationExplorer;
