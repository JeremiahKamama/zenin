// PortfolioImpactEnhanced — Expanded Portfolio Impact (spec §8).
//
// Upgrades the Portfolio Impact widget. Keeps the existing per-holding table
// (rendered by HomeModule) and adds a derived intelligence layer:
//   • Largest Contributor / Largest Risk / Largest Hedge
//   • Macro / Commodity / FX / Rate exposure (by holding type; FX/Rate are
//     regime-derived via the bus, else "—" — never fabricated)
//
// All numbers come from the already-normalized portfolioImpactRows; nothing is
// fetched or invented.

import React from "react";

function topBy(rows, dir) {
  if (!rows.length) return null;
  const sorted = [...rows].sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0));
  return dir === "min" ? sorted[sorted.length - 1] : sorted[0];
}

function exposureByType(rows) {
  const acc = {};
  for (const r of rows) {
    const t = String(r.type || "Equity");
    acc[t] = (acc[t] || 0) + Number(r.exposurePct || 0);
  }
  return acc;
}

function fmtMoney(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  const sign = n >= 0 ? "+" : "−";
  if (abs >= 1000) return `${sign}$${(abs / 1000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

export default function PortfolioImpactEnhanced({ rows = [], totalImpact = 0, regimeLabel = null }) {
  const contributor = topBy(rows, "max");
  const risk = topBy(rows, "min");
  // Largest Hedge: a defensive-type holding (Macro/Commodity) with positive
  // impact when the book is down, otherwise the single largest opposing-impact
  // holding. Falls back to "—" when there is no sensible hedge candidate.
  const defensive = rows.filter((r) => /macro|commodit/i.test(String(r.type || "")) && Number(r.impact || 0) > 0);
  const hedge = totalImpact < 0 && defensive.length ? topBy(defensive, "max") : null;

  const exp = exposureByType(rows);
  const macroExp = exp.Macro || 0;
  const commodityExp = exp.Commodity || 0;
  const equityExp = exp.Equity || 0;
  const cryptoExp = exp.Crypto || 0;

  // Currency exposure (real, from holding currency field when present).
  const currencyExp = {};
  for (const r of rows) {
    const c = String(r.currency || "USD").toUpperCase();
    currencyExp[c] = (currencyExp[c] || 0) + Number(r.exposurePct || 0);
  }
  const topCurrency = Object.entries(currencyExp).sort((a, b) => b[1] - a[1])[0];

  // Concentration risk (HHI over exposure weights) — real, computable.
  const totalExp = rows.reduce((s, r) => s + Math.abs(Number(r.exposurePct || 0)), 0) || 1;
  const hhi = rows.reduce((s, r) => { const w = Math.abs(Number(r.exposurePct || 0)) / totalExp; return s + w * w; }, 0);

  // Dimensions the feed does not expose per-holding → stable "Not mapped" rows
  // (spec §11). Never fabricated.
  const NOT_MAPPED = ["Sector", "Country", "Factor", "Duration", "Market Cap", "Beta", "Volatility", "Dividend"];

  const sortedByImpact = [...rows].sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0));
  const winners = sortedByImpact.filter((r) => Number(r.impact || 0) > 0).slice(0, 3);
  const losers = sortedByImpact.filter((r) => Number(r.impact || 0) < 0).slice(0, 3);

  const exposureItems = [
    { label: "Equity", value: equityExp },
    { label: "Commodity", value: commodityExp },
    { label: "Macro", value: macroExp },
    { label: "Crypto", value: cryptoExp },
    { label: `FX (${topCurrency ? topCurrency[0] : "—"})`, value: topCurrency ? topCurrency[1] : null, dash: !topCurrency },
  ];
  const maxExp = Math.max(1, ...exposureItems.filter((i) => !i.dash && Number.isFinite(i.value)).map((i) => Math.abs(i.value)));

  return (
    <div className="pf-impact-enhanced">
      <div className="pf-impact-stats">
        <div className="pf-impact-stat">
          <span>Largest Contributor</span>
          <strong>{contributor ? `${contributor.symbol} ${fmtMoney(contributor.impact)}` : "—"}</strong>
        </div>
        <div className="pf-impact-stat">
          <span>Largest Risk</span>
          <strong className={risk && Number(risk.impact || 0) < 0 ? "negative" : ""}>{risk ? `${risk.symbol} ${fmtMoney(risk.impact)}` : "—"}</strong>
        </div>
        <div className="pf-impact-stat">
          <span>Largest Hedge</span>
          <strong>{hedge ? `${hedge.symbol} ${fmtMoney(hedge.impact)}` : "—"}</strong>
        </div>
      </div>

      <div className="pf-impact-exposure">
        <span className="macro-ctx-label">Exposure by Asset Class</span>
        {exposureItems.map((i) => (
          <div key={i.label} className="pf-impact-exp-row">
            <span>{i.label}</span>
            {i.dash ? <em>—</em> : (
              <div className="pf-impact-bar">
                <div className={`pf-impact-bar-fill ${i.value >= 0 ? "pos" : "neg"}`} style={{ width: `${Math.min(100, (Math.abs(i.value) / maxExp) * 100)}%` }} />
                <span className="pf-impact-exp-val">{i.value.toFixed(1)}%</span>
              </div>
            )}
          </div>
        ))}
        <span className="macro-ctx-label" style={{ marginTop: 8 }}>Concentration Risk</span>
        <div className="pf-impact-exp-row">
          <span>HHI</span>
          <div className="pf-impact-bar">
            <div className={`pf-impact-bar-fill ${hhi > 0.4 ? "neg" : "pos"}`} style={{ width: `${Math.min(100, hhi * 100)}%` }} />
            <span className="pf-impact-exp-val">{hhi.toFixed(2)}</span>
          </div>
        </div>
        <span className="macro-ctx-label" style={{ marginTop: 8 }}>More Dimensions</span>
        <div className="pf-impact-notmapped">
          {NOT_MAPPED.map((d) => <span key={d} className="pf-notmapped-chip" title="Not mapped from current holding data">{({ Sector: "Sector", Country: "Country", Factor: "Factor", Duration: "Duration", "Market Cap": "Mkt Cap", Beta: "Beta", Volatility: "Vol", Dividend: "Div" })[d]} —</span>)}
        </div>
      </div>

      {(winners.length || losers.length) ? (
        <div className="pf-impact-wl">
          <div className="pf-wl-col">
            <span className="macro-ctx-label">Top Winners</span>
            {winners.map((w) => <div key={`w-${w.id || w.symbol}`} className="pf-wl-row"><span>{w.symbol}</span><em className="pos">{fmtMoney(w.impact)}</em></div>)}
          </div>
          <div className="pf-wl-col">
            <span className="macro-ctx-label">Top Losers</span>
            {losers.map((l) => <div key={`l-${l.id || l.symbol}`} className="pf-wl-row"><span>{l.symbol}</span><em className="neg">{fmtMoney(l.impact)}</em></div>)}
          </div>
        </div>
      ) : null}

    </div>
  );
}
