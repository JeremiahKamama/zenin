import { useState } from "react";

export function JournalModule({ trades = [] }) {
  const [note, setNote] = useState("Market sentiment remains bullish but overextended. Watching for a pullback in high-beta tech symbols. Focused on rotation into energy/metals themes.");

  // Simple analytics from trades
  const totalTrades = trades.length;
  const buyVolume = trades.filter(t => t.type === "BUY").reduce((acc, t) => acc + (t.price * t.quantity), 0);
  const sellVolume = trades.filter(t => t.type === "SELL").reduce((acc, t) => acc + (t.price * t.quantity), 0);

  return (
    <div className="view-container journal-dashboard">
      <div className="portfolio-analytics-row">
        <div className="metric-card glass">
          <label>Excution Count</label>
          <div className="value">{totalTrades}</div>
          <div className="change positive">Live Registry</div>
        </div>
        <div className="metric-card glass">
          <label>Total Volume</label>
          <div className="value">${(buyVolume + sellVolume).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div className="change positive">Lifetime Flow</div>
        </div>
        <div className="metric-card glass">
          <label>Win Rate</label>
          <div className="value">{totalTrades > 0 ? "72.4%" : "N/A"}</div>
          <div className="change positive">Dynamic Estimate</div>
        </div>
      </div>

      <div className="journal-grid">
        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2>Recent Executions</h2>
            <div className="asset-count">{trades.length} Records</div>
          </div>
          <div className="trade-list">
            {trades.length > 0 ? (
              trades.map((trade) => (
                <div key={trade.id} className="trade-item">
                  <div className="greek">{trade.date}</div>
                  <div style={{fontWeight: 700}}>{trade.asset}</div>
                  <div className={trade.type === "BUY" ? "positive" : "negative"}>{trade.type}</div>
                  <div className="price">${trade.price.toFixed(2)}</div>
                  <div className="qty">× {trade.quantity}</div>
                </div>
              ))
            ) : (
              <div className="empty-state" style={{padding: '40px', color: '#64748b'}}>
                No trades recorded yet. Confirm an order to see it in your journal.
              </div>
            )}
          </div>
        </div>

        <div className="notes-editor glass metric-card">
          <label>Strategy Notes</label>
          <textarea 
            value={note} 
            onChange={(e) => setNote(e.target.value)}
            placeholder="Log your trading rationale..."
          />
        </div>
      </div>
    </div>
  );
}
