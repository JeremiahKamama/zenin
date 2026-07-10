import React from "react";

// Merged "Fundamentals" (C): replaces the 5 all-— sections (growth / profitability /
// financials / quality) with one real section fed by useMarketIntel (ratios,
// keyMetrics, income, balance, cashflow). Grouped sub-tables:
//   Growth / Profitability / Balance Sheet / Cash.
// One FMP fetch per asset (shared from the Workspace via intelA/intelB) — no
// duplicate fetches. Degrades to honest guided-empty subsections when FMP is
// unconfigured (null data).

function SubTable({ title, rows }) {
  return (
    <div className="cmp-fund-block">
      <h3 className="cmp-fund-block-title">{title}</h3>
      {rows.length ? (
        <div className="cmp-fund-grid">
          {rows.map((r) => (
            <div className="cmp-fund-row" key={r.label}>
              <span className="cmp-fund-label">{r.label}</span>
              <span className="cmp-fund-a font-mono">{r.a}</span>
              <span className="cmp-fund-b font-mono">{r.b}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="cmp-section-empty">Not available from the current data services.</div>
      )}
    </div>
  );
}

const FMT = {
  pct: (v) => (v == null ? "—" : `${(v * 100).toFixed(2)}%`),
  x: (v) => (v == null ? "—" : `${Number(v).toFixed(2)}x`),
  num: (v) => (v == null ? "—" : Number(v).toFixed(2)),
};

function pick(obj, keys) {
  for (const k of keys) if (obj?.[k] != null) return obj[k];
  return null;
}

export function ComparisonFundamentals({ intelA, intelB }) {
  const a = intelA?.data || {};
  const b = intelB?.data || {};
  const ra = pick(a.ratios, [0]) || a.ratios || {};
  const rb = pick(b.ratios, [0]) || b.ratios || {};
  const ka = pick(a.keyMetrics, [0]) || a.keyMetrics || {};
  const kb = pick(b.keyMetrics, [0]) || b.keyMetrics || {};
  const ia = a.income || {};
  const ib = b.income || {};
  const ba = a.balance || {};
  const bb = b.balance || {};

  const growth = [
    { label: "Revenue Growth", a: FMT.pct(ra.revenueGrowth), b: FMT.pct(rb.revenueGrowth) },
    { label: "EPS Growth", a: FMT.pct(ra.epsgrowth), b: FMT.pct(rb.epsgrowth) },
    { label: "R&D Growth", a: FMT.pct(ra.rdGrowth), b: FMT.pct(rb.rdGrowth) },
    { label: "Net Income Growth", a: FMT.pct(ra.netIncomeGrowth), b: FMT.pct(rb.netIncomeGrowth) },
  ];
  const profitability = [
    { label: "Gross Margin", a: FMT.pct(ra.grossMargin), b: FMT.pct(rb.grossMargin) },
    { label: "Operating Margin", a: FMT.pct(ra.operatingMargin), b: FMT.pct(rb.operatingMargin) },
    { label: "Net Margin", a: FMT.pct(ka.netProfitMargin), b: FMT.pct(kb.netProfitMargin) },
    { label: "ROE", a: FMT.pct(ra.returnOnEquity), b: FMT.pct(rb.returnOnEquity) },
    { label: "ROA", a: FMT.pct(ra.returnOnAssets), b: FMT.pct(rb.returnOnAssets) },
    { label: "ROIC", a: FMT.pct(ra.returnOnInvestedCapital), b: FMT.pct(rb.returnOnInvestedCapital) },
  ];
  const balanceSheet = [
    { label: "Total Assets", a: FMT.num(ba.totalAssets), b: FMT.num(bb.totalAssets) },
    { label: "Total Debt", a: FMT.num(ba.totalDebt), b: FMT.num(bb.totalDebt) },
    { label: "Debt / Equity", a: FMT.x(ra.debtToEquity), b: FMT.x(rb.debtToEquity) },
    { label: "Current Ratio", a: FMT.x(ra.currentRatio), b: FMT.x(rb.currentRatio) },
    { label: "Book Value / Share", a: FMT.num(ba.bookValuePerShare), b: FMT.num(bb.bookValuePerShare) },
  ];
  const cash = [
    { label: "Operating Cash Flow", a: FMT.num(a.cashflow?.operatingCashFlow), b: FMT.num(b.cashflow?.operatingCashFlow) },
    { label: "Free Cash Flow", a: FMT.num(a.cashflow?.freeCashFlow), b: FMT.num(b.cashflow?.freeCashFlow) },
    { label: "CapEx", a: FMT.num(a.cashflow?.capitalExpenditure), b: FMT.num(b.cashflow?.capitalExpenditure) },
    { label: "FCF Margin", a: FMT.pct(ka.freeCashFlowMargin), b: FMT.pct(kb.freeCashFlowMargin) },
  ];

  return (
    <div className="cmp-section">
      <h2 className="cmp-section-title">Fundamentals</h2>
      <SubTable title="Growth" rows={growth} />
      <SubTable title="Profitability" rows={profitability} />
      <SubTable title="Balance Sheet" rows={balanceSheet} />
      <SubTable title="Cash" rows={cash} />
    </div>
  );
}
