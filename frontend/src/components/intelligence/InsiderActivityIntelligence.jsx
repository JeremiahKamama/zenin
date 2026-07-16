// InsiderActivityIntelligence — Form 4 insider activity (Document Intelligence).
// Consumes useDocumentIntelligence.insiders. Honest Ghost when unwired.

import React from "react";
import { Panel, MetricStrip, Badge, Ghost, Timeline } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

function net(trades = []) {
  let buy = 0, sell = 0;
  for (const t of trades) {
    const v = Number(t.shares || 0);
    if (t.transactionType === "P" || t.acquired) buy += v;
    else if (t.transactionType === "S" || t.disposed) sell += v;
  }
  return { buy, sell };
}

export function InsiderActivityIntelligence({ symbol, kind = "stock" }) {
  const di = useDocumentIntelligence(symbol);
  const ins = di.insiders;
  const trades = Array.isArray(ins?.trades) ? ins.trades : [];
  const { buy, sell } = net(trades);

  return (
    <IntelligencePanel
      title="Insider Activity"
      question={`Who inside ${symbol} is buying or selling, and how much?`}
      kind={kind}
      domain="insider"
      available={Boolean(ins)}
      unavailableNote="Insider activity unavailable. Form 4 feed (Document Intelligence) not yet wired."
    >
      <div className="insider-grid">
        <Panel title="Recent Form 4">
          {trades.length ? (
            <Timeline items={trades.slice(0, 8).map((t) => ({
              id: t.id || `${t.insider}-${t.filedAt}`,
              kind: t.transactionType === "P" ? "buy" : t.transactionType === "S" ? "sell" : "insider",
              title: `${t.insider || t.insiderType || "Insider"} — ${t.transactionType === "P" ? "Buy" : t.transactionType === "S" ? "Sell" : "File"} ${t.shares || ""} sh`,
              time: t.filedAt || t.date,
              meta: t.title || t.role,
            }))} />
          ) : <Ghost label="No Form 4 filings captured." />}
        </Panel>
        <Panel title="Net Activity">
          <MetricStrip items={[
            { label: "Net Buying", value: buy ? `+${buy.toLocaleString()}` : "—" },
            { label: "Net Selling", value: sell ? `-${sell.toLocaleString()}` : "—" },
            { label: "Recent Filings", value: trades.length || "—" },
          ]} />
          <div className="insider-roles">
            {(ins?.byRole || ["CEO", "CFO", "Director", "Officer"]).map((r) => (
              <Badge key={r} tone="watch">{r}</Badge>
            ))}
          </div>
        </Panel>
      </div>
    </IntelligencePanel>
  );
}

export default InsiderActivityIntelligence;
