// P8 Portfolio Overlap Engine — trace an asset's overlap into the portfolio via
// Direct / Indirect / Hidden / Duplicated / Synthetic paths (ETF / Commodity /
// Sector / Country / Currency / Macro). Uses the Relationship Graph. Thin
// IntelligencePanel wrapper; graph seeds exist (company→commodity) but portfolio
// holdings feed is not wired, so overlap resolves to honest Unavailable.

import React, { useMemo } from "react";
import { Panel, Ghost, Badge } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { getRelated, NODE_KIND } from "../../utils/relationshipGraph";

const PATHS = ["Direct", "Indirect", "Hidden", "Duplicated", "Synthetic", "ETF", "Commodity", "Sector", "Country", "Currency", "Macro"];

export function PortfolioOverlapEngine({ symbol, kind = "stock" }) {
  // Defensive: relationshipGraph may return undefined for unmapped nodes.
  let related = [];
  try {
    related = getRelated?.(symbol, NODE_KIND.COMPANY) || [];
  } catch { related = []; }
  const hasGraph = Array.isArray(related) && related.length > 0;

  return (
    <IntelligencePanel
      title="Portfolio Overlap Engine"
      question={`How does ${symbol} overlap your portfolio — directly and indirectly?`}
      kind={kind}
      domain="overlap"
      available={hasGraph}
      unavailableNote="Overlap unavailable. Portfolio holdings feed not wired (Relationship Graph seeds present but no book)."
    >
      <Panel title="Example: Copper → BHP → RIO → FCX → XME ETF → Portfolio">
        <div className="intel-chain">
          {["Copper", "BHP", "RIO", "FCX", "XME ETF", "Portfolio"].map((c, i) => (
            <span key={c}>{c}{i < 5 ? " → " : ""}</span>
          ))}
        </div>
        {!hasGraph ? <Ghost label="No holdings feed — overlap paths cannot be computed." /> : null}
      </Panel>
      <Panel title="Overlap Paths Registered">
        <div className="ownership-block-list">{PATHS.map((p) => <Badge key={p} tone="watch">{p}</Badge>)}</div>
      </Panel>
    </IntelligencePanel>
  );
}
export default PortfolioOverlapEngine;
