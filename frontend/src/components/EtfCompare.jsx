// EtfCompare — Rec 8: persistent in-ARW comparison.
// ETF vs ETF / Index / Portfolio on REAL seed fields (issuer / category /
// benchmark / exposure). No live NAV/return series exist yet (provider
// returns null), so performance/correlation rows honestly show "—".
// Monochrome, token-driven.
import { useMemo, useState } from "react";
import { compareEtfs, browseEtfs } from "../utils/etfIntelligence";

export function EtfCompare({ initialA, initialB, onOpenResearch, onClose }) {
  const allEtfs = useMemo(() => browseEtfs("all"), []);
  const [a, setA] = useState(initialA || "SPY");
  const [b, setB] = useState(initialB || "QQQ");
  const cmp = useMemo(() => compareEtfs(a, b), [a, b]);
  return (
    <section className="etf-compare">
      <header className="etf-cmp-head">
        <h2 className="etf-cmp-title">ETF Comparison</h2>
        <p className="etf-note muted">Compare on reference fields. Live performance/correlation pending the ETF Intelligence Provider.</p>
        {onClose ? <button type="button" className="etf-btn-sm" onClick={onClose}>Close</button> : null}
      </header>
      <div className="etf-cmp-selectors">
        <select className="etf-select" value={a} onChange={(e) => setA(e.target.value)} aria-label="ETF A">
          {allEtfs.map((m) => <option key={m.sym} value={m.sym}>{m.sym} — {m.name}</option>)}
        </select>
        <span className="etf-cmp-vs">vs</span>
        <select className="etf-select" value={b} onChange={(e) => setB(e.target.value)} aria-label="ETF B">
          {allEtfs.map((m) => <option key={m.sym} value={m.sym}>{m.sym} — {m.name}</option>)}
        </select>
      </div>
      {cmp ? (
        <>
          <table className="etf-cmp-table">
            <thead><tr><th>Dimension</th><th>{cmp.a.sym}</th><th>{cmp.b.sym}</th></tr></thead>
            <tbody>
              {cmp.dims.map((d) => (
                <tr key={d.dim}><td>{d.dim}</td><td>{d.a}</td><td>{d.b}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="etf-cmp-extra">
            <div className="etf-cmp-block">
              <span className="etf-cmp-label">Overlap (shared exposure)</span>
              {cmp.overlap.length ? <span className="etf-cmp-tags">{cmp.overlap.join(", ")}</span> : <span className="etf-note muted">none</span>}
            </div>
            <div className="etf-cmp-block">
              <span className="etf-cmp-label">Shared peer ETFs</span>
              {cmp.sharedPeers.length ? <span className="etf-cmp-tags">{cmp.sharedPeers.join(", ")}</span> : <span className="etf-note muted">none</span>}
            </div>
          </div>
          <div className="etf-cmp-actions">
            <button type="button" className="etf-btn-sm" onClick={() => onOpenResearch?.({ symbol: a })}>{a} Research</button>
            <button type="button" className="etf-btn-sm" onClick={() => onOpenResearch?.({ symbol: b })}>{b} Research</button>
          </div>
        </>
      ) : <p className="etf-note muted">Select two known ETFs to compare.</p>}
    </section>
  );
}

export default EtfCompare;
