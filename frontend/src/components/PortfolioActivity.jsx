// components/PortfolioActivity.jsx
// Provider-neutral Portfolio Activity view (spec: "Complete the multi-source portfolio
// user flow" -> Portfolio Activity). Consumes the unified read model:
//   - transactions (unifiedPortfolio.transactions) across all connected sources
//   - reconciliation (unifiedPortfolio.reconciliation) for duplicate-exposure + gaps
//   - syncStatus (unifiedPortfolio.syncStatus) for source health
// Honors deep-link filters from the URL (?source=&account=&type=&tx=) so notification
// deep links open the relevant context. Monochrome — reuses design-system tokens only.
import React, { useMemo, useState } from "react";
import { AssetLogo } from "./AssetLogo";

const TYPE_OPTIONS = ["", "buy", "sell", "fill", "dividend", "interest", "fee", "deposit", "withdrawal", "transfer", "adjustment"];

function parseQuery() {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  return {
    source: p.get("source") || "",
    account: p.get("account") || "",
    type: p.get("type") || "",
    tx: p.get("tx") || ""
  };
}

function fmtMoney(v, currency = "USD") {
  const n = Number(v || 0);
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n); }
  catch { return `${currency} ${n.toFixed(0)}`; }
}

function fmtDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString();
}

export function PortfolioActivity({ transactions = [], reconciliation = null, syncStatus = null, baseCurrency = "USD", connectedAccounts = [] }) {
  const deep = useMemo(parseQuery, []);
  const [source, setSource] = useState(deep.source || "");
  const [account, setAccount] = useState(deep.account || "");
  const [type, setType] = useState(deep.type || "");
  const [symbol, setSymbol] = useState("");

  // Map a transaction's (provider, sourceType) to the user-set account label
  // from Settings, so the Account dropdown shows the real label, not "wallet".
  const accountLabelMap = useMemo(() => {
    const m = new Map();
    (Array.isArray(connectedAccounts) ? connectedAccounts : []).forEach((a) => {
      const st = a.venueType === "dex" ? "wallet" : a.venueType === "broker" ? "brokerage" : "exchange";
      if (a.provider) m.set(`${String(a.provider).toLowerCase()}|${st}`, a.username || a.provider);
    });
    return m;
  }, [connectedAccounts]);

  const sources = useMemo(() => {
    const set = new Set();
    (Array.isArray(transactions) ? transactions : []).forEach((t) => { if (t.provider) set.add(t.provider); });
    (syncStatus && Array.isArray(syncStatus.sources) ? syncStatus.sources : []).forEach((s) => { if (s.provider) set.add(s.provider); });
    return [...set].sort();
  }, [transactions, syncStatus]);

  // Resolve a transaction's account label (falls back to raw sourceAccountId/sourceType).
  const resolveAccountLabel = (t) =>
    (t && accountLabelMap.get(`${String(t.provider || "").toLowerCase()}|${t.sourceType || ""}`)) ||
    t?.sourceAccountId || t?.sourceType || "";

  const accounts = useMemo(() => {
    const set = new Set();
    (Array.isArray(transactions) ? transactions : []).forEach((t) => {
      const label = resolveAccountLabel(t);
      if (label) set.add(label);
    });
    return [...set].sort();
  }, [transactions, accountLabelMap, resolveAccountLabel]);

  const filtered = useMemo(() => {
    return (Array.isArray(transactions) ? transactions : []).filter((t) => {
      if (source && String(t.provider || "").toLowerCase() !== String(source).toLowerCase()) return false;
      if (account && resolveAccountLabel(t) !== String(account)) return false;
      if (type && String(t.type || "").toLowerCase() !== String(type).toLowerCase()) return false;
      if (symbol && String(t.symbol || "").toLowerCase().indexOf(String(symbol).toLowerCase()) === -1) return false;
      if (deep.tx && String(t.externalTransactionId || t.id) !== String(deep.tx)) return false;
      return true;
    });
  }, [transactions, source, account, type, symbol, deep.tx, accountLabelMap, resolveAccountLabel]);

  const duplicateInstruments = reconciliation && Array.isArray(reconciliation.duplicateInstruments) ? reconciliation.duplicateInstruments : [];
  const warnings = reconciliation && Array.isArray(reconciliation.warnings) ? reconciliation.warnings : [];

  return (
    <div className="pa-activity" aria-label="Portfolio activity">
      <div className="pa-filters">
        <label className="pa-filter">
          <span>Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All</option>
            {sources.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="pa-filter">
          <span>Account</span>
          <select value={account} onChange={(e) => setAccount(e.target.value)}>
            <option value="">All</option>
            {accounts.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
        <label className="pa-filter">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            {TYPE_OPTIONS.map((t) => <option key={t} value={t}>{t ? t : "All"}</option>)}
          </select>
        </label>
        <label className="pa-filter">
          <span>Symbol</span>
          <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="e.g. AAPL" />
        </label>
      </div>

      {(duplicateInstruments.length > 0 || warnings.length > 0) && (
        <div className="pa-reconcile">
          <h4>Reconciliation</h4>
          {duplicateInstruments.length > 0 && (
            <div className="pa-warn">
              <span className="pa-warn-tag">Duplicate exposure</span>
              <ul>
                {duplicateInstruments.map((d) => (
                  <li key={d.instrumentKey}>
                    <strong>
                      {Array.isArray(d.symbols) ? <><AssetLogo asset={{ symbol: d.symbols[0] }} size="xs" /> {d.symbols[0]}</> : d.instrumentKey}
                    </strong> across {Array.isArray(d.providers) ? d.providers.join(", ") : ""}
                    <span className="pa-warn-note"> · shown separately, not netted</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {warnings.map((w, i) => (
            <div key={i} className="pa-warn">
              <span className="pa-warn-tag">{w.type || "gap"}</span>
              <span className="pa-warn-note">{w.currency ? `${w.currency}: ` : ""}{w.reason || ""}</span>
            </div>
          ))}
        </div>
      )}

      <div className="pa-list-wrap">
        <div className="pa-list-head">
          <span>{filtered.length} transaction{filtered.length === 1 ? "" : "s"}</span>
        </div>
        {filtered.length === 0 ? (
          <div className="pa-empty">No transactions match these filters.</div>
        ) : (
          <ul className="pa-list">
            {filtered.slice(0, 200).map((t, i) => (
              <li key={t.externalTransactionId || t.id || i} className="pa-row">
                <span className="pa-row-type">{t.type || "txn"}</span>
                <span className="pa-row-symbol">
                  {t.symbol ? <><AssetLogo asset={t} size="xs" /> {t.symbol}</> : "—"}
                </span>
                <span className="pa-row-qty">{t.quantity != null ? `${t.quantity}` : ""}</span>
                <span className="pa-row-meta">
                  {t.provider || ""}{resolveAccountLabel(t) ? ` · ${resolveAccountLabel(t)}` : ""}
                </span>
                <span className="pa-row-val">{fmtMoney(t.notional || t.value || 0, t.currency || baseCurrency)}</span>
                <span className="pa-row-date">{fmtDate(t.executedAt || t.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default PortfolioActivity;
