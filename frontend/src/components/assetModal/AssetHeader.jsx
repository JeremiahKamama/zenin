import { Button } from "../ui/button";
import { AssetLogo } from "../AssetLogo";

export function AssetHeader({
  asset,
  displayedPrice,
  displayedChangePercent,
  displayedChangeValue,
  activeCurrency,
  isMarketOpen,
  marketStatus,
  liveQuote,
  isInWatchlist,
  onToggleStar,
  onViewCompanyProfile,
  onClose,
  showProfileAction = true
}) {
  const isWatching = Boolean(isInWatchlist?.(asset, undefined, { strictStockMeta: true }));
  const changePositive = displayedChangePercent >= 0;
  const exchange = asset?.exchange || asset?.marketType || asset?.type || "—";
  // MyStocks rows carry a provider flag from the backend; surface honest
  // provenance (source + exchange + local currency) for African listings.
  const isMyStocks = asset?.provider === "mystocks";
  const provenance = isMyStocks
    ? ["MyStocks", asset?.exchange, asset?.currency].filter(Boolean).join(" · ")
    : null;

  return (
    <header className="am-header">
      <div className="am-header-main">
        <div className="am-header-id">
          <AssetLogo asset={asset} size="lg" />
          <h2 className="am-name font-mono">{asset?.symbol}</h2>
          <div className="am-sub">
            <span className="am-company">{asset?.name}</span>
            <span className="am-exchange">{exchange}</span>
            {provenance ? (
              <span className="am-provenance" title="Source provenance for this African listing">
                {provenance}
              </span>
            ) : null}
          </div>
        </div>

        <div className="am-price-block">
          <span className="am-price font-mono">
            {displayedPrice > 0
              ? displayedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
              : <span className="am-na">—</span>}
          </span>
          <span className={`am-change font-mono ${changePositive ? "am-pos" : "am-neg"}`}>
            {changePositive ? "+" : ""}{Math.abs(displayedChangeValue).toFixed(2)}
            <span className="am-change-pct">({changePositive ? "+" : ""}{displayedChangePercent.toFixed(2)}%)</span>
          </span>
        </div>

        <div className="am-status">
          <span className={`am-market-badge ${isMarketOpen ? "am-open" : "am-closed"}`}>
            {isMarketOpen ? "Market Open" : "Market Closed"}
          </span>
          <span className="am-live font-mono">
            {isMarketOpen ? (liveQuote?.source || asset?.priceSource || "LIVE") : <span className="am-na">—</span>}
          </span>
        </div>
      </div>

      <div className="am-header-actions">
        <Button
          variant="ghost"
          size="icon"
          className={`am-star ${isWatching ? "am-star-active" : ""}`}
          onClick={() => onToggleStar?.(asset)}
          title={isWatching ? "Remove from watchlist" : "Add to watchlist"}
          aria-pressed={isWatching}
        >
          ★
        </Button>
        {showProfileAction ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onViewCompanyProfile?.(asset)}
            title="Open company profile"
          >
            Profile
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          className="am-close"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
        >
          ×
        </Button>
      </div>
    </header>
  );
}
