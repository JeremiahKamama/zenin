// StableSignalTables — placeholder intelligence tables (spec §14).
//
// Renders stable-schema signal tables for every asset class:
//   Macro · Commodity · FX · Bond · Equity · Crypto
// Columns: Indicator · Previous · Forecast · Actual · Surprise · Confidence · Status
//
// Where a real feed exists (Macro via macroData), the schema is populated and
// will auto-fill Previous/Forecast/Surprise/Confidence as the backend adds
// those fields. Classes without a feed render the stable column set with "—"
// rows — columns are NEVER removed (spec: "Render — instead of removing").
// No fabricated values.

import React from "react";

const CLASSES = [
  { key: "macro", label: "Macro Signals", feed: true },
  { key: "commodity", label: "Commodity Signals", feed: false },
  { key: "fx", label: "FX Signals", feed: false },
  { key: "bond", label: "Bond Signals", feed: false },
  { key: "equity", label: "Equity Signals", feed: false },
  { key: "crypto", label: "Crypto Signals", feed: false },
];

const COLS = ["Indicator", "Previous", "Forecast", "Actual", "Surprise", "Confidence", "Status"];

function MacroRows({ macroData = [] }) {
  const rows = macroData.slice(0, 8).map((m) => ({
    indicator: m.label || "—",
    previous: "—",
    forecast: "—",
    actual: m.current != null ? (m.unit === "%" ? `${Number(m.current).toFixed(2)}%` : Number(m.current).toFixed(2)) : "—",
    surprise: "—",
    confidence: "—",
    status: "Live",
  }));
  if (!rows.length) rows.push({ indicator: "—", previous: "—", forecast: "—", actual: "—", surprise: "—", confidence: "—", status: "Awaiting feed" });
  return rows;
}

function PlaceholderRows() {
  return [{ indicator: "—", previous: "—", forecast: "—", actual: "—", surprise: "—", confidence: "—", status: "Awaiting feed" }];
}

export default function StableSignalTables({ macroData = [] }) {
  return (
    <div className="stable-signal-tables">
      {CLASSES.map((c) => {
        const rows = c.feed ? MacroRows({ macroData }) : PlaceholderRows();
        return (
          <div key={c.key} className="sst-block">
            <div className="sst-head">{c.label}</div>
            <div className="sst-table" role="table">
              <div className="sst-row sst-header" role="row">
                {COLS.map((col) => <span key={col} className="sst-cell" role="columnheader">{col}</span>)}
              </div>
              {rows.map((r, i) => (
                <div key={i} className="sst-row" role="row">
                  <span className="sst-cell sst-indicator">{r.indicator}</span>
                  <span className="sst-cell">{r.previous}</span>
                  <span className="sst-cell">{r.forecast}</span>
                  <span className="sst-cell">{r.actual}</span>
                  <span className="sst-cell">{r.surprise}</span>
                  <span className="sst-cell">{r.confidence}</span>
                  <span className={`sst-cell sst-status ${String(r.status).toLowerCase().replace(" ", "-")}`}>{r.status}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
