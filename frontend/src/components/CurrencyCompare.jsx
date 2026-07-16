// CurrencyCompare — FX-pair and currency-code comparison surface (Watchlist
// Audit remediation §3).
//
// Two modes, driven by `primaryKind`:
//   - forex    : two FX-pair selectors; quote/source/as-of from the currency
//                adapter + honest "insufficient aligned history" when the
//                comparison analytics cannot be computed (series not wired).
//   - currency : identity + issuing jurisdiction + related tradable crosses +
//                macro comparison only where an authoritative source exists;
//                otherwise an unambiguous "not available" message.
//
// Hard rule (Brand v2 / audit §3): never render placeholder analytics such as
// `0.00%`, and never invent exchange-rate, volatility, central-bank, or macro
// data for standalone currency codes.

import { useEffect, useMemo, useState } from "react";
import {
  CURATED_FX_PAIRS,
  CURATED_CURRENCIES,
  getCurrencyMeta,
  resolveCurrencyInstrument,
  normalizeInstrumentSymbol,
} from "../utils/currencyInstruments.js";
import { getAdapter } from "../utils/assetAdapters.js";
import { Ghost, MetricStrip, Panel, Section } from "./CompactWorkspaceUI.jsx";

// Minimum aligned data points to attempt any numeric comparison analytics.
const MIN_POINTS = 10;

function useFxSnapshot(pair) {
  const [snap, setSnap] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const sym = normalizeInstrumentSymbol(pair);
    const inst = resolveCurrencyInstrument(sym);
    const adapter = getAdapter("currency");
    if (!adapter || !inst) { setSnap(null); return; }
    setLoading(true);
    adapter.fetchSnapshot(sym, inst)
      .then((s) => { if (!cancelled) { setSnap(s); setLoading(false); } })
      .catch(() => { if (!cancelled) { setSnap(null); setLoading(false); } });
    return () => { cancelled = true; };
  }, [pair]);
  return { snap, loading };
}

function QuoteStat({ label, value, unavailable }) {
  return (
    <div className="cc-stat">
      <span className="cc-stat-label">{label}</span>
      <span className={`cc-stat-value ${unavailable ? "cc-unavailable" : ""}`}>
        {unavailable ? "Unavailable" : value}
      </span>
    </div>
  );
}

export function CurrencyCompare({
  primarySymbol,
  primaryKind = "forex",
  initialCompareSymbol = null,
  onChangePrimary,
  onChangeComparison,
  onOpenResearch,
}) {
  const isPair = primaryKind === "forex";

  const [primary, setPrimary] = useState(primarySymbol || (isPair ? CURATED_FX_PAIRS[0] : CURATED_CURRENCIES[0]));
  const [comparison, setComparison] = useState(initialCompareSymbol || (isPair ? CURATED_FX_PAIRS[1] : CURATED_CURRENCIES[1]));

  // Keep primary in sync if the parent changes the route symbol/peer.
  useEffect(() => {
    const s = normalizeInstrumentSymbol(primarySymbol);
    if (s && s !== primary) setPrimary(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primarySymbol]);
  useEffect(() => {
    const s = normalizeInstrumentSymbol(initialCompareSymbol);
    if (s && s !== comparison) setComparison(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialCompareSymbol]);

  const primarySnap = useFxSnapshot(isPair ? primary : null);
  const comparisonSnap = useFxSnapshot(isPair ? comparison : null);

  const selectorList = isPair ? CURATED_FX_PAIRS : CURATED_CURRENCIES;

  const handlePrimary = (e) => {
    const v = e.target.value;
    setPrimary(v);
    if (onChangePrimary) onChangePrimary(v);
  };
  const handleComparison = (e) => {
    const v = e.target.value;
    setComparison(v);
    if (onChangeComparison) onChangeComparison(v);
  };

  // ── FX-pair comparison ────────────────────────────────────────────────────
  if (isPair) {
    const p = primarySnap.snap;
    const c = comparisonSnap.snap;
    const hasAligned = (p?.series?.length || 0) >= MIN_POINTS && (c?.series?.length || 0) >= MIN_POINTS;

    return (
      <div className="currency-compare" aria-label="FX pair comparison">
        <div className="cc-selectors">
          <label className="cc-field">
            <span>Primary pair</span>
            <select value={primary} onChange={handlePrimary} aria-label="Primary FX pair">
              {selectorList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className="cc-field">
            <span>Comparison pair</span>
            <select value={comparison} onChange={handleComparison} aria-label="Comparison FX pair">
              {selectorList.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>

        <MetricStrip items={[
          { label: `${primary} Source`, value: p?.raw?.price ? "Yahoo Finance" : "Curated FX universe" },
          { label: `${primary} As-of`, value: p?.updatedAt ? new Date(p.updatedAt).toLocaleString() : "Unavailable" },
          { label: `${comparison} Source`, value: c?.raw?.price ? "Yahoo Finance" : "Curated FX universe" },
          { label: `${comparison} As-of`, value: c?.updatedAt ? new Date(c.updatedAt).toLocaleString() : "Unavailable" },
        ]} />

        <div className="cc-quotes">
          <QuoteStat label={`${primary} Quote`} value={p?.price != null ? (resolveCurrencyInstrument(primary)?.quoteCurrency === "JPY" ? p.price.toFixed(2) : p.price.toFixed(4)) : "Unavailable"} unavailable={p?.price == null} />
          <QuoteStat label={`${primary} Day`} value={p?.dayChangePct != null ? `${p.dayChangePct >= 0 ? "+" : ""}${p.dayChangePct.toFixed(2)}%` : "Unavailable"} unavailable={p?.dayChangePct == null} />
          <QuoteStat label={`${comparison} Quote`} value={c?.price != null ? (resolveCurrencyInstrument(comparison)?.quoteCurrency === "JPY" ? c.price.toFixed(2) : c.price.toFixed(4)) : "Unavailable"} unavailable={c?.price == null} />
          <QuoteStat label={`${comparison} Day`} value={c?.dayChangePct != null ? `${c.dayChangePct >= 0 ? "+" : ""}${c.dayChangePct.toFixed(2)}%` : "Unavailable"} unavailable={c?.dayChangePct == null} />
        </div>

        <Panel title="Performance · Volatility · Correlation">
          {hasAligned ? (
            <p className="cc-note">Aligned history is available — analytics render here.</p>
          ) : (
            <Ghost label="Insufficient aligned history for normalized performance, realized volatility, and correlation. Only live quote/source/as-of are shown above. No comparison analytics are fabricated." />
          )}
        </Panel>
      </div>
    );
  }

  // ── Currency-code comparison (research only) ──────────────────────────────
  const meta = useMemo(() => getCurrencyMeta(primary), [primary]);
  const metaC = useMemo(() => getCurrencyMeta(comparison), [comparison]);
  const related = useMemo(() => CURATED_FX_PAIRS.filter((p) => p.includes(primary) || p.includes(comparison)), [primary, comparison]);

  const openCross = (pair) => {
    if (onOpenResearch) onOpenResearch({ symbol: pair, kind: "forex", compareSymbol: null });
  };

  return (
    <div className="currency-compare currency-compare-ccy" aria-label="Currency comparison">
      <div className="cc-selectors">
        <label className="cc-field">
          <span>Primary currency</span>
          <select value={primary} onChange={handlePrimary} aria-label="Primary currency code">
            {selectorList.map((s) => <option key={s} value={s}>{s}{meta?.name ? ` · ${meta.name}` : ""}</option>)}
          </select>
        </label>
        <label className="cc-field">
          <span>Comparison currency</span>
          <select value={comparison} onChange={handleComparison} aria-label="Comparison currency code">
            {selectorList.map((s) => <option key={s} value={s}>{s}{metaC?.name ? ` · ${metaC.name}` : ""}</option>)}
          </select>
        </label>
      </div>

      <MetricStrip items={[
        { label: `${primary} Name`, value: meta?.name || "Unavailable" },
        { label: `${primary} Jurisdiction`, value: (meta?.countries && meta.countries.length) ? meta.countries.join(", ") : "Unavailable" },
        { label: `${primary} Central bank`, value: (meta?.centralBanks && meta.centralBanks.length) ? meta.centralBanks[0] : "Unavailable" },
        { label: `${comparison} Name`, value: metaC?.name || "Unavailable" },
      ]} />

      <Panel title="Tradable Crosses">
        {related.length ? (
          <div className="etf-nav-list">
            {related.map((p) => (
              <button key={p} type="button" className="etf-nav-row" onClick={() => openCross(p)}>{p}<span className="etf-rel-go">→</span></button>
            ))}
          </div>
        ) : <Ghost label="No related curated pairs." />}
      </Panel>

      <Panel title="Macro Comparison">
        <Ghost label="Macro comparison data is not available for this currency pair yet." />
      </Panel>
    </div>
  );
}

export default CurrencyCompare;
