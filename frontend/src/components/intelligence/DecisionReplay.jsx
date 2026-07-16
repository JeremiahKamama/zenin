// P15 Decision Replay — per-workspace timeline: Research → Recommendation →
// Portfolio → Decision → Outcome → Reflection. Users compare past vs current
// thesis. Thin IntelligencePanel wrapper over ResearchWorkspacePanel +
// assetResearchService. No decision/portfolio feed wired → honest empty.

import React from "react";
import { Panel, Ghost, Timeline } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";

const STAGES = ["Research", "Recommendation", "Portfolio", "Decision", "Outcome", "Reflection"];

export function DecisionReplay({ symbol, kind = "stock" }) {
  return (
    <IntelligencePanel
      title="Decision Replay"
      question={`What was the decision path for ${symbol}, and how did it play out?`}
      kind={kind}
      domain="decision"
      available={false}
      unavailableNote="Decision replay unavailable. Decision/portfolio service not yet wired."
    >
      <Panel title="Timeline"><Timeline items={[]} /><Ghost label="No decision events captured for this asset." /></Panel>
      <Panel title="Stages Registered">
        <div className="ownership-block-list">{STAGES.map((s) => <span key={s} className="intel-tag">{s}</span>)}</div>
      </Panel>
    </IntelligencePanel>
  );
}
export default DecisionReplay;
