/**
 * Zenin — Equities Desk reusable cards (Phase 9).
 *
 * Every widget consumes normalized Zenin models and never touches a provider.
 * These are thin, composable presentational cards built on AnalyticsTableCard
 * so the same widget renders for any region, country, exchange, or asset class.
 * Internal analytics (breadth, concentration, RS) come from utils/marketIntelligence.
 */
import { AnalyticsTableCard } from "./AnalyticsModule";

/** Compact KPI strip — Global Filters → Regional → Country → Exchange → Asset Class hierarchy. */
export function MarketSummaryCard({ region, country, exchange, assetClass, snapshot = {} }) {
  const cards = [
    { label: "Market Health", value: snapshot.breadthRegime || "—", helper: `Score ${snapshot.breadthScore ?? "—"}/100` },
    { label: "Advancers / Decliners", value: snapshot.advancers != null ? `${snapshot.advancers} / ${snapshot.decliners}` : "—" },
    { label: "Market Participation", value: snapshot.equalWeightProxy != null ? `${snapshot.equalWeightProxy}%` : "—" },
    { label: "Market Concentration", value: snapshot.concentrationPct != null ? `${snapshot.concentrationPct.toFixed(1)}%` : "—" },
    { label: "Corporate Activity", value: snapshot.earningsBreadth != null ? `${snapshot.earningsBreadth}%` : "—" },
  ];
  return (
    <section className="analytics-desk-panel analytics-equities-top-strip" aria-label="Market summary">
      {cards.map((c) => (
        <article key={c.label} className="analytics-equities-strip-card">
          <span>{c.label}</span>
          <strong>{c.value}</strong>
          <em>{c.helper || ""}</em>
        </article>
      ))}
    </section>
  );
}

/** Regional / country rotation leaderboard from normalized regionalPerformance rows. */
export function RegionSummaryCard({ rows = [], title = "Regional Summary" }) {
  return (
    <AnalyticsTableCard
      title={title}
      subtitle="Performance and leadership by region / country"
      emptyText="No regional performance rows for the current scope."
      columns={[
        { key: "region", label: "Region" },
        { key: "country", label: "Country" },
        { key: "returnPct", label: "Return", align: "right", render: (v) => (v != null ? `${Number(v).toFixed(2)}%` : "—") },
        { key: "currency", label: "Currency" },
      ]}
      rows={rows.map((row, idx) => ({ id: `reg-${idx}`, ...row }))}
    />
  );
}

/** Market breadth — advance/decline + 52w highs/lows, computed internally. */
export function MarketBreadthCard({ rows = [], title = "Market Breadth" }) {
  // Lazy import avoided to keep this tree-shakeable; callers pass precomputed values.
  const adv = rows.filter((r) => Number(r?.changePct ?? r?.change ?? 0) > 0).length;
  const dec = rows.filter((r) => Number(r?.changePct ?? r?.change ?? 0) < 0).length;
  const highs = rows.filter((r) => r?.week52High || r?.newHigh).length;
  const lows = rows.filter((r) => r?.week52Low || r?.newLow).length;
  return (
    <AnalyticsTableCard
      title={title}
      subtitle="Advance/decline and 52-week extremes"
      emptyText="No breadth rows for the current scope."
      columns={[
        { key: "metric", label: "Metric" },
        { key: "value", label: "Value", align: "right" },
      ]}
      rows={[
        { id: "ad", metric: "Advancers / Decliners", value: `${adv} / ${dec}` },
        { id: "hl", metric: "52w Highs / Lows", value: `${highs} / ${lows}` },
      ]}
    />
  );
}

/** Top movers — gainers / losers, normalized. */
export function TopMoversCard({ rows = [], title = "Top Movers" }) {
  return (
    <AnalyticsTableCard
      title={title}
      subtitle="Largest intraday moves"
      emptyText="No mover rows for the current scope."
      columns={[
        { key: "symbol", label: "Symbol" },
        { key: "name", label: "Name" },
        { key: "changePct", label: "Change", align: "right", render: (v) => (v != null ? `${Number(v).toFixed(2)}%` : "—") },
        { key: "exchange", label: "Exchange" },
      ]}
      rows={rows.map((row, idx) => ({ id: `mv-${idx}`, ...row }))}
    />
  );
}
