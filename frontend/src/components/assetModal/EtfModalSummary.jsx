// EtfModalSummary — spec §2: ETF-native modal overview (replaces equity modal
// with ETF labels). Uses CORE_ETF_SEED reference fields immediately; marks
// anything not in seed as "Reference data unavailable" — never stock fundamentals.
// Brand v2 monochrome. Portfolio relevance pulled from the passed portfolio.
import React, { useMemo } from "react";
import { CORE_ETF_SEED } from "../../utils/assetGraph";

const fmtMoney = (v, sym = "$") => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export function EtfModalSummary({ asset, liveQuote, portfolio = [] }) {
  const sym = String(asset?.symbol || "").toUpperCase();
  const seed = CORE_ETF_SEED[sym] || null;

  const issuer = seed?.issuer || "—";
  const benchmark = seed?.benchmark || "—";
  const category = seed?.category || "—";
  const exposure = Array.isArray(seed?.exposure) && seed.exposure.length ? seed.exposure.join(", ") : "—";
  // Not present in seed → honest unavailable, never fabricated.
  const expenseRatio = "Reference data unavailable";
  const distributionPolicy = "Reference data unavailable";
  const assetClass = /bond|fixed income|treasury|agg/i.test(category || "")
    ? "Fixed Income"
    : /commodity/i.test(category || "")
      ? "Commodity"
      : "Equity";

  const holding = useMemo(
    () => (portfolio || []).find((p) => String(p.symbol || "").toUpperCase() === sym && (p.marketType || "etf") === (asset?.marketType || "etf")) || null,
    [portfolio, sym, asset?.marketType]
  );
  const quantity = Number(holding?.quantity || 0);
  const hasHolding = quantity > 0;
  const price = Number.isFinite(Number(liveQuote?.price ?? asset?.price)) ? Number(liveQuote?.price ?? asset?.price) : null;
  const marketValue = hasHolding && price != null ? price * quantity : null;
  const avgCost = holding?.avgCost ?? holding?.averageCost ?? null;

  const identityRows = [
    { label: "Issuer", value: issuer },
    { label: "Benchmark", value: benchmark },
    { label: "Category", value: category },
    { label: "Expense Ratio", value: expenseRatio, sub: seed ? "" : "" },
    { label: "Distribution Policy", value: distributionPolicy },
    { label: "Asset Class", value: assetClass },
    { label: "Primary Exposure", value: exposure },
  ];
  const portfolioRows = [
    { label: "Holding Status", value: hasHolding ? `Held · ${quantity}` : "Not held", mono: hasHolding },
    { label: "Market Value", value: marketValue != null ? fmtMoney(marketValue) : "—", mono: true },
    { label: "Average Cost", value: avgCost != null ? fmtMoney(avgCost) : "—", mono: true },
    { label: "Portfolio Overlap", value: seed ? "See Research Workspace for constituent overlap" : "No comparable portfolio exposure" },
  ];

  return (
    <section className="etf-modal-summary" aria-label={`${sym} ETF overview`}>
      <div className="ems-tier ems-tier-1">
        <div className="ems-head">
          <span className="ems-sym">{sym}</span>
          <span className="ems-name muted">{seed?.name || asset?.name || sym}</span>
        </div>
        <dl className="ems-metrics">
          {identityRows.map((r) => (
            <div className="ems-row" key={r.label}>
              <dt className="ems-label">{r.label}</dt>
              <dd className={`ems-value ${r.mono ? "font-mono" : ""}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
        {!seed ? (
          <p className="ems-note muted">Not in the covered ETF reference universe. Open the ETF Research Workspace to search and add it.</p>
        ) : null}
      </div>
      <div className="ems-tier ems-tier-2">
        <dl className="ems-metrics">
          {portfolioRows.map((r) => (
            <div className="ems-row" key={r.label}>
              <dt className="ems-label">{r.label}</dt>
              <dd className={`ems-value ${r.mono ? "font-mono" : ""} ${r.value === "—" ? "am-na" : ""}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
