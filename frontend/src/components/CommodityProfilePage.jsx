// Commodity Profile (reference layer). Descriptive only — no research, no AI.
// Sole owner of reference/contract content (Brand v2). Analytical content lives
// in CommodityResearchWorkspace (no duplication).
//
// Real data: /api/commodities/list (overview) + curated reference map for
// contract/exchange/producers/consumers/ETFs/countries. Honest "Not mapped"
// where no reference exists — never fabricated.

import { useEffect, useMemo, useState } from "react";
import {
  CompactPageHeader,
  WorkspaceLayout,
  Section,
  Panel,
  MetricStrip,
  MetricCard,
  Tag,
  Ghost,
  SidebarGroup,
  SidebarItem,
} from "./CompactWorkspaceUI";
import { zeninFetchJson } from "../utils/zeninFetch";
import { HOSTED_BACKEND_URL } from "../constants/apiConfig";
import { getCommodityRelations } from "../utils/assetGraph";
import { CommodityTransmissionContext } from "../transmission/TransmissionSurfaces";
import { CommodityBreadcrumbs } from "./CommodityBreadcrumbs";
// Contract/reference metadata (tick/unit/delivery/settlement) now sourced from
// the single graph seed in utils/assetGraph.js — no local duplicate.
export function CommodityProfilePage({ symbol, onOpenResearch, onOpenCompanyProfile, onClose }) {
  const sym = String(symbol || "").toUpperCase();
  const [row, setRow] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState("overview");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const list = await zeninFetchJson(`${HOSTED_BACKEND_URL}/api/commodities/list`).catch(() => null);
        if (!alive) return;
        const items = Array.isArray(list?.list) ? list.list : Array.isArray(list) ? list : [];
        const found = items.find((r) => String(r.symbol || r.id || "").toUpperCase() === sym)
          || items.find((r) => String(r.name || "").toUpperCase() === sym);
        setRow(found || null);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [sym]);

  const rel = getCommodityRelations(sym);

  const header = (
    <>
      <CommodityBreadcrumbs
        symbol={sym}
        group={rel.category || row?.category || "Commodity"}
        view="profile"
        source="Watchlist"
        onOpenView={() => onOpenResearch?.({ symbol: sym })}
        onSource={onClose}
      />
      <CompactPageHeader
        eyebrow={`Commodity Profile · ${rel.category || row?.category || "Commodity"}`}
      title={row?.name || sym}
      meta={rel.exchange ? `${rel.exchange}` : ""}
      actions={
        <>
          <button type="button" className="cw-primary-btn" onClick={() => onOpenResearch?.({ symbol: sym })}>Open Research Workspace</button>
          <button type="button" className="cw-ghost-btn" onClick={onClose}>← Desk</button>
        </>
      }
    />
    </>
  );

  const sidebar = (
    <>
      <SidebarGroup label="Profile">
        <SidebarItem label="Overview" active={activeView === "overview"} onClick={() => setActiveView("overview")} />
        <SidebarItem label="Contract Details" active={activeView === "contract"} onClick={() => setActiveView("contract")} />
        <SidebarItem label="Market Structure" active={activeView === "structure"} onClick={() => setActiveView("structure")} />
        <SidebarItem label="Related Assets" active={activeView === "related"} onClick={() => setActiveView("related")} />
        <SidebarItem label="Historical Stats" active={activeView === "stats"} onClick={() => setActiveView("stats")} />
        <SidebarItem label="References" active={activeView === "refs"} onClick={() => setActiveView("refs")} />
      </SidebarGroup>
    </>
  );

  const renderView = () => {
    if (loading) return <Panel title="Loading"><Ghost label="Fetching commodity reference…" /></Panel>;

    if (activeView === "contract") {
      return (
        <Section title="Contract Details">
          <MetricStrip items={[
            { label: "Exchange", value: rel.exchange || "—" },
            { label: "Ticker", value: sym },
            { label: "Tick Size", value: rel.tick != null ? rel.tick : "—" },
            { label: "Currency", value: "USD" },
            { label: "Settlement", value: rel.settlement || "—" },
            { label: "Delivery", value: rel.delivery || "—" },
          ]} />
        </Section>
      );
    }
    if (activeView === "structure") {
      return (
        <Section title="Market Structure">
          <Panel title="Producers"><div className="cw-rel-grid">{(rel.companies || []).map((c) => <Tag key={c}>{c}</Tag>) || <Ghost label="Not mapped" />}</div></Panel>
          <Panel title="Consumers / Importers / Exporters"><div className="cw-rel-grid">{(rel.countries || []).map((c) => <Tag key={c}>{c}</Tag>) || <Ghost label="Not mapped" />}</div></Panel>
          <Panel title="Warehouses / Storage"><Ghost label="Facility map unavailable" /></Panel>
        </Section>
      );
    }
    if (activeView === "related") {
      return (
        <Section title="Related Assets">
          <Panel title="Mining / Energy Companies">
            {(rel.companies || []).map((c) => (
              <div key={c} className="cw-rel-row" role="button" tabIndex={0} onClick={() => onOpenCompanyProfile?.({ symbol: c })}>{c} <span className="cw-rel-go">→</span></div>
            )) || <Ghost label="Not mapped" />}
          </Panel>
          <Panel title="Commodity ETFs"><div className="cw-rel-grid">{(rel.etfs || []).map((c) => <Tag key={c}>{c}</Tag>) || <Ghost label="Not mapped" />}</div></Panel>
          <Panel title="Country Exposure"><div className="cw-rel-grid">{(rel.countries || []).map((c) => <Tag key={c}>{c}</Tag>) || <Ghost label="—" />}</div></Panel>
          <Panel title="Currencies / Indexes"><div className="cw-rel-grid">{[...rel.currencies || [], ...rel.indexes || []].map((c) => <Tag key={c}>{c}</Tag>) || <Ghost label="—" />}</div></Panel>
        </Section>
      );
    }
    if (activeView === "stats") {
      return (
        <Section title="Historical Statistics">
          <MetricStrip items={[
            { label: "Avg Volatility", value: "—" },
            { label: "Historical Return", value: "—" },
            { label: "Avg Drawdown", value: "—" },
            { label: "Avg Inventory", value: "—" },
          ]} />
          <Ghost label="Historical statistics unavailable — no multi-year feed" />
        </Section>
      );
    }
    if (activeView === "refs") {
      return (
        <Section title="References">
          <ul className="cw-src">
            <li>Exchange: {rel.exchange || "—"} specification docs.</li>
            <li>Supply-demand: USDA WASDE (official).</li>
            <li>Live quote: Zenin commodity feed (/api/commodities/list).</li>
          </ul>
        </Section>
      );
    }
    // overview
    return (
      <Section title="Overview">
        <MetricStrip items={[
          { label: "Category", value: rel.category || row?.category || "—" },
          { label: "Exchange", value: rel.exchange || "—" },
          { label: "Contract", value: sym },
          { label: "Unit", value: rel.unit || "—" },
          { label: "Currency", value: "USD" },
        ]} />
        <Panel title="Description">
          <p className="cw-note">{row?.description || `${rel.category || "Commodity"} traded on ${rel.exchange || "major exchange"}. Reference view — open the Research Workspace for analytical content.`}</p>
        </Panel>
      </Section>
    );
  };

  return (
    <WorkspaceLayout header={header} sidebar={sidebar} rail={
      <CommodityTransmissionContext driver={symbol} horizonLabel="Immediate" />
    }>
      {renderView()}
    </WorkspaceLayout>
  );
}
