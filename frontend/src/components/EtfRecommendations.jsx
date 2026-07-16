// EtfRecommendations — Rec 9 (Macro→ETF) + Rec 10 (Portfolio→ETF).
// Derives ETF recommendations from the macro REGIME (affected sectors/
// countries/commodities) or from PORTFOLIO GAPS (missing exposures).
// 100% from CORE_ETF_SEED — no live provider, no fabrication.
// Monochrome, token-driven. Each rec explains WHY (per spec Rec 10)
// and links into ETF ARW. Integrates with Relationship Graph.
import { useMemo } from "react";
import { recommendEtfsForRegime, recommendEtfsForPortfolio } from "../utils/etfIntelligence";

export function EtfRecommendations({ mode = "regime", regime, gaps, onOpenEtf }) {
  const recs = useMemo(() => {
    if (mode === "portfolio") return recommendEtfsForPortfolio(gaps || {});
    return recommendEtfsForRegime(regime);
  }, [mode, regime, gaps]);

  const title = mode === "portfolio" ? "ETF Recommendations" : "ETF Ideas — Macro Driven";
  const sub = mode === "portfolio"
    ? "Close portfolio exposure gaps with these funds (derived from seed classification)."
    : regime?.label
      ? `Funds exposed to the ${regime.label} regime.`
      : "Publish a macro regime to see ETF ideas.";

  return (
    <section className="etf-recs">
      <header className="etf-recs-head">
        <h3 className="etf-recs-title">{title}</h3>
        <p className="etf-note muted">{sub}</p>
      </header>
      {recs.length ? (
        <ul className="etf-recs-list">
          {recs.map((r) => (
            <li key={r.sym} className="etf-recs-row">
              <button type="button" className="etf-recs-sym" onClick={() => onOpenEtf?.({ symbol: r.sym })}>
                {r.sym}
              </button>
              <span className="etf-recs-name">{r.name}</span>
              <span className="etf-recs-cat">{r.category}</span>
              <span className="etf-recs-why">{r.why.join(" · ")}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="etf-note muted">
          {mode === "portfolio"
            ? "No gap-derived ETF ideas from the current seed."
            : "No regime-driven ETF ideas — macro regime not published."}
        </p>
      )}
    </section>
  );
}

export default EtfRecommendations;
