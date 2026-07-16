// EtfDiscovery — Rec 4: first-class ETF discovery/browse surface.
// Browses CORE_ETF_SEED by facet (asset class / sector / country / theme /
// dividend / growth / value / momentum / ESG / commodity / currency / bond /
// leveraged / inverse / smart beta / factor). Every result supports quick
// preview, compare, watchlist, open-research, portfolio-overlap — all via
// callbacks. Monochrome, token-driven. No fabrication (seed only).
import { useMemo, useState } from "react";
import { browseEtfs, ETF_FACETS } from "../utils/etfIntelligence";

const FACET_VALUES = {
  assetClass: [["equity", "Equity"], ["bond", "Bond"], ["commodity", "Commodity"]],
  sector: [["technology", "Technology"], ["growth", "Growth"], ["small cap", "Small Cap"], ["broad us", "Broad US"], ["international", "International"], ["emerging", "Emerging"], ["china", "China"], ["fixed income", "Fixed Income"], ["rates", "Rates"]],
  country: [["china", "China"], ["international", "International"], ["emerging", "Emerging Markets"], ["global", "Global"], ["us", "US"]],
  theme: [["thematic", "Thematic"], ["innovation", "Innovation"], ["china", "China"]],
  dividend: [["dividend", "Dividend"], ["income", "Income"]],
  growth: [["growth", "Growth"]],
  value: [["value", "Value"]],
  momentum: [["momentum", "Momentum"]],
  esg: [["esg", "ESG"], ["sustain", "Sustainable"]],
  commodity: [["gold", "Gold"], ["silver", "Silver"], ["commodity", "Commodity"]],
  currency: [["currency", "Currency"], ["usd", "USD"], ["hedged", "Hedged"]],
  bond: [["bond", "Bond"], ["treasury", "Treasury"], ["fixed income", "Fixed Income"]],
  leveraged: [["leveraged", "Leveraged"], ["2x", "2x"], ["3x", "3x"]],
  inverse: [["inverse", "Inverse"], ["short", "Short"]],
  smartBeta: [["smart beta", "Smart Beta"], ["factor", "Factor"]],
  factor: [["factor", "Factor"], ["smart beta", "Smart Beta"]],
};

export function EtfDiscovery({ onOpenResearch, onCompare, onAddWatchlist, onPortfolioOverlap }) {
  const [facet, setFacet] = useState("all");
  const [value, setValue] = useState(null);
  const results = useMemo(() => browseEtfs(facet, value), [facet, value]);
  const facetValues = ETF_FACETS.filter((f) => FACET_VALUES[f.id]).map((f) => ({ id: f.id, label: f.label, values: FACET_VALUES[f.id] }));
  return (
    <section className="etf-discovery">
      <div className="etf-disc-head">
        <h2 className="etf-disc-title">ETF Discovery</h2>
        <p className="etf-disc-sub">Browse the Zenin ETF universe by exposure. {results.length} funds match.</p>
      </div>
      <div className="etf-disc-facets">
        {ETF_FACETS.map((f) => (
          <button key={f.id} type="button" className={`etf-facet ${facet === f.id && !value ? "active" : ""}`} onClick={() => { setFacet(f.id); setValue(null); }}>
            {f.label}
          </button>
        ))}
      </div>
      {facet !== "all" && FACET_VALUES[facet] ? (
        <div className="etf-disc-values">
          <button type="button" className={`etf-facet sm ${!value ? "active" : ""}`} onClick={() => setValue(null)}>All {facet}</button>
          {FACET_VALUES[facet].map(([v, lbl]) => (
            <button key={v} type="button" className={`etf-facet sm ${value === v ? "active" : ""}`} onClick={() => setValue(v)}>{lbl}</button>
          ))}
        </div>
      ) : null}
      <div className="etf-disc-grid">
        {results.length ? results.map((m) => (
          <article key={m.sym} className="etf-card">
            <header className="etf-card-head">
              <span className="etf-card-sym">{m.sym}</span>
              <span className="etf-card-cat">{m.category}</span>
            </header>
            <p className="etf-card-name">{m.name}</p>
            <p className="etf-card-exp">{(m.exposure || []).join(" · ")}</p>
            <p className="etf-card-meta">{m.issuer} · {m.benchmark}</p>
            <div className="etf-card-actions">
              <button type="button" className="etf-btn-sm" onClick={() => onOpenResearch?.({ symbol: m.sym })}>Research</button>
              <button type="button" className="etf-btn-sm" onClick={() => onCompare?.(m.sym)}>Compare</button>
              <button type="button" className="etf-btn-sm" onClick={() => onAddWatchlist?.(m.sym)}>Watch</button>
              <button type="button" className="etf-btn-sm" onClick={() => onPortfolioOverlap?.(m.sym)}>Overlap</button>
            </div>
          </article>
        )) : <p className="etf-note muted">No ETFs match this facet in the current seed.</p>}
      </div>
    </section>
  );
}

export default EtfDiscovery;
