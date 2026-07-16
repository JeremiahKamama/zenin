// assetModal/RegulatoryContext.jsx
// Per spec §3: compact regulatory-context panel beside portfolio context in the
// stock Asset Modal. Shows latest filing, material-event count, net insider
// direction, source, and freshness. Renders ONLY when data exists (honest
// empty state otherwise). Stock-only — ETF surfaces use fund-regulatory
// language (Phase 2, spec §5) and must NOT show company-only fields.
import React, { useMemo } from "react";
import { useDocumentIntelligence } from "../../hooks/useDocumentIntelligence";

const ALERT_FORMS = new Set(["8-K", "10-K", "10-Q", "DEF 14A", "S-1", "S-3", "SC 13D", "SC 13G"]);

const freshnessLabel = (f) =>
  f === "fresh" ? "Live" : f === "stale" ? "Stale" : f === "unavailable" ? "Unavailable" : "—";

export function RegulatoryContext({ asset }) {
  const sym = String(asset?.symbol || "").toUpperCase();
  const di = useDocumentIntelligence(sym);

  const materialCount = useMemo(() => {
    const list = Array.isArray(di?.timeline) ? di.timeline : [];
    return list.filter((f) => ALERT_FORMS.has((f?.formType || "").trim())).length;
  }, [di?.timeline]);

  const insiderDir = di?.insiders?.netDirection || null; // "buy" | "sell" | "neutral"
  const latest = di?.latestFiling || null;
  const hasData = Boolean(latest || di?.ownership || di?.insiders || materialCount > 0);

  if (!sym || di?.loading === false && !hasData) {
    return (
      <section className="am-regulatory-card am-regulatory-card--empty" data-testid="regulatory-context">
        <div className="am-regulatory-empty">
          <p className="muted">No regulatory filings available for {sym}.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="am-regulatory-card" data-testid="regulatory-context">
      <div className="am-regulatory-head">
        <span className="am-regulatory-title">Regulatory Context</span>
        <span className={`am-freshness am-freshness--${di?.freshness || "unknown"}`}>
          {freshnessLabel(di?.freshness)} · {di?.provider || "—"}
        </span>
      </div>
      <dl className="am-regulatory-grid">
        <div className="am-regulatory-row">
          <dt>Latest filing</dt>
          <dd>
            {latest ? (
              <a href={latest.url || di?.sourceUrl || "#"} target="_blank" rel="noreferrer">
                {latest.formType || "—"} · {latest.filedAt ? new Date(latest.filedAt).toLocaleDateString() : "—"}
              </a>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div className="am-regulatory-row">
          <dt>Material events</dt>
          <dd>{materialCount}</dd>
        </div>
        <div className="am-regulatory-row">
          <dt>Net insider</dt>
          <dd className={insiderDir ? `am-insider--${insiderDir}` : ""}>
            {insiderDir ? insiderDir.toUpperCase() : "—"}
          </dd>
        </div>
        <div className="am-regulatory-row">
          <dt>Institutional</dt>
          <dd>{di?.ownership?.institutionalPct != null ? `${di.ownership.institutionalPct}%` : "—"}</dd>
        </div>
      </dl>
    </section>
  );
}

export default RegulatoryContext;
