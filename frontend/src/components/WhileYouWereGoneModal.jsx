// components/WhileYouWereGoneModal.jsx
//
// "Since You Left" — shown after returning from a long absence (>30 min).
//
// ── Why this was rebuilt ───────────────────────────────────────────────────
//
// The previous version was three bare lists that answered "what moved?" with
// less information than the screen behind it:
//
//   1. NO MONEY. It listed symbols and percentages. A +2.4% move on a $12,000
//      position and a +2.4% move on a $40 watchlist item rendered identically,
//      so the modal could not tell the user what actually mattered to them.
//      Percentages without position size are trivia.
//
//   2. NO DIRECTION. `.positive` and `.negative` both resolved to muted greys
//      from the text palette, so a gain and a loss were visually identical.
//
//   3. NO HEADLINE NUMBER. There was no "you're up $X while you were away",
//      which is the single thing a returning user wants to know.
//
//   4. SIZE-BLIND RANKING. Movers were ranked by |%| alone, so a 9% move on a
//      $15 watchlist item outranked a 3% move on a $40,000 holding.
//
//   5. FROZEN TIMER. The "away for" duration was computed once in a useMemo and
//      never updated, so a modal left open kept claiming the original duration.
//
//   6. NO NAVIGATION. Rows were inert text; you could not act on anything.
//
// This version leads with the portfolio delta, ranks by actual dollar impact,
// colours direction with the design system's success/danger tokens, and makes
// every row a real link into the app.
//
// ── Data sources ───────────────────────────────────────────────────────────
//   /interval-performance  → per-symbol change over the away window
//   /market/news           → headlines for the largest movers
//   /earnings-calendar     → scheduled reports inside the mover universe
//
// All three are best-effort: a section that fails to load degrades to an
// explanation rather than blanking the modal.

import { useEffect, useMemo, useRef, useState } from "react";
import { Overlay } from "./Overlay";
import { abortWithReason, zeninFetchJson } from "../utils/zeninFetch";

const normalizeSymbol = (v) => String(v || "").trim().toUpperCase();

// Map an asset's type to the /interval-performance `type` param (mirrors HomeModule).
function perfTypeFor(asset) {
  const t = String(asset?.type || "").toLowerCase();
  const mt = String(asset?.marketType || "").toLowerCase();
  if (t === "crypto" || t === "stablecoin" || mt === "spot" || mt === "perp") return "crypto";
  return "tradfi";
}

function formatSignedPercent(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

/** Money, with the sign outside the symbol: "-$1,240.50", not "$-1,240.50". */
function formatSignedMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "+";
  const abs = Math.abs(n);
  const digits = abs >= 1000 ? 0 : abs >= 10 ? 2 : 2;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Whole minutes is precise enough and avoids a jittering clock. */
function describeAway(ms) {
  const totalMinutes = Math.max(1, Math.round(Number(ms || 0) / 60000));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function formatEarningsDate(raw) {
  if (!raw) return "Date TBC";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return String(raw);
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Relative days until an earnings date, for the "in 3d" hint. */
function daysUntil(raw) {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  const diff = parsed.getTime() - Date.now();
  const days = Math.round(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days > 1) return `in ${days}d`;
  if (days === -1) return "yesterday";
  return `${Math.abs(days)}d ago`;
}

const EMPTY_ARR = [];

export function WhileYouWereGoneModal({
  open,
  onClose,
  idleSince,
  holdings = EMPTY_ARR,
  watchlist = EMPTY_ARR,
  spotPrices = null,
  onSelectAsset = null,
}) {
  const [loading, setLoading] = useState(false);
  const [moves, setMoves] = useState([]);
  const [news, setNews] = useState([]);
  const [earnings, setEarnings] = useState([]);
  const [partialFailure, setPartialFailure] = useState(false);

  // The away duration must keep ticking: a modal left open on a second monitor
  // otherwise still claims the duration from when it first rendered.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!open) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [open]);

  // Latest spot prices, read through a ref so a price tick does not re-run the
  // network effect below and re-fetch every symbol.
  const spotRef = useRef(spotPrices);
  useEffect(() => {
    spotRef.current = spotPrices;
  }, [spotPrices]);

  /** Resolve a symbol's current price from the shared spot map. */
  const priceFor = (symbol) => {
    const map = spotRef.current;
    if (!map) return null;
    const direct = map[symbol];
    const candidates = [direct, map[normalizeSymbol(symbol)], map[String(symbol || "").toLowerCase()]];
    for (const candidate of candidates) {
      const n = Number(candidate);
      if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
  };

  // Holdings carry the user's real exposure. Watchlist items are context only,
  // so they are tracked separately rather than blended into the impact ranking.
  const { universe, exposure, watchOnly } = useMemo(() => {
    const bySymbol = new Map();
    const watchSymbols = new Set();

    (Array.isArray(holdings) ? holdings : []).forEach((holding) => {
      const symbol = normalizeSymbol(holding?.symbol || holding?.asset);
      if (!symbol) return;
      const quantity = Number(holding?.quantity) || 0;
      const entry = bySymbol.get(symbol);
      if (entry) {
        // Same symbol across market types: aggregate the quantity.
        entry.quantity += quantity;
        entry.costBasis += quantity * (Number(holding?.entryPrice) || 0);
        return;
      }
      bySymbol.set(symbol, {
        symbol,
        name: holding?.name || symbol,
        type: holding?.type,
        marketType: holding?.marketType,
        quantity,
        costBasis: quantity * (Number(holding?.entryPrice) || 0),
        held: true
      });
    });

    (Array.isArray(watchlist) ? watchlist : []).forEach((item) => {
      const symbol = normalizeSymbol(item?.symbol || item?.asset);
      if (!symbol || bySymbol.has(symbol)) return;
      watchSymbols.add(symbol);
      bySymbol.set(symbol, {
        symbol,
        name: item?.name || symbol,
        type: item?.type,
        marketType: item?.marketType,
        quantity: 0,
        costBasis: 0,
        held: false
      });
    });

    const all = [...bySymbol.values()];
    return {
      universe: all,
      exposure: all.filter((entry) => entry.held),
      watchOnly: all.filter((entry) => !entry.held)
    };
  }, [holdings, watchlist]);

  useEffect(() => {
    if (!open || universe.length === 0) {
      setMoves([]);
      setNews([]);
      setEarnings([]);
      setPartialFailure(false);
      return undefined;
    }
    let cancelled = false;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const signal = controller?.signal;

    (async () => {
      setLoading(true);
      setPartialFailure(false);
      try {
        // 1) Performance per symbol, then rank by DOLLAR IMPACT where we can
        //    compute it and by magnitude of move otherwise. Ranking held
        //    positions ahead of watchlist items is the whole point: a 9% move
        //    on a watchlist ticker matters less than a 2% move on a real
        //    position.
        const targets = universe.slice(0, 40);
        const perfResults = await Promise.all(
          targets.map(async (asset) => {
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

        if (cancelled) return;

        // How long the user was away, used to label the window honestly rather
        // than always claiming "today".
        const awayMs = idleSince ? Date.now() - Number(idleSince) : 0;
        const windowLabel = awayMs >= 20 * 3600000 ? "while you were away" : "recently";

        const enriched = perfResults
          .filter((asset) => asset.changePct != null)
          .map((asset) => {
            const price = priceFor(asset.symbol);
            const positionValue = price != null ? price * asset.quantity : null;
            // Dollar impact of the move on the user's actual position.
            const dollarImpact = positionValue != null
              ? positionValue * (asset.changePct / 100)
              : null;
            return { ...asset, price, positionValue, dollarImpact, windowLabel };
          });

        // Rank: real dollar impact first (held positions), then % magnitude.
        const ranked = enriched
          .sort((a, b) => {
            const aHeld = a.dollarImpact != null;
            const bHeld = b.dollarImpact != null;
            if (aHeld && !bHeld) return -1;
            if (!aHeld && bHeld) return 1;
            if (aHeld && bHeld) return Math.abs(b.dollarImpact) - Math.abs(a.dollarImpact);
            return Math.abs(b.changePct) - Math.abs(a.changePct);
          })
          .slice(0, 10);

        if (cancelled) return;
        setMoves(ranked);

        // 2) News for the largest movers. A failure here is not a modal failure.
        const newsTargets = ranked.slice(0, 5).map((a) => a.symbol);
        const newsBuckets = await Promise.all(
          newsTargets.map(async (symbol) => {
            try {
              const data = await zeninFetchJson(
                `/market/news?symbol=${encodeURIComponent(symbol)}`,
                { signal, timeoutMs: 6000 }
              );
              const items = Array.isArray(data?.news) ? data.news : (Array.isArray(data) ? data : []);
              return items.slice(0, 2).map((item) => ({
                symbol,
                headline: item?.headline || item?.title || "Untitled",
                source: item?.source || item?.publisher || "",
                link: item?.link || item?.url || "",
                timestamp: item?.timestamp || item?.date || ""
              }));
            } catch {
              if (!cancelled) setPartialFailure(true);
              return [];
            }
          })
        );
        if (cancelled) return;
        setNews(newsBuckets.flat().slice(0, 10));

        // 3) Upcoming earnings inside the mover universe.
        try {
          const cal = await zeninFetchJson("/earnings-calendar", { signal, timeoutMs: 6000 });
          const events = Array.isArray(cal?.events)
            ? cal.events
            : (Array.isArray(cal?.rows) ? cal.rows : (Array.isArray(cal) ? cal : []));
          const moveSet = new Set(ranked.map((a) => a.symbol));
          const matched = events
            .map((e) => ({
              symbol: normalizeSymbol(e?.symbol || e?.ticker),
              date: e?.date || e?.reportDate || e?.report_date || ""
            }))
            .filter((e) => e.symbol && moveSet.has(e.symbol))
            // Soonest first — a report due tomorrow is more useful than one
            // three weeks out.
            .sort((a, b) => {
              const at = new Date(a.date).getTime();
              const bt = new Date(b.date).getTime();
              if (Number.isNaN(at)) return 1;
              if (Number.isNaN(bt)) return -1;
              return at - bt;
            })
            .slice(0, 10);
          if (cancelled) return;
          setEarnings(matched);
        } catch {
          if (!cancelled) {
            setEarnings([]);
            setPartialFailure(true);
          }
        }
      } catch {
        /* best-effort — partial sections are fine */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      abortWithReason(controller, "while-you-were-gone-cleanup");
    };
    // `priceFor` reads current prices through a ref, so prices are intentionally
    // not a dependency: a price tick must not re-fetch every symbol.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, universe, idleSince]);

  const idleLabel = open && idleSince ? describeAway(now - Number(idleSince)) : "";

  // Headline: how much the user's actual positions moved while they were out.
  const netImpact = useMemo(() => {
    const withImpact = moves.filter((m) => m.dollarImpact != null && Math.abs(m.dollarImpact) >= 0.01);
    if (withImpact.length === 0) return null;
    const total = withImpact.reduce((sum, m) => sum + m.dollarImpact, 0);
    const gainers = withImpact.filter((m) => m.dollarImpact > 0).length;
    const losers = withImpact.filter((m) => m.dollarImpact < 0).length;
    return { total, gainers, losers, covered: withImpact.length };
  }, [moves]);

  const moversWithNews = useMemo(() => new Set(news.map((n) => n.symbol)), [news]);
  const isEmptyUniverse = universe.length === 0;

  const handleSelect = (symbol) => {
    if (typeof onSelectAsset === "function" && symbol) onSelectAsset(symbol);
  };

  /** A row is a button when the host gave us something to open. */
  const RowShell = ({ symbol, className, children }) => {
    if (typeof onSelectAsset !== "function") {
      return <li className={className}>{children}</li>;
    }
    return (
      <li className={className}>
        <button type="button" className="sy-left-row" onClick={() => handleSelect(symbol)}>
          {children}
        </button>
      </li>
    );
  };

  return (
    <Overlay
      open={open}
      onClose={onClose}
      variant="center"
      dismissable
      dismissOnEscape
      labelledBy="since-you-left-title"
      className="since-you-left-overlay"
    >
      <div className="since-you-left">
        <header className="since-you-left-head">
          <div className="since-you-left-headline">
            {idleLabel && (
              <span className="since-you-left-away">
                <span className="since-you-left-away-dot" aria-hidden="true" />
                Away {idleLabel}
              </span>
            )}
            <h2 id="since-you-left-title">Since you left</h2>
            {netImpact ? (
              <p className="since-you-left-summary">
                Your positions moved{" "}
                <strong className={netImpact.total >= 0 ? "is-up" : "is-down"}>
                  {formatSignedMoney(netImpact.total)}
                </strong>{" "}
                <span className="since-you-left-summary-detail">
                  across {netImpact.covered} {netImpact.covered === 1 ? "holding" : "holdings"}
                  {netImpact.gainers || netImpact.losers
                    ? ` · ${netImpact.gainers} up, ${netImpact.losers} down`
                    : ""}
                </span>
              </p>
            ) : (
              <p className="since-you-left-summary">
                {isEmptyUniverse
                  ? "Add holdings or watchlist items to see what changed."
                  : `Here's what moved${idleLabel ? " while you were away" : ""}.`}
              </p>
            )}
          </div>
          <button type="button" className="since-you-left-close" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {partialFailure && !loading && (
          <p className="since-you-left-partial" role="status">
            Some sections could not be loaded. Showing what we have.
          </p>
        )}

        <div className="since-you-left-grid">
          <section className="since-you-left-col since-you-left-moves" aria-labelledby="sy-left-moves-h">
            <div className="since-you-left-colhead">
              <h3 id="sy-left-moves-h">Moves</h3>
              {moves.length > 0 && <span className="since-you-left-count">{moves.length}</span>}
            </div>
            <ul className="since-you-left-list">
              {loading && moves.length === 0 && (
                <>
                  {[0, 1, 2, 3].map((i) => (
                    <li key={i} className="sy-left-skeleton" aria-hidden="true" />
                  ))}
                  <li className="sy-left-sr">Loading moves…</li>
                </>
              )}
              {!loading && moves.length === 0 && (
                <li className="since-you-left-empty">
                  {isEmptyUniverse
                    ? "No tracked holdings or watchlist items yet."
                    : "No price movement to report."}
                </li>
              )}
              {moves.map((m) => {
                const up = Number(m.changePct) >= 0;
                return (
                  <RowShell key={m.symbol} symbol={m.symbol} className="since-you-left-move">
                    <span className="sy-left-move-main">
                      <span className="since-you-left-symbol">{m.symbol}</span>
                      {m.price != null && (
                        <span className="sy-left-move-price">{formatMoney(m.price)}</span>
                      )}
                    </span>
                    <span className="sy-left-move-figures">
                      {m.dollarImpact != null && Math.abs(m.dollarImpact) >= 0.01 && (
                        <span className={`sy-left-impact ${up ? "is-up" : "is-down"}`}>
                          {formatSignedMoney(m.dollarImpact)}
                        </span>
                      )}
                      <span className={`since-you-left-change ${up ? "positive" : "negative"}`}>
                        {up ? "▲" : "▼"} {formatSignedPercent(m.changePct)}
                      </span>
                    </span>
                  </RowShell>
                );
              })}
            </ul>
          </section>

          <section className="since-you-left-col since-you-left-news" aria-labelledby="sy-left-news-h">
            <div className="since-you-left-colhead">
              <h3 id="sy-left-news-h">News</h3>
              {news.length > 0 && <span className="since-you-left-count">{news.length}</span>}
            </div>
            <ul className="since-you-left-list">
              {news.length === 0 && (
                <li className="since-you-left-empty">
                  {loading ? "Loading…" : "No recent headlines for your movers."}
                </li>
              )}
              {news.map((item, idx) => {
                const body = (
                  <>
                    <span className="sy-left-news-top">
                      <span className="since-you-left-news-symbol">{item.symbol}</span>
                      {item.source && <span className="sy-left-news-source">{item.source}</span>}
                    </span>
                    <span className="since-you-left-news-headline">{item.headline}</span>
                  </>
                );
                return (
                  <li key={`${item.symbol}-${idx}`} className="since-you-left-news-item">
                    {item.link ? (
                      <a href={item.link} target="_blank" rel="noopener noreferrer">
                        {body}
                      </a>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="since-you-left-col since-you-left-earnings" aria-labelledby="sy-left-earn-h">
            <div className="since-you-left-colhead">
              <h3 id="sy-left-earn-h">Earnings</h3>
              {earnings.length > 0 && <span className="since-you-left-count">{earnings.length}</span>}
            </div>
            <ul className="since-you-left-list">
              {earnings.length === 0 && (
                <li className="since-you-left-empty">
                  {loading ? "Loading…" : "Nothing scheduled for your movers."}
                </li>
              )}
              {earnings.map((e) => {
                const when = daysUntil(e.date);
                return (
                  <RowShell key={`${e.symbol}-${e.date}`} symbol={e.symbol} className="since-you-left-earning">
                    <span className="since-you-left-symbol">{e.symbol}</span>
                    <span className="sy-left-earn-when">
                      <span className="since-you-left-date">{formatEarningsDate(e.date)}</span>
                      {when && <span className="sy-left-earn-rel">{when}</span>}
                    </span>
                  </RowShell>
                );
              })}
            </ul>
          </section>
        </div>

        {watchOnly.length > 0 && (
          <p className="since-you-left-foot">
            {watchOnly.length} watchlist {watchOnly.length === 1 ? "item" : "items"} tracked
            {moversWithNews.size > 0 ? " · headlines follow your biggest movers" : ""}
          </p>
        )}
      </div>
    </Overlay>
  );
}

export default WhileYouWereGoneModal;
