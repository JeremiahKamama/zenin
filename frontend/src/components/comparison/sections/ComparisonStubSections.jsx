import { ComparisonMetricTable } from "../ComparisonMetricTable";
import { fmtPct, fmtNum, fmtMultiple, metricWinner, gradeForScore, riskLevel } from "../comparisonUtils";

// These sections consume existing services where possible (earnings/finviz)
// and render honest empty states for data the current backend does not expose
// (news feeds, catalysts, correlation, AI memo generation). No fabricated numbers.

function Empty({ title, note }) {
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">{title}</h2>
      <div className="cmp-section-empty">
        {note || "This dataset is not available from the current data services."}
      </div>
    </div>
  );
}

export function ComparisonGrowth({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const g = (d) => d?.earnings?.growth ?? d?.finviz ?? {};
  const ga = g(assetA);
  const gb = g(assetB);
  const rows = [
    { label: "Revenue Growth", a: ga.revenueGrowth ?? null, b: gb.revenueGrowth ?? null, format: "pct", winner: metricWinner(ga.revenueGrowth, gb.revenueGrowth) },
    { label: "EPS Growth", a: ga.epsGrowth ?? null, b: gb.epsGrowth ?? null, format: "pct", winner: metricWinner(ga.epsGrowth, gb.epsGrowth) },
    { label: "FCF Growth", a: ga.fcfGrowth ?? null, b: gb.fcfGrowth ?? null, format: "pct", winner: metricWinner(ga.fcfGrowth, gb.fcfGrowth) }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Growth</h2>
      <ComparisonMetricTable rows={rows} caption="Growth rates" />
    </div>
  );
}

export function ComparisonProfitability({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const p = (d) => d?.earnings?.profitability ?? d?.finviz ?? {};
  const pa = p(assetA);
  const pb = p(assetB);
  const rows = [
    { label: "Gross Margin", a: pa.grossMargin ?? null, b: pb.grossMargin ?? null, format: "pct", winner: metricWinner(pa.grossMargin, pb.grossMargin) },
    { label: "Operating Margin", a: pa.operatingMargin ?? null, b: pb.operatingMargin ?? null, format: "pct", winner: metricWinner(pa.operatingMargin, pb.operatingMargin) },
    { label: "Net Margin", a: pa.netMargin ?? null, b: pb.netMargin ?? null, format: "pct", winner: metricWinner(pa.netMargin, pb.netMargin) },
    { label: "ROE", a: pa.roe ?? null, b: pb.roe ?? null, format: "pct", winner: metricWinner(pa.roe, pb.roe) },
    { label: "ROA", a: pa.roa ?? null, b: pb.roa ?? null, format: "pct", winner: metricWinner(pa.roa, pb.roa) },
    { label: "ROIC", a: pa.roic ?? null, b: pb.roic ?? null, format: "pct", winner: metricWinner(pa.roic, pb.roic) }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Profitability</h2>
      <ComparisonMetricTable rows={rows} caption="Margin & return profile" />
    </div>
  );
}

export function ComparisonQuality({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  // Quality score: composite from available margins/returns; graded A–D.
  const score = (d) => {
    const p = d?.earnings?.profitability ?? d?.finviz ?? {};
    const vals = [p.operatingMargin, p.roe, p.roic].filter((x) => typeof x === "number" && Number.isFinite(x));
    if (!vals.length) return null;
    const avg = vals.reduce((s, x) => s + x, 0) / vals.length;
    return Math.max(0, Math.min(100, 50 + avg));
  };
  const sa = score(assetA);
  const sb = score(assetB);
  const rows = [
    { label: "Profitability", a: sa != null ? gradeForScore(sa) : null, b: sb != null ? gradeForScore(sb) : null, winner: metricWinner(sa, sb) },
    { label: "Growth", a: "—", b: "—" },
    { label: "Efficiency", a: "—", b: "—" },
    { label: "Capital Allocation", a: "—", b: "—" },
    { label: "Balance Sheet", a: "—", b: "—" },
    { label: "Cash Generation", a: "—", b: "—" }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Quality</h2>
      <ComparisonMetricTable rows={rows} caption="Financial quality grades (A–D)" />
      <div className="cmp-section-note">Full quality grading requires returns + balance-sheet depth not exposed by current services.</div>
    </div>
  );
}

export function ComparisonTechnical({ assetA, assetB }) {
  return <Empty title="Technical" note="Technical indicators (RSI, MACD, moving averages) are not provided by the current data services." />;
}

export function ComparisonMacro({ assetA, assetB }) {
  return <Empty title="Macro" note="Macro exposure (rates, inflation sensitivity) is not provided by the current data services." />;
}

export function ComparisonOwnership({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const rows = [
    { label: "Institution Ownership", a: assetA.finviz?.institutionOwnership ?? "—", b: assetB.finviz?.institutionOwnership ?? "—" },
    { label: "Insider Ownership", a: assetA.finviz?.insiderOwnership ?? "—", b: assetB.finviz?.insiderOwnership ?? "—" }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Ownership</h2>
      <ComparisonMetricTable rows={rows} caption="Ownership profile" />
      <div className="cmp-section-note">Institution/insider ownership shown only when present in the finviz payload.</div>
    </div>
  );
}

export function ComparisonNews({ assetA, assetB }) {
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">News</h2>
      <div className="cmp-section-empty">Topic-clustered news is not available from the current data services.</div>
    </div>
  );
}

export function ComparisonCatalysts({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const ea = assetA.earnings?.nextEarnings ?? assetA.finviz?.nextEarnings ?? null;
  const eb = assetB.earnings?.nextEarnings ?? assetB.finviz?.nextEarnings ?? null;
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Catalysts</h2>
      <ComparisonMetricTable
        rows={[{ label: "Next Earnings", a: ea || "—", b: eb || "—" }]}
        caption="Upcoming earnings"
      />
      <div className="cmp-section-note">Full catalyst tracking (launches, dividends, regulatory) is not exposed by current services.</div>
    </div>
  );
}

export function ComparisonRisks({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const betaA = assetA.beta;
  const betaB = assetB.beta;
  const rows = [
    { label: "Business Risk", a: betaA != null ? riskLevel(Math.min(100, betaA * 33)) : "—", b: betaB != null ? riskLevel(Math.min(100, betaB * 33)) : "—", winner: metricWinner(betaA, betaB, false) },
    { label: "Financial Risk", a: "—", b: "—" },
    { label: "Regulatory Risk", a: "—", b: "—" },
    { label: "Technology Risk", a: "—", b: "—" },
    { label: "Execution Risk", a: "—", b: "—" },
    { label: "Political Risk", a: "—", b: "—" }
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Risks</h2>
      <ComparisonMetricTable rows={rows} caption="Risk scores (Low / Medium / High)" />
      <div className="cmp-section-note">Beta-derived business-risk proxy only; full risk taxonomy requires the risk service.</div>
    </div>
  );
}

export function ComparisonTimeline({ assetA, assetB }) {
  return <Empty title="Timeline" note="Event timeline (earnings, splits, filings) is not provided by the current data services." />;
}

export function ComparisonAI({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const prompts = [
    "Challenge my thesis", "Bull case", "Bear case",
    `What does ${assetA.symbol} do better?`, `What is ${assetB.symbol}'s advantage?`,
    "Which is cheaper?", "Which has higher quality?", "Which has higher risk?",
    "Should I own both?", "Generate investment memo", "Generate recommendation"
  ];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">AI Analysis</h2>
      <div className="cmp-section-note">Institutional prompt layer is not wired in this environment. Available prompts:</div>
      <ul className="cmp-ai-prompts">
        {prompts.map((p) => <li key={p} className="cmp-ai-prompt">{p}</li>)}
      </ul>
    </div>
  );
}

export function ComparisonPortfolioImpact({ assetA, assetB }) {
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Portfolio Impact</h2>
      <div className="cmp-section-empty">
        Correlation and diversification impact require the portfolio/correlation service, which is not available in this environment.
      </div>
    </div>
  );
}

export function ComparisonDecisionPanel({ assetA, assetB }) {
  if (!assetA || !assetB) return <div className="cmp-section-empty">Select two assets to compare.</div>;
  const actions = ["Save Decision", "Watch Later", "Replace Holding", "Add to Watchlist", "Ignore", "Journal Note", "Research Note", "Generate Briefing"];
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Decision</h2>
      <div className="cmp-section-note">Decision actions feed into Decisions / Journal / Briefings (wired in a later pass).</div>
      <div className="cmp-decision-actions">
        {actions.map((a) => <button key={a} className="cmp-decision-btn" disabled>{a}</button>)}
      </div>
    </div>
  );
}

export function ComparisonJournalPanel({ assetA, assetB }) {
  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Journal</h2>
      <div className="cmp-section-empty">Comparisons can be logged as Journal events; journal integration is wired in a later pass.</div>
    </div>
  );
}
