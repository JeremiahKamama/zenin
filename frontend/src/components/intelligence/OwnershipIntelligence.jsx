// OwnershipIntelligence — Phase 1 (Ownership Intelligence) exemplar.
//
// Registry-driven, bus-aware, provenance-exposing panel. Now consumes the
// Document Intelligence provider (13F institutional ownership + Form 4 insiders)
// via useDocumentIntelligence. When the provider is wired, the panel populates;
// when not, it degrades to the honest Unavailable state — never fabricates.
//
// Principle 2: the ownership source is DOCUMENT_INTELLIGENCE (SEC_API_PROVIDER
// impl). This panel is provider-agnostic.

import React from "react";
import { Panel, MetricStrip, Table, Badge, Ghost } from "../CompactWorkspaceUI";
import { IntelligencePanel } from "./IntelligencePanel";
import { buildProvenance } from "../../utils/DataCoverageRegistry";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

export function OwnershipIntelligence({ symbol, kind = "stock" }) {
  const prov = buildProvenance(kind, "ownership");
  const di = useDocumentIntelligence(symbol);
  const own = di.ownership;
  const ins = di.insiders;

  const holders = Array.isArray(own?.holders) ? own.holders : [];
  const trend = Array.isArray(own?.trend) ? own.trend : [];
  const changes = Array.isArray(own?.recentChanges) ? own.recentChanges : [];
  const available = di.available && (own?.institutionalPct != null || holders.length);

  return (
    <IntelligencePanel
      title="Ownership Intelligence"
      question={`Who owns ${symbol || "this asset"}? How concentrated is ownership, and how has it changed?`}
      kind={kind}
      domain="ownership"
      available={available}
      unavailableNote="Institutional ownership unavailable. Document Intelligence (13F) not yet wired."
    >
      <div className="ownership-grid">
        <Panel title="Institutional Ownership">
          {own?.institutionalPct != null ? (
            <MetricStrip items={[
              { label: "Institutional %", value: `${(own.institutionalPct * 100).toFixed(1)}%` },
              { label: "Top-5 Concentration", value: own.top5Concentration != null ? `${(own.top5Concentration * 100).toFixed(1)}%` : "—" },
            ]} />
          ) : <Ghost label="Institutional % unavailable — Document Intelligence (13F) not yet wired." />}
        </Panel>
        <Panel title="Top Holders">
          {holders.length ? (
            <Table
              columns={["Holder", "% Out", "Change"]}
              rows={holders.slice(0, 8).map((h) => [h.name, h.pct != null ? `${(h.pct * 100).toFixed(2)}%` : "—", h.change != null ? `${h.change > 0 ? "+" : ""}${(h.change * 100).toFixed(2)}%` : "—"])}
            />
          ) : <Ghost label="Top holders unavailable — no 13F feed." />}
        </Panel>
        <Panel title="Passive vs Active">
          {own?.passivePct != null ? (
            <MetricStrip items={[{ label: "Passive", value: `${(own.passivePct * 100).toFixed(1)}%` }, { label: "Active", value: `${(100 - own.passivePct * 100).toFixed(1)}%` }]} />
          ) : <Ghost label="Passive/active split unavailable." />}
        </Panel>
        <Panel title="Insider Holdings">
          {ins?.insiderPct != null ? <MetricStrip items={[{ label: "Insider %", value: `${(ins.insiderPct * 100).toFixed(2)}%` }]} /> : <Ghost label="Insider holdings unavailable." />}
        </Panel>
        <Panel title="Ownership Trend">
          {trend.length ? (
            <Table columns={["Period", "% Inst"]} rows={trend.slice(-6).map((t) => [t.period || t.date, t.pct != null ? `${(t.pct * 100).toFixed(1)}%` : "—"])} />
          ) : <Ghost label="Ownership trend unavailable — no historical 13F series." />}
        </Panel>
        <Panel title="Recent Changes">
          {changes.length ? changes.slice(0, 6).map((c, i) => <div key={i} className="ownership-change">{c.holder} {c.dir === "up" ? "▲" : "▼"} {(c.pct * 100).toFixed(2)}%</div>) : <Ghost label="No recent changes." />}
        </Panel>
        <Panel title="Concentration (HHI)">
          {own?.hhi != null ? <MetricStrip items={[{ label: "HHI", value: own.hhi.toLocaleString() }, { label: "Largest Buyer", value: own.largestBuyer || "—" }, { label: "Largest Seller", value: own.largestSeller || "—" }]} /> : <Ghost label="Concentration (HHI) unavailable." />}
        </Panel>
      </div>
      <MetricStrip
        items={[
          { label: "Coverage", value: `${prov.coveragePct}%` },
          { label: "Confidence", value: `${prov.confidencePct}%` },
          { label: "Institutional", value: own?.institutionalPct != null ? `${(own.institutionalPct * 100).toFixed(1)}%` : "Unavailable" },
          { label: "Top-5", value: own?.top5Concentration != null ? `${(own.top5Concentration * 100).toFixed(1)}%` : "Unavailable" },
        ]}
      />
    </IntelligencePanel>
  );
}

export default OwnershipIntelligence;
