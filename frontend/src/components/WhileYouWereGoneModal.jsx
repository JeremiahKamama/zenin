// components/WhileYouWereGoneModal.jsx
//
// "While You Were Gone" modal — shown after returning from inactivity (>30 min).
// Three sections, matching the reference design:
//   1. MOVES (10): top market movers by interval change %, sourced from the
//      user's portfolio holdings and/or watchlist (whichever is available).
//   2. NEWS: up to 10 news items pulled per asset from the top movers.
//   3. UPCOMING EARNINGS: earnings-calendar entries for the mover symbols.
//
// Data is fetched on open via existing endpoints (/interval-performance,
// /api/market/news, /earnings-calendar). Self-contained: it derives the mover
// universe from props (holdings + watchlist) so it works on any section.

import { useEffect, useMemo, useState } from "react";
import { Overlay } from "./Overlay";
import { zeninFetchJson } from "../utils/zeninFetch";

const normalizeSymbol = (v) => String(v || "").trim().toUpperCase();

// Map an asset's type to the /interval-performance `type` param (mirrors HomeModule).
function perfTypeFor(asset) {
  const t = String(asset?.type || "").toLowerCase();
  const mt = String(asset?.marketType || "").toLowerCase();
  if (t === "crypto" || t === "stablecoin" || mt === "spot" || mt === "perp") return "crypto";
  return "tradfi";
}

function formatSignedPercent(value, digits = 2) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function WhileYouWereGoneModal({
  open,
  onClose,
  idleSince,
  holdings = [],
  watchlist = [],
}) {
  const [loading, setLoading] = useState(false);
  const [moves, setMoves] = useState([]);
  const [news, setNews] = useState([]);
  const [earnings, setEarnings] = useState([]);

  // Build the mover universe from holdings first, then watchlist (deduped).
  const universe = useMemo(() => {
    const map = new Map();
    const add = (asset) => {
      const symbol = normalizeSymbol(asset?.symbol || asset?.asset);
      if (!symbol) return;
      if (map.has(symbol)) return;
      map.set(symbol, { symbol, name: asset?.name || symbol, type: asset?.type, marketType: asset?.marketType });
    };
    (Array.isArray(holdings) ? holdings : []).forEach(add);
    (Array.isArray(watchlist) ? watchlist : []).forEach(add);
    return [...map.values()];
  }, [holdings, watchlist]);

  useEffect(() => {
    if (!open || universe.length === 0) {
      setMoves([]);
      setNews([]);
      setEarnings([]);
      return undefined;
    }
    let cancelled = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const signal = controller?.signal;

    (async () => {
      setLoading(true);
      try {
        // 1) Interval performance per universe symbol → rank to 10 movers.
        const perfResults = await Promise.all(
          universe.slice(0, 40).map(async (asset) => {
            try {
              const data = await zeninFetchJson(
                `/interval-performance?symbol=${encodeURIComponent(asset.symbol)}&type=${encodeURIComponent(perfTypeFor(asset))}`,
                { signal, timeoutMs: 6000 }
              );
              const daily = Number(data?.performance?.["1D"] ?? data?.performance?.["1W"] ?? null);
              return { ...asset, changePct: Number.isFinite(daily) ? daily : null };
            } catch {
              return { ...asset, changePct: null };
            }
          })
        );
        const ranked = perfResults
          .filter((a) => a.changePct != null)
          .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
          .slice(0, 10);
        if (cancelled) return;
        setMoves(ranked);

        // 2) News (up to 10) for the top mover symbols.
        const newsTargets = ranked.slice(0, 5).map((a) => a.symbol);
        const newsBuckets = await Promise.all(
          newsTargets.map(async (symbol) => {
            try {
              const data = await zeninFetchJson(`/market/news?symbol=${encodeURIComponent(symbol)}`, { signal, timeoutMs: 6000 });
              const items = Array.isArray(data?.news) ? data.news : (Array.isArray(data) ? data : []);
              return items.slice(0, 2).map((item) => ({
                symbol,
                headline: item?.headline || item?.title || "Untitled",
                source: item?.source || item?.publisher || "",
                link: item?.link || item?.url || "",
                timestamp: item?.timestamp || item?.date || "",
              }));
            } catch {
              return [];
            }
          })
        );
        if (cancelled) return;
        setNews(newsBuckets.flat().slice(0, 10));

        // 3) Upcoming earnings from the earnings calendar, filtered to mover symbols.
        try {
          const cal = await zeninFetchJson("/earnings-calendar", { signal, timeoutMs: 6000 });
          const events = Array.isArray(cal?.events) ? cal.events : (Array.isArray(cal?.rows) ? cal.rows : (Array.isArray(cal) ? cal : []));
          const moveSet = new Set(ranked.map((a) => a.symbol));
          const matched = events
            .map((e) => ({ symbol: normalizeSymbol(e?.symbol || e?.ticker), date: e?.date || e?.reportDate || e?.report_date || "" }))
            .filter((e) => e.symbol && moveSet.has(e.symbol))
            .slice(0, 10);
          if (cancelled) return;
          setEarnings(matched);
        } catch {
          if (!cancelled) setEarnings([]);
        }
      } catch {
        /* best-effort — partial sections are fine */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller?.abort();
    };
  }, [open, universe]);

  const idleLabel = useMemo(() => {
    if (!idleSince) return "";
    const mins = Math.max(0, Math.round((Date.now() - idleSince) / 60000));
    if (mins < 60) return `${mins} min`;
    const hrs = Math.floor(mins / 60);
    return `${hrs}h ${mins % 60}m`;
  }, [idleSince]);

  return (
    <Overlay open={open} onClose={onClose} variant="center" dismissable dismissOnEscape labelledBy="since-you-left-title" className="since-you-left-overlay">
      <div className="since-you-left">
        <header className="since-you-left-head">
          <div>
            <h2 id="since-you-left-title">Since You Left{idleLabel ? ` · ${idleLabel}` : ""}</h2>
            <p>Here&apos;s what moved while you were away.</p>
          </div>
          <button type="button" className="since-you-left-close" onClick={onClose} aria-label="Close">&times;</button>
        </header>

        <div className="since-you-left-grid">
          <section className="since-you-left-col since-you-left-moves">
            <h3>Moves ({moves.length})</h3>
            <ul className="since-you-left-list">
              {loading && moves.length === 0 && <li className="since-you-left-empty">Loading moves…</li>}
              {!loading && moves.length === 0 && <li className="since-you-left-empty">No tracked holdings or watchlist items.</li>}
              {moves.map((m) => (
                <li key={m.symbol} className="since-you-left-move">
                  <span className="since-you-left-symbol">{m.symbol}</span>
                  <span className={`since-you-left-change ${m.changePct >= 0 ? "positive" : "negative"}`}>
                    {formatSignedPercent(m.changePct)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="since-you-left-col since-you-left-news">
            <h3>News</h3>
            <ul className="since-you-left-list">
              {news.length === 0 && <li className="since-you-left-empty">{loading ? "Loading…" : "No recent news."}</li>}
              {news.map((item, idx) => (
                <li key={`${item.symbol}-${idx}`} className="since-you-left-news-item">
                  {item.link ? (
                    <a href={item.link} target="_blank" rel="noopener noreferrer">
                      <span className="since-you-left-news-symbol">{item.symbol}</span>
                      <span className="since-you-left-news-headline">{item.headline}</span>
                    </a>
                  ) : (
                    <>
                      <span className="since-you-left-news-symbol">{item.symbol}</span>
                      <span className="since-you-left-news-headline">{item.headline}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className="since-you-left-col since-you-left-earnings">
            <h3>Upcoming Earnings</h3>
            <ul className="since-you-left-list">
              {earnings.length === 0 && <li className="since-you-left-empty">{loading ? "Loading…" : "No upcoming earnings."}</li>}
              {earnings.map((e) => (
                <li key={`${e.symbol}-${e.date}`} className="since-you-left-earning">
                  <span className="since-you-left-symbol">{e.symbol}</span>
                  <span className="since-you-left-date">{e.date || "—"}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </Overlay>
  );
}

export default WhileYouWereGoneModal;
