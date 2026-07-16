// P13 Economic Dependency Engine — e.g. Copper depends on China PMI →
// Construction → Infrastructure → Power Demand → Manufacturing → Portfolio.
// Macro workspace publishes dependencies via the Intelligence Bus. Thin
// IntelligencePanel wrapper; uses IntelligenceBus for any live regime/dependency
// signal, else honest Unavailable.

import React from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { IntelligenceBus } from "../../utils/intelligenceBus";

const EXAMPLE_CHAIN = ["Commodity", "China PMI", "Construction", "Infrastructure", "Power Demand", "Manufacturing", "Portfolio"];

export function EconomicDependencyEngine({ symbol, kind = "stock", regimeLabel }) {
  // If a macro regime is published, surface the dependency direction; else unavailable.
  const hasSignal = Boolean(regimeLabel || IntelligenceBus.getRegime?.());
  return (
    <IntelligencePanel
      title="Economic Dependency Engine"
      question={`What macro variables does ${symbol} depend on, and how do they transmit?`}
      kind={kind}
      domain="econdep"
      available={hasSignal}
      unavailableNote="Economic dependencies unavailable. Macro dependency graph not yet published via Intelligence Bus."
    >
      <Panel title="Example Dependency Chain">
        <div className="intel-chain">{EXAMPLE_CHAIN.map((c, i) => (<span key={c}>{c}{i < EXAMPLE_CHAIN.length - 1 ? " → " : ""}</span>))}</div>
        {!hasSignal ? <Ghost label="No macro signal published — chain is illustrative only." /> : null}
      </Panel>
      <Panel title="Model Registered">
        <div className="ownership-block-list"><Badge tone="watch">Macro → Asset transmission</Badge></div>
      </Panel>
    </IntelligencePanel>
  );
}
export default EconomicDependencyEngine;
