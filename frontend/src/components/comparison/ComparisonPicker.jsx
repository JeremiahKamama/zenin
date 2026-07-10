import { useState } from "react";
import { zeninFetch } from "../../utils/zeninFetch";

// Asset picker reused for the empty slot(s) in a comparison.
// Primary search → /api/market/search (FMP, richer metadata: CIK/exchange/
// currency). When unauthenticated (route requires requireSignedIn) it 401s, so
// we fall back to the public /search?q=&type=tradfi (Yahoo). A raw symbol can
// always be used directly via the Enter key.
export function ComparisonPicker({ slotLabel, onPick, onCancel }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = async (term) => {
    setQ(term);
    if (!term || term.trim().length < 1) {
      setResults([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // FMP-backed richer metadata. Falls through to Yahoo on any failure
      // (including 401 requireSignedIn for guests).
      const res = await zeninFetch(`/api/market/search?q=${encodeURIComponent(term)}&limit=8`, {});
      const list = Array.isArray(res?.results) ? res.results : [];
      const mapped = list.map((r) => ({
        symbol: String(r.symbol || "").toUpperCase(),
        name: r.name || r.companyName || r.symbol || term,
        type: "equity",
        exchange: r.exchange || null,
        currency: r.currency || null,
      })).filter((r) => r.symbol);
      setResults(mapped.slice(0, 8));
    } catch {
      try {
        const yRes = await zeninFetch(`/search?q=${encodeURIComponent(term)}&type=tradfi`, {});
        const yList = Array.isArray(yRes) ? yRes : Array.isArray(yRes?.results) ? yRes.results : [];
        const mapped = yList.map((r) => ({
          symbol: String(r.symbol || "").toUpperCase(),
          name: r.name || r.symbol || term,
          type: r.type || "equity",
        })).filter((r) => r.symbol);
        setResults(mapped.slice(0, 8));
      } catch {
        // Final fallback: accept the typed text as a raw symbol.
        setResults([{ symbol: term.toUpperCase().trim(), name: term.toUpperCase().trim(), type: "equity" }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const pickFirst = () => {
    if (results.length) onPick(results[0]);
    else if (q && q.trim()) onPick({ symbol: q.toUpperCase().trim(), name: q.toUpperCase().trim(), type: "equity" });
  };

  return (
    <div className="cmp-picker" role="dialog" aria-label={`Choose ${slotLabel}`}>
      <div className="cmp-picker-head">
        <span>Choose {slotLabel}</span>
        {onCancel ? (
          <button className="cmp-picker-cancel" onClick={onCancel} aria-label="Cancel">✕</button>
        ) : null}
      </div>
      <input
        className="cmp-picker-input"
        autoFocus
        placeholder="Search symbol or name (e.g. AMD, TSLA)…"
        value={q}
        onChange={(e) => run(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            pickFirst();
          }
        }}
        aria-label="Search assets"
      />
      {loading ? <div className="cmp-picker-status">Searching…</div> : null}
      {error ? <div className="cmp-picker-status cmp-picker-error">{error}</div> : null}
      <div className="cmp-picker-results">
        {results.map((a) => (
          <button
            key={`${a.symbol}-${a.type || "equity"}`}
            className="cmp-picker-item"
            onClick={() => onPick({ symbol: a.symbol, name: a.name, type: a.type || "equity" })}
          >
            <span className="cmp-picker-sym">{a.symbol}</span>
            <span className="cmp-picker-name">{a.name}</span>
            {a.exchange ? <span className="cmp-picker-exch">{a.exchange}</span> : null}
          </button>
        ))}
        {!loading && q && results.length === 0 ? (
          <div className="cmp-picker-status">No matches — press Enter to use “{q.toUpperCase()}” directly.</div>
        ) : null}
      </div>
    </div>
  );
}
