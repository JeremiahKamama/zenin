// ETF Profile (reference layer). Descriptive only — no research, no AI.
// Sole owner of reference/fund content (Brand v2). Analytical content lives in
// AssetResearchWorkspace (no duplication).
//
// Real data: CORE_ETF_SEED (issuer / index / objective / category) sourced from
// the single graph seed in utils/assetGraph.js. Live fund metrics (AUM, expense
// ratio, holdings, flows) have no backend feed yet → honest "Unavailable" — never
// fabricated. Structure mirrors CommodityProfilePage (CompactWorkspaceUI).

import { useEffect, useMemo, useState } from "react";
import {
  CompactPageHeader,
  WorkspaceLayout,
  Section,
  Panel,
  MetricStrip,
  Tag,
  Ghost,
  SidebarGroup,
  SidebarItem,
} from "./CompactWorkspaceUI";
import { CORE_ETF_SEED } from "../utils/assetGraph";
import { getAssetKind } from "../utils/assetRegistry";
import { getAdapter } from "../utils/assetAdapters";

export function EtfProfilePage({ symbol, onOpenResearch, onOpenCommodity, onClose }) {
  const sym = String(symbol || "").toUpperCase();
  const [activeView, setActiveView] = useState("overview");
  const [etfSnap, setEtfSnap] = useState(null);

  useEffect(() => {
    let alive = true;
    const adapter = getAdapter("etf");
    if (!adapter) return undefined;
    adapter.fetchSnapshot(sym).then((snap) => { if (alive) setEtfSnap(snap); }).catch(() => {});
    return () => { alive = false; };
  }, [sym]);

  const seed = useMemo(() => CORE_ETF_SEED[sym] || null, [sym]);

  const header = (
    <>
      <CompactPageHeader
        eyebrow={`ETF Profile · ${seed?.category || "Exchange-Traded Fund"}`}
        title={seed?.name || sym}
        meta={sym}
        actions={
          <>
            <button type="button" className="cw-primary-btn" onClick={() => onOpenResearch?.({ symbol: sym })}>Open Research Workspace</button>
            <button type="button" className="cw-ghost-btn" onClick={onClose}>← Desk</button>
          </>
        }
      />
    </>
  );

  const sidebar = (() => {
    const PROFILE_LABELS = { overview: "Overview", holdings: "Holdings", fundDetails: "Fund Details", performance: "Performance", references: "References" };
    const ids = (getAssetKind("etf")?.tiers?.profile) || ["overview", "holdings", "fundDetails", "performance", "references"];
    return (
      <SidebarGroup label="Profile">
        {ids.map((id) => (
          <SidebarItem key={id} label={PROFILE_LABELS[id] || id} active={activeView === id} onClick={() => setActiveView(id)} />
        ))}
      </SidebarGroup>
    );
  })();

  const renderView = () => {
    if (activeView === "holdings") {
      return (
        <Section title="Holdings">
          <Ghost label="Top holdings unavailable — no ETF holdings feed wired (ETF Intelligence / FMP pending)." />
        </Section>
      );
    }
    if (activeView === "fundDetails" || activeView === "fund") {
      return (
        <Section title="Fund Details">
          <MetricStrip items={[
            { label: "Issuer", value: seed?.issuer || "—" },
            { label: "Structure", value: "ETF" },
            { label: "Replication", value: "—" },
            { label: "Expense Ratio", value: "Unavailable" },
            { label: "AUM", value: "Unavailable" },
            { label: "Leverage", value: "—" },
          ]} />
          <Ghost label="Fund structure detail (replication method, creation units, UCITS) unavailable — no fund facts feed wired." />
        </Section>
      );
    }
    if (activeView === "performance") {
      return (
        <Section title="Performance">
          <MetricStrip items={[
            { label: "1Y Return", value: "Unavailable" },
            { label: "Tracking Error", value: "Unavailable" },
            { label: "Distribution", value: "—" },
          ]} />
          <Ghost label="Historical returns / risk unavailable — no NAV/return feed wired." />
        </Section>
      );
    }
    if (activeView === "references" || activeView === "refs") {
      return (
        <Section title="References">
          <ul className="cw-src">
            <li>Issuer: {seed?.issuer || "—"} fund factsheet.</li>
            <li>Underlying index: {seed?.benchmark || "—"}.</li>
            <li>Live data: Zenin ETF feed (pending backend integration).</li>
          </ul>
        </Section>
      );
    }
    // overview
    return (
      <Section title="Overview">
        <MetricStrip items={[
          { label: "Price", value: etfSnap?.price != null ? `$${etfSnap.price.toFixed(2)}` : "Unavailable" },
          { label: "Day", value: etfSnap?.dayChangePct != null ? `${etfSnap.dayChangePct >= 0 ? "+" : ""}${etfSnap.dayChangePct.toFixed(2)}%` : "Unavailable" },
          { label: "Issuer", value: seed?.issuer || "—" },
          { label: "Category", value: seed?.category || "—" },
          { label: "Benchmark", value: seed?.benchmark || "—" },
          { label: "Ticker", value: sym },
          { label: "Exposure", value: (seed?.exposure || []).join(" · ") || "—" },
        ]} />
        <Panel title="Objective">
          <p className="cw-note">{seed ? `${seed.name} tracks ${seed.benchmark || "its benchmark"}, classified as ${seed.category}. Reference view — open the Research Workspace for analytical content.` : `No reference metadata for ${sym}.`}</p>
        </Panel>
      </Section>
    );
  };

  return (
    <WorkspaceLayout header={header} sidebar={sidebar}>
      {renderView()}
    </WorkspaceLayout>
  );
}
