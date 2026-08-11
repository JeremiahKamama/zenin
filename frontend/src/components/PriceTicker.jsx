import { useMemo, useRef, useState, useEffect, useCallback } from "react";
import { buildAssetRoute } from "../utils/assetRegistry";

/**
 * PriceTicker — global continuously-scrolling price tape rendered in the shared
 * layout directly beneath the top navbar. Visible on every Module page.
 *
 * Data is threaded from App's existing state (watchlistAssets + portfolioWithEntry)
 * — no independent fetching. The same live-price feed that updates the watchlist
 * and portfolio surfaces also drives this ticker.
 */
export function PriceTicker({
  watchlistAssets = [],
  portfolioHoldings = [],
  onNavigate,
  visible = true,
}) {
  const containerRef = useRef(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isReducedMotion, setIsReducedMotion] = useState(false);

  // Respect prefers-reduced-motion
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setIsReducedMotion(mq.matches);
    const handler = (e) => setIsReducedMotion(e.matches);
    mq.addEventListener?.("change", handler);
    return () => mq.removeEventListener?.("change", handler);
  }, []);

  // -- Build the three groups: TOP GAINERS, TOP LOSERS, PORTFOLIO MOVERS --
  const groups = useMemo(() => {
    // Watchlist gainers: top 5 by changePercent descending
    const watchlistWithChange = (Array.isArray(watchlistAssets) ? watchlistAssets : [])
      .filter((a) => a && typeof a.symbol === "string" && Number.isFinite(Number(a.priceChangePercent)))
      .map((a) => ({
        symbol: String(a.symbol).toUpperCase(),
        name: a.name || String(a.symbol).toUpperCase(),
        changePercent: Number(a.priceChangePercent),
        type: a.type || "equity",
        source: "watchlist",
        price: a.price != null ? Number(a.price) : null,
      }));

    const gainers = [...watchlistWithChange]
      .sort((a, b) => b.changePercent - a.changePercent)
      .slice(0, 5)
      .filter((a) => a.changePercent > 0);

    const losers = [...watchlistWithChange]
      .sort((a, b) => a.changePercent - b.changePercent)
      .slice(0, 5)
      .filter((a) => a.changePercent < 0);

    // Portfolio movers: top 5 by |changePercent|
    // For holdings, changePercent = (price - entryPrice) / entryPrice * 100
    const portfolioWithChange = (Array.isArray(portfolioHoldings) ? portfolioHoldings : [])
      .filter((h) => h && typeof h.symbol === "string" && Number(h.quantity) > 0)
      .map((h) => {
        let change = h.priceChangePercent;
        if (!Number.isFinite(Number(change))) {
          const entry = Number(h.entryPrice);
          const price = Number(h.price);
          if (Number.isFinite(entry) && entry !== 0 && Number.isFinite(price)) {
            change = ((price - entry) / entry) * 100;
          }
        }
        return {
          symbol: String(h.symbol).toUpperCase(),
          name: h.name || String(h.symbol).toUpperCase(),
          changePercent: Number.isFinite(Number(change)) ? Number(change) : null,
          type: h.type || "equity",
          source: "portfolio",
          price: h.price != null ? Number(h.price) : null,
        };
      })
      .filter((h) => Number.isFinite(h.changePercent) && h.changePercent !== 0);

    const portfolioMovers = [...portfolioWithChange]
      .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
      .slice(0, 5);

    const result = [];
    if (gainers.length > 0) result.push({ label: "TOP GAINERS", items: gainers });
    if (losers.length > 0) result.push({ label: "TOP LOSERS", items: losers });
    if (portfolioMovers.length > 0) result.push({ label: "PORTFOLIO MOVERS", items: portfolioMovers });

    return result;
  }, [watchlistAssets, portfolioHoldings]);

  // Flatten all items for the scrolling tape
  const allItems = useMemo(() => {
    const items = [];
    for (const group of groups) {
      // Label chip
      items.push({ type: "label", label: group.label });
      // Item chips
      for (const item of group.items) {
        items.push({ type: "item", ...item });
      }
    }
    return items;
  }, [groups]);

  const handleItemClick = useCallback(
    (item) => {
      if (item.source === "watchlist" || item.source === "portfolio") {
        const kind = item.type === "crypto" ? "crypto" : item.type === "options" ? "options" : "stock";
        const route = buildAssetRoute("research", kind, item.symbol);
        if (route && onNavigate) {
          onNavigate({ symbol: route.symbol, kind });
        } else if (route && typeof window !== "undefined") {
          // Fallback: use default navigation via window.history
          window.history.pushState(
            { page: route.routeType, symbol: route.symbol },
            "",
            route.path
          );
        }
      }
    },
    [onNavigate]
  );

  // Render a single chip (inline to avoid unused-var lint issues with jsx-uses-react:off)
  const renderChip = (item, idx, copy) => {
    if (item.type === "label") {
      return (
        <span key={`${copy}-${idx}`} className="price-ticker__label" aria-hidden="true">
          {item.label}
        </span>
      );
    }

    const isPositive = item.changePercent > 0;
    const changeStr = Number.isFinite(item.changePercent)
      ? `${item.changePercent > 0 ? "+" : ""}${item.changePercent.toFixed(2)}%`
      : "";

    return (
      <button
        key={`${copy}-${idx}`}
        type="button"
        className={`price-ticker__item ${isPositive ? "positive" : "negative"}`}
        onClick={() => handleItemClick(item)}
        aria-label={`${item.symbol} ${changeStr}`}
        title={`${item.name} (${item.symbol}) ${changeStr}`}
      >
        <span className="price-ticker__symbol">{item.symbol}</span>
        <span className={`price-ticker__change ${isPositive ? "positive" : "negative"}`}>
          {changeStr}
        </span>
      </button>
    );
  };

  if (!visible || allItems.length === 0) return null;

  return (
    <div
      ref={containerRef}
      className="price-ticker"
      role="region"
      aria-label="Live price ticker"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div
        className="price-ticker__content"
        style={{
          animationPlayState: isReducedMotion ? "paused" : isHovered ? "paused" : "running",
        }}
      >
        {/* Duplicated content for seamless infinite loop.
            Two copies so that when the first scrolls off-screen,
            the second fills in. Animation moves by -50% of total width. */}
        <div className="price-ticker__track">
          {allItems.map((item, idx) => renderChip(item, idx, "a"))}
        </div>
        <div className="price-ticker__track" aria-hidden="true">
          {allItems.map((item, idx) => renderChip(item, idx, "b"))}
        </div>
      </div>
    </div>
  );
}