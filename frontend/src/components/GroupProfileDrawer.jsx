// Group Profile drawer — commodity group intelligence surface (spec P7).
// Not a new page: a right-rail drawer. Reuses existing components/patterns:
//  - commodityGroups.ts (members, one source of truth)
//  - relationshipGraph.getRelated (related companies/ETFs/currencies for the group's lead symbol)
//  - groupTransmission.ts (demand/supply drivers + macro transmission chain)
//  - TransmissionSurfaces.OpenExplorerButton (opens the SAME Explorer as everywhere)
// Brand v2: monochrome, hairline dividers, honest "—" / "Unavailable" fallbacks.

import React from "react";
import { getGroupDef, getGroupSymbols } from "../utils/commodityGroups";
import { getRelated } from "../utils/relationshipGraph";
import { getGroupDrivers, getGroupTransmissionChain } from "../utils/groupTransmission";
import { OpenExplorerButton } from "../transmission/TransmissionSurfaces";

function Section({ title, children }) {
  return (
    <div className="gp-section">
      <div className="gp-section-title">{title}</div>
      {children}
    </div>
  );
}

function TagList({ items, onItem, empty = "—" }) {
  if (!items || !items.length) return <div className="gp-muted">{empty}</div>;
  return (
    <div className="gp-tags">
      {items.map((it) => (
        <button key={it} type="button" className="gp-tag" onClick={() => onItem && onItem(it)}>
          {it}
        </button>
      ))}
    </div>
  );
}

export function GroupProfileDrawer({ group, onClose, onOpenCompanyProfile, onOpenResearch }) {
  const def = getGroupDef(group);
  if (!def) return null;
  const symbols = getGroupSymbols(group);
  const lead = symbols.find((s) => !/proxy/i.test(s)) || symbols[0] || null;
  const related = lead ? getRelated(lead) : { companies: [], etfs: [], currencies: [], countries: [] };
  const drivers = getGroupDrivers(group);
  const chain = getGroupTransmissionChain(group);

  return (
    <aside className="gp-drawer analytics-desk-panel" role="dialog" aria-label={`${def.label} group profile`}>
      <div className="gp-head">
        <div>
          <div className="gp-eyebrow">GROUP PROFILE</div>
          <h3 className="gp-title">{def.label}</h3>
        </div>
        <button type="button" className="gp-close" onClick={onClose} aria-label="Close group profile">✕</button>
      </div>

      <div className="gp-body">
        <Section title="Overview">
          <p className="gp-muted">
            {`${def.label} complex — ${symbols.length} tracked contract${symbols.length === 1 ? "" : "s"}. `}
            {def.inventorySources.join(", ") ? `Inventory authorities: ${def.inventorySources.join(", ")}.` : ""}
          </p>
        </Section>

        <Section title="Major Contracts">
          <TagList items={symbols} empty="No mapped symbols" />
        </Section>

        <Section title="Related Companies">
          <TagList
            items={related.companies}
            onItem={(c) => onOpenCompanyProfile && onOpenCompanyProfile({ symbol: c })}
            empty="Not mapped"
          />
        </Section>

        <Section title="Related ETFs">
          <TagList items={related.etfs} empty="Not mapped" />
        </Section>

        <Section title="Related Currencies / Countries">
          <TagList items={[...(related.currencies || []), ...(related.countries || [])]} empty="Not mapped" />
        </Section>

        <Section title="Demand Drivers">
          <TagList items={drivers.demand} empty="—" />
        </Section>

        <Section title="Supply Queue Themes">
          <TagList items={drivers.supply} empty="—" />
        </Section>

        <Section title="Weather Themes">
          <TagList items={drivers.weather} empty="—" />
        </Section>

        <Section title="Inventory Authorities">
          <TagList items={drivers.inventory} empty="—" />
        </Section>

        <Section title="Group Transmission">
          {chain.length ? (
            <ol className="gp-chain">
              {chain.map((node, i) => (
                <li key={`${node}-${i}`} className="gp-chain-node">
                  <span>{node}</span>
                  {i < chain.length - 1 ? <span className="gp-chain-arrow">↓</span> : null}
                </li>
              ))}
            </ol>
          ) : (
            <div className="gp-muted">No transmission path mapped</div>
          )}
          <div className="gp-chain-foot">
            <OpenExplorerButton node={chain[0] || def.label} context={{ source: "group", group: group }} label="Open Transmission" />
          </div>
        </Section>
      </div>
    </aside>
  );
}

export default GroupProfileDrawer;

// Compact group-context strip for the desk surface (under Supply Shock Queue).
// Surfaces the selected group's inventory authorities + weather themes from the
// single source of truth. Clearly framed as reference context — never fabricated.
export function GroupContextStrip({ group }) {
  const def = getGroupDef(group);
  if (!def) return null;
  const inv = def.inventorySources || [];
  const wx = def.weatherThemes || [];
  return (
    <div className="analytics-desk-panel gp-context-strip">
      <div className="analytics-commodity-panel-head">
        <div>
          <span>{def.label} Context</span>
          <strong>Reference authorities &amp; weather drivers</strong>
        </div>
      </div>
      <div className="gp-context-grid">
        <div>
          <div className="gp-context-label">Inventory Authorities</div>
          <div className="gp-tags">
            {inv.length ? inv.map((s) => <span key={s} className="gp-tag gp-tag-static">{s}</span>) : <span className="gp-muted">—</span>}
          </div>
        </div>
        <div>
          <div className="gp-context-label">Weather Themes</div>
          <div className="gp-tags">
            {wx.length ? wx.map((s) => <span key={s} className="gp-tag gp-tag-static">{s}</span>) : <span className="gp-muted">—</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

