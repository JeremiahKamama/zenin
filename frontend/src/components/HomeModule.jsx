export function HomeModule({
  portfolio,
  assets,
  onSelectAsset,
  calculatePortfolioValue,
  calculatePortfolioGain,
  balance = 0,
  onDeposit,
  onWithdraw
}) {
  const topPositions = [...portfolio]
    .sort((a, b) => ((b.price || 0) * (b.quantity || 0)) - ((a.price || 0) * (a.quantity || 0)))
    .slice(0, 5);

  const watchlistSpotlight = assets.slice(0, 5);

  return (
    <div className="view-container home-dashboard">
      <div className="portfolio-analytics-row">
        <div className="metric-card glass">
          <label>Total Account Equity</label>
          <div className="value">${calculatePortfolioValue().toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div className={`change ${calculatePortfolioGain() >= 0 ? "positive" : "negative"}`}>
            {calculatePortfolioGain() >= 0 ? "▲" : "▼"} ${Math.abs(calculatePortfolioGain()).toFixed(2)} Today
          </div>
        </div>
        <div className="metric-card glass">
          <label>Diversification Health</label>
          <div className="value">{portfolio.length > 5 ? "Strong" : "Diversifying"}</div>
          <div className="change positive">{portfolio.length} Distinct Assets</div>
        </div>
        <div className="metric-card glass">
          <label>Market Sentiment</label>
          <div className="value">Risk On</div>
          <div className="change positive">High Volatility Alpha</div>
        </div>
        <div className="metric-card glass">
          <label>Available Balance</label>
          <div className="value">${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
            <button
              className="confirm-order-btn buy"
              style={{ flex: 1, padding: "6px", fontSize: "12px" }}
              onClick={() => {
                const amt = parseFloat(prompt("Deposit amount:"));
                if (amt > 0) onDeposit(amt);
              }}
            >+ Deposit</button>
            <button
              className="confirm-order-btn sell"
              style={{ flex: 1, padding: "6px", fontSize: "12px" }}
              onClick={() => {
                const amt = parseFloat(prompt("Withdraw amount:"));
                if (amt > 0) onWithdraw(amt);
              }}
            >− Withdraw</button>
          </div>
        </div>
      </div>

      <div className="home-grid">
        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2>Top 5 Positions</h2>
            <div className="asset-count">Sorted by Value</div>
          </div>
          <div className="home-asset-list">
            {topPositions.length > 0 ? (
              topPositions.map((asset) => {
                const value = (asset.price || 0) * (asset.quantity || 0);
                return (
                  <div key={asset.id} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                    <div className="symbol-info">
                      <span className="symbol">{asset.symbol}</span>
                      <span className="name">{asset.name}</span>
                    </div>
                    <div className="value-info">
                      <div className="price">${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="qty">{asset.quantity} Units</div>
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="meta" style={{padding: '20px'}}>No positions yet. Add assets to start tracking.</p>
            )}
          </div>
        </div>

        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2>Watchlist Spotlight</h2>
          </div>
          <div className="home-asset-list">
            {watchlistSpotlight.map((asset) => (
              <div key={asset.symbol} className="home-asset-item clickable" onClick={() => onSelectAsset(asset)}>
                <div className="symbol-info">
                  <span className="symbol">{asset.symbol}</span>
                  <span className="name">{asset.type?.toUpperCase()}</span>
                </div>
                <div className="value-info">
                  <div className="price">${(asset.price || 0).toFixed(2)}</div>
                  <div className={`change ${asset.priceChangePercent >= 0 ? "positive" : "negative"}`}>
                    {asset.priceChangePercent >= 0 ? "+" : ""}{asset.priceChangePercent?.toFixed(2)}%
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
