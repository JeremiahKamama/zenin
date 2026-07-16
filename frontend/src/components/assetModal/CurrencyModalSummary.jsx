// CurrencyModalSummary — spec §4: standalone currency-code research surface.
// Honest research-only entity: no fabricated standalone price. Plural-aware:
// EUR/USD shared by multiple economies (currency → countries/central banks).
// Brand v2 monochrome. Related crosses let the user jump to a price-bearing pair.
import React from "react";

export function CurrencyModalSummary({ asset, instrument, currencyMeta, relatedPairs = [] }) {
  const code = String(asset?.symbol || instrument?.symbol || "").toUpperCase();
  const name = currencyMeta?.name || instrument?.name || code;
  const countries = currencyMeta?.countries || [];
  const centralBanks = currencyMeta?.centralBanks || [];
  const region = currencyMeta?.region || "—";
  const policyRateLabel = currencyMeta?.policyRateLabel || "Policy Rate";
  const policyRate = currencyMeta?.referencePolicyRatePct;
  const policyRateAsOf = currencyMeta?.policyRateAsOf || "—";
  const notes = currencyMeta?.notes || "";

  const identityRows = [
    { label: "ISO Code", value: code, mono: true },
    { label: "Name", value: name },
    { label: "Issuing Country / Area", value: countries.length ? countries.join(", ") : "—" },
    { label: "Central Bank", value: centralBanks.length ? centralBanks.join(", ") : "—" },
    { label: "Region", value: region },
  ];
  const macroRows = [
    { label: policyRateLabel, value: policyRate == null ? "—" : `${policyRate.toFixed(2)}%`, sub: `ref · ${policyRateAsOf}` },
    { label: "Data Freshness", value: "Reference data" },
    { label: "Research Status", value: "Research-only currency" },
  ];

  return (
    <section className="currency-modal-summary" aria-label={`${code} currency overview`}>
      <div className="cms-banner">
        <span className="cms-banner-tag">Research-only currency</span>
        <span className="muted">No standalone tradable price is shown. Select a related cross for price analysis.</span>
      </div>
      <div className="cms-tier cms-tier-1">
        <dl className="cms-metrics">
          {identityRows.map((r) => (
            <div className="cms-row" key={r.label}>
              <dt className="cms-label">{r.label}</dt>
              <dd className={`cms-value ${r.mono ? "font-mono" : ""}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="cms-tier cms-tier-2">
        <dl className="cms-metrics">
          {macroRows.map((r) => (
            <div className="cms-row" key={r.label}>
              <dt className="cms-label">{r.label}</dt>
              <dd className="cms-value">{r.value}{r.sub ? <span className="cms-sub"> {r.sub}</span> : null}</dd>
            </div>
          ))}
        </dl>
        {notes ? <p className="cms-notes muted">{notes}</p> : null}
      </div>
      <div className="cms-tier cms-tier-3">
        <div className="cms-crosses-head">Related Crosses</div>
        {relatedPairs.length ? (
          <ul className="cms-crosses">
            {relatedPairs.map((p) => (
              <li key={p}>
                <button
                  type="button"
                  className="cms-cross-btn"
                  onClick={() => asset?.onSelectCross?.(p)}
                >
                  {p}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">No curated crosses reference {code} in the current universe.</p>
        )}
      </div>
    </section>
  );
}
