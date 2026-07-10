import { useState } from "react";
import { zeninFetch } from "../../utils/zeninFetch";

// Asset picker reused for the empty slot(s) in a comparison.
// Mirrors the global search endpoint (/search?q=&type=).
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
      const res = await zeninFetch(`/search?q=${encodeURIComponent(term)}&type=tradfi`, {});
      const list = Array.isArray(res) ? res : Array.isArray(res?.results) ? res.results : [];
      setResults(list.slice(0, 8));
    } catch {
      // Fallback: accept a raw symbol directly.
      setResults([{ symbol: term.toUpperCase().trim(), name: term.toUpperCase().trim(), type: "equity" }]);
    } finally {
      setLoading(false);
    }
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
          </button>
        ))}
        {!loading && q && results.length === 0 ? (
          <div className="cmp-picker-status">No matches — press Enter to use “{q.toUpperCase()}” directly.</div>
        ) : null}
      </div>
    </div>
  );
}
