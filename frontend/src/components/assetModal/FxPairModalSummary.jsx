// FxPairModalSummary — spec §3: FX-pair modal overview for price-bearing pairs.
// Replaces all equity terminology (company summary, market cap, P/E, analyst
// target, sector, industry, company profile). Brand v2 monochrome. No fabrication:
// every value falls back to "—"; quote provenance + freshness always shown.
import React from "react";

const fmtPct = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
};
const fmtNum = (v, dp = 4) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

export function FxPairModalSummary({ asset, liveQuote, instrument, historySource, historyStale }) {
  const sym = String(asset?.symbol || instrument?.symbol || "").toUpperCase();
  const name = instrument?.name || asset?.name || sym;
  const base = instrument?.baseCurrency || "—";
  const quote = instrument?.quoteCurrency || "—";
  const providerSymbol = instrument?.providerSymbol || "—";

  const price = Number.isFinite(Number(liveQuote?.price ?? asset?.price)) ? Number(liveQuote?.price ?? asset?.price) : null;
  const changePct = Number.isFinite(Number(liveQuote?.priceChangePercent ?? asset?.priceChangePercent))
    ? Number(liveQuote?.priceChangePercent ?? asset?.priceChangePercent)
    : null;
  const prevClose = Number.isFinite(Number(asset?.previousClose)) ? Number(asset.previousClose) : null;

  // FX session is 24/5. Market status derived from weekday + UTC hours.
  const now = new Date();
  const dow = now.getUTCDay();
  const hour = now.getUTCHours();
  const isWeekday = dow >= 1 && dow <= 5;
  const sessionOpen = isWeekday && !(dow === 5 && hour >= 22) && !(dow === 1 && hour < 0);
  const marketStatus = sessionOpen ? "Open (24/5)" : "Closed (weekend)";

  const freshness = historyStale ? "Stale" : price != null ? "Live" : "Unavailable";
  const sourceLabel = historySource || liveQuote?.source || instrument?.provider || "Yahoo Finance";

  const identityRows = [
    { label: "Base Currency", value: base },
    { label: "Quote Currency", value: quote },
    { label: "FX Session", value: "24/5" },
    { label: "Market Status", value: marketStatus },
  ];
  const quoteRows = [
    { label: "Current Quote", value: price == null ? "—" : fmtNum(price), tone: price == null ? "neutral" : changePct == null ? "neutral" : changePct >= 0 ? "pos" : "neg" },
    { label: "Day Change", value: changePct == null ? "—" : fmtPct(changePct), tone: changePct == null ? "neutral" : changePct >= 0 ? "pos" : "neg" },
    { label: "Prior Close", value: prevClose == null ? "—" : fmtNum(prevClose) },
    { label: "Quote Source", value: sourceLabel },
    { label: "As-of", value: freshness },
    { label: "Provider Symbol", value: providerSymbol, mono: true },
  ];

  return (
    <section className="fx-pair-summary" aria-label={`${sym} FX pair overview`}>
      <div className="fxs-tier fxs-tier-1">
        <div className="fxs-identity">
          <span className="fxs-pair">{sym}</span>
          <span className="fxs-name muted">{name}</span>
        </div>
        <dl className="fxs-metrics">
          {identityRows.map((r) => (
            <div className="fxs-row" key={r.label}>
              <dt className="fxs-label">{r.label}</dt>
              <dd className="fxs-value">{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="fxs-tier fxs-tier-2">
        <dl className="fxs-metrics">
          {quoteRows.map((r) => (
            <div className="fxs-row" key={r.label}>
              <dt className="fxs-label">{r.label}</dt>
              <dd className={`fxs-value ${r.mono ? "font-mono" : ""} ${r.tone === "pos" ? "am-pos" : r.tone === "neg" ? "am-neg" : ""}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
        <div className="fxs-meta">
          <span>Macro context: base-country policy, quote-country policy, and next economic event load from the Currency Research Workspace.</span>
        </div>
      </div>
    </section>
  );
}
