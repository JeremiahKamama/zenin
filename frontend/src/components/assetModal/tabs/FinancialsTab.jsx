export function FinancialsTab({
  earnings,
  earningsLoading,
  earningsStale,
  finvizData,
  fundamentalsDetails = [],
  hasDetailedFundamentals,
  formatCompactMoney
}) {
  if (earningsLoading && !earnings && !finvizData) {
    return (
      <div className="am-tab-empty">
        <span className="am-spinner spin">⟳</span> Loading financials…
      </div>
    );
  }

  const income = earnings?.incomeStatement || {};
  const balance = earnings?.balanceSheet || {};
  const cashflow = earnings?.cashFlow || {};
  const margins = earnings?.margins || {};
  const growth = earnings?.growth || {};

  const groups = [
    {
      title: "Income Statement",
      rows: [
        { label: "Revenue", value: finvizData?.summary?.["Sales"] || (earnings?.revenue?.consensus != null ? formatCompactMoney(earnings.revenue.consensus) : "—") },
        { label: "Net Income", value: income?.netIncome != null ? formatCompactMoney(income.netIncome) : "—" },
        { label: "EPS", value: earnings?.eps?.ttm != null ? `$${Number(earnings.eps.ttm).toFixed(2)}` : "—" }
      ]
    },
    {
      title: "Balance Sheet",
      rows: [
        { label: "Total Assets", value: balance?.totalAssets != null ? formatCompactMoney(balance.totalAssets) : "—" },
        { label: "Total Debt", value: balance?.totalDebt != null ? formatCompactMoney(balance.totalDebt) : "—" },
        { label: "Cash", value: balance?.cash != null ? formatCompactMoney(balance.cash) : "—" }
      ]
    },
    {
      title: "Cash Flow",
      rows: [
        { label: "Operating", value: cashflow?.operating != null ? formatCompactMoney(cashflow.operating) : "—" },
        { label: "Free Cash Flow", value: cashflow?.freeCashFlow != null ? formatCompactMoney(cashflow.freeCashFlow) : "—" },
        { label: "Capital Expenditure", value: cashflow?.capex != null ? formatCompactMoney(cashflow.capex) : "—" }
      ]
    },
    {
      title: "Margins",
      rows: [
        { label: "Gross Margin", value: margins?.gross != null ? `${(margins.gross * 100).toFixed(2)}%` : "—" },
        { label: "Operating Margin", value: margins?.operating != null ? `${(margins.operating * 100).toFixed(2)}%` : "—" },
        { label: "Net Margin", value: margins?.net != null ? `${(margins.net * 100).toFixed(2)}%` : "—" }
      ]
    },
    {
      title: "Growth",
      rows: [
        { label: "Revenue Growth", value: growth?.revenue != null ? `${(growth.revenue * 100).toFixed(2)}%` : "—" },
        { label: "EPS Growth", value: growth?.eps != null ? `${(growth.eps * 100).toFixed(2)}%` : "—" }
      ]
    },
    {
      title: "Valuation",
      rows: fundamentalsDetails.map((d) => ({ label: d.label, value: d.value }))
    }
  ];

  return (
    <div className="am-tab-content">
      {earningsStale ? <div className="am-stale-note">Financials may be delayed.</div> : null}
      <div className="am-fin-grid">
        {groups.map((g) => (
          <div className="am-fin-group" key={g.title}>
            <div className="am-fin-title">{g.title}</div>
            {g.rows.map((r) => (
              <div className="am-fin-row" key={r.label}>
                <span className="am-fin-label">{r.label}</span>
                <span className="am-fin-value font-mono">{r.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
