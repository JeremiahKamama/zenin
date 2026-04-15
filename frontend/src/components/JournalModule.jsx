import { useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";

export function JournalModule({ trades = [], portfolio = [] }) {
  const [reportPage, setReportPage] = useState(1);
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [isSymbolsDropdownOpen, setIsSymbolsDropdownOpen] = useState(false);
  const [symbolsButtonLabel, setSymbolsButtonLabel] = useState("All Symbols");
  const [calendarSearch, setCalendarSearch] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState([]);

  useEffect(() => {
    setReportPage(1);
  }, [trades]);

  const executionRows = useMemo(() => {
    const normalizeSymbol = (value) => String(value || "UNKNOWN").trim().toUpperCase();
    const ordered = [...trades].sort((a, b) => {
      const ta = new Date(a.executedAt || a.date || 0).getTime() || 0;
      const tb = new Date(b.executedAt || b.date || 0).getTime() || 0;
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });

    const runningPosition = new Map();
    const rows = ordered.map((trade) => {
      const symbol = normalizeSymbol(trade.asset);
      const quantity = Math.max(0, Number(trade.quantity) || 0);
      const price = Number(trade.price) || 0;
      const side = String(trade.side || trade.type || "").toLowerCase() === "sell" ? "sell" : "buy";
      const direction = side === "sell" ? -1 : 1;
      const notionalRaw = Number(trade.notional);
      const notional = Number.isFinite(notionalRaw) ? Math.abs(notionalRaw) : Math.abs(price * quantity);
      const nextPosition = (runningPosition.get(symbol) || 0) + direction * quantity;
      runningPosition.set(symbol, nextPosition);

      const executionTs = trade.executedAt || (trade.date ? `${trade.date}T00:00:00.000Z` : "");
      const executionDate = executionTs
        ? new Date(executionTs).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
        : (trade.date || "—");
      const positionAfterRaw = Number(trade.positionAfter);

      return {
        ...trade,
        asset: symbol,
        type: side === "sell" ? "SELL" : "BUY",
        quantity,
        price,
        notional,
        executionDate,
        positionAfter: Number.isFinite(positionAfterRaw) ? positionAfterRaw : nextPosition
      };
    });

    return rows.reverse();
  }, [trades]);

  const analytics = useMemo(() => {
    const dayMs = 24 * 60 * 60 * 1000;
    const eps = 1e-8;
    const normalizeSymbol = (value) => String(value || "UNKNOWN").trim().toUpperCase();
    const safeNum = (val) => {
      const n = Number(val);
      return Number.isFinite(n) ? n : 0;
    };
    const parseTradeDate = (dateStr) => {
      const d = new Date(dateStr);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const sortedTrades = [...trades].sort((a, b) => {
      const ta = parseTradeDate(a.executedAt || a.date)?.getTime() ?? 0;
      const tb = parseTradeDate(b.executedAt || b.date)?.getTime() ?? 0;
      if (ta !== tb) return ta - tb;
      return (a.id || 0) - (b.id || 0);
    });

    const lotsByAsset = new Map();
    const realized = [];
    let totalVolume = 0;

    for (const trade of sortedTrades) {
      const type = (trade.type || "").toUpperCase();
      const asset = normalizeSymbol(trade.asset);
      const qty = Math.max(0, safeNum(trade.quantity));
      const price = safeNum(trade.price);
      const dateObj = parseTradeDate(trade.executedAt || trade.date);
      if (qty <= 0) continue;

      totalVolume += Math.abs(price * qty);

      if (type === "BUY") {
        const lots = lotsByAsset.get(asset) || [];
        lots.push({ qty, price, date: dateObj });
        lotsByAsset.set(asset, lots);
        continue;
      }

      if (type === "SELL") {
        const lots = lotsByAsset.get(asset) || [];
        let remaining = qty;
        while (remaining > 0 && lots.length > 0) {
          const lot = lots[0];
          const matchedQty = Math.min(remaining, lot.qty);
          const pnl = (price - lot.price) * matchedQty;
          const holdDays = lot.date && dateObj
            ? Math.max(0, Math.round((dateObj.getTime() - lot.date.getTime()) / dayMs))
            : 0;

          const normalizedCloseDate = /^\d{4}-\d{2}-\d{2}$/.test(trade.date || "")
            ? trade.date
            : (dateObj ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}` : "");

          realized.push({
            asset,
            pnl,
            holdDays,
            volume: price * matchedQty,
            closeDate: normalizedCloseDate
          });

          lot.qty -= matchedQty;
          remaining -= matchedQty;
          if (lot.qty <= 0) lots.shift();
        }
        lotsByAsset.set(asset, lots);
      }
    }

    const wins = realized.filter((r) => r.pnl > eps);
    const losses = realized.filter((r) => r.pnl < -eps);
    const breakevens = realized.filter((r) => Math.abs(r.pnl) <= eps);
    const decisiveTrades = wins.length + losses.length;
    const totalGainLoss = realized.reduce((acc, r) => acc + r.pnl, 0);
    const avgHoldDays = realized.length
      ? realized.reduce((acc, r) => acc + r.holdDays, 0) / realized.length
      : 0;

    const tradeDates = [...new Set(
      sortedTrades
        .map((t) => {
          const d = parseTradeDate(t.executedAt || t.date);
          if (!d) return "";
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        })
        .filter(Boolean)
    )];
    const activeDays = Math.max(1, tradeDates.length);

    let maxConsecutiveWin = 0;
    let maxConsecutiveLoss = 0;
    let currentWin = 0;
    let currentLoss = 0;
    for (const r of realized) {
      if (r.pnl > eps) {
        currentWin += 1;
        currentLoss = 0;
      } else if (r.pnl < -eps) {
        currentLoss += 1;
        currentWin = 0;
      } else {
        currentWin = 0;
        currentLoss = 0;
      }
      maxConsecutiveWin = Math.max(maxConsecutiveWin, currentWin);
      maxConsecutiveLoss = Math.max(maxConsecutiveLoss, currentLoss);
    }

    const avgTradeWin = wins.length
      ? wins.reduce((acc, r) => acc + r.pnl, 0) / wins.length
      : 0;
    const avgTradeLoss = losses.length
      ? losses.reduce((acc, r) => acc + r.pnl, 0) / losses.length
      : 0;

    const largestGain = wins.length
      ? Math.max(...wins.map((r) => r.pnl))
      : 0;
    const largestLoss = losses.length
      ? Math.min(...losses.map((r) => r.pnl))
      : 0;

    const symbolStats = new Map();
    const bumpSymbolExecution = (trade) => {
      const key = normalizeSymbol(trade.asset);
      const type = (trade.type || "").toUpperCase();
      const qty = Math.max(0, safeNum(trade.quantity));
      const price = safeNum(trade.price);
      const row = symbolStats.get(key) || {
        symbol: key,
        executionCount: 0,
        realizedCount: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        totalHoldDays: 0,
        totalGain: 0,
        tradedNotional: 0,
        buyQty: 0,
        sellQty: 0,
        netQtyFromTrades: 0
      };
      row.executionCount += 1;
      row.tradedNotional += Math.abs(price * qty);
      if (type === "SELL") {
        row.sellQty += qty;
        row.netQtyFromTrades -= qty;
      } else {
        row.buyQty += qty;
        row.netQtyFromTrades += qty;
      }
      symbolStats.set(key, row);
    };

    for (const trade of sortedTrades) {
      bumpSymbolExecution(trade);
    }

    for (const r of realized) {
      const key = r.asset || "UNKNOWN";
      const row = symbolStats.get(key) || {
        symbol: key,
        executionCount: 0,
        realizedCount: 0,
        wins: 0,
        losses: 0,
        breakevens: 0,
        totalHoldDays: 0,
        totalGain: 0,
        tradedNotional: 0,
        buyQty: 0,
        sellQty: 0,
        netQtyFromTrades: 0
      };
      row.realizedCount += 1;
      row.totalHoldDays += r.holdDays;
      row.totalGain += r.pnl;
      if (r.pnl > eps) row.wins += 1;
      else if (r.pnl < -eps) row.losses += 1;
      else row.breakevens += 1;
      symbolStats.set(key, row);
    }

    const portfolioPositionMap = new Map();
    for (const holding of portfolio || []) {
      const symbol = normalizeSymbol(holding.symbol);
      portfolioPositionMap.set(symbol, (portfolioPositionMap.get(symbol) || 0) + safeNum(holding.quantity));
    }

    const tradedAssetsReport = [...symbolStats.values()]
      .map((row) => {
        const decisive = row.wins + row.losses;
        const winRate = decisive ? (row.wins / decisive) * 100 : 0;
        const avgDuration = row.realizedCount ? row.totalHoldDays / row.realizedCount : 0;
        const avgGain = row.realizedCount ? row.totalGain / row.realizedCount : 0;
        return {
          symbol: row.symbol,
          tradeCount: row.executionCount,
          tradedNotional: row.tradedNotional,
          netPosition: portfolioPositionMap.has(row.symbol)
            ? portfolioPositionMap.get(row.symbol)
            : row.netQtyFromTrades,
          winRate,
          tradeDuration: avgDuration,
          avgGain,
          totalGain: row.totalGain
        };
      })
      .sort((a, b) => {
        if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
        if (b.tradedNotional !== a.tradedNotional) return b.tradedNotional - a.tradedNotional;
        if (b.totalGain !== a.totalGain) return b.totalGain - a.totalGain;
        return a.symbol.localeCompare(b.symbol);
      });

    return {
      totalTrades: sortedTrades.length,
      avgHoldDays,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: decisiveTrades ? (wins.length / decisiveTrades) * 100 : 0,
      totalGainLoss,
      tradeExpectancy: realized.length ? totalGainLoss / realized.length : 0,
      avgDailyGain: totalGainLoss / activeDays,
      avgDailyVolume: totalVolume / activeDays,
      largestGain,
      totalVolume,
      avgTradesPerDay: sortedTrades.length / activeDays,
      avgTradeWin,
      avgTradeLoss,
      maxConsecutiveWin,
      maxConsecutiveLoss,
      largestLoss: Math.abs(largestLoss) <= eps ? 0 : largestLoss,
      tradedAssetsReport,
      realizedTrades: realized
    };
  }, [trades, portfolio]);

  const winLossSeries = [
    Math.max(analytics.wins, 0),
    Math.max(analytics.losses, 0)
  ];
  const winLossOptions = {
    chart: { type: "donut", background: "transparent" },
    labels: ["Wins", "Losses"],
    legend: { show: false },
    stroke: { show: false },
    dataLabels: { enabled: false },
    colors: ["#22c55e", "#ef4444"],
    plotOptions: { pie: { donut: { size: "70%" } } }
  };

  const statsRows = [
    { label: "Total Gain/Loss", value: analytics.totalGainLoss, currency: true },
    { label: "Trade Expectancy", value: analytics.tradeExpectancy, currency: true },
    { label: "Avg Daily Gain", value: analytics.avgDailyGain, currency: true },
    { label: "Avg Daily Volume", value: analytics.avgDailyVolume, currency: true },
    { label: "Largest Gain", value: analytics.largestGain, currency: true },
    { label: "Total Trades Volume", value: analytics.totalVolume, currency: true },
    { label: "Avg # of Trades/day", value: analytics.avgTradesPerDay },
    { label: "Avg Trade Win", value: analytics.avgTradeWin, currency: true },
    { label: "Avg Trade Loss", value: analytics.avgTradeLoss, currency: true },
    { label: "Max Consecutive Win", value: analytics.maxConsecutiveWin },
    { label: "Max Consecutive Loss", value: analytics.maxConsecutiveLoss },
    { label: "Largest Losses", value: analytics.largestLoss, currency: true }
  ];

  const formatValue = (val, currency = false) => {
    const safeVal = Number.isFinite(Number(val)) ? Number(val) : 0;
    if (currency) {
      return `$${safeVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    return safeVal.toLocaleString(undefined, { maximumFractionDigits: 2 });
  };

  const reportRowsPerPage = 10;
  const reportTotalPages = Math.max(1, Math.ceil(analytics.tradedAssetsReport.length / reportRowsPerPage));
  const safeReportPage = Math.min(reportPage, reportTotalPages);
  const pagedReportRows = analytics.tradedAssetsReport.slice(
    (safeReportPage - 1) * reportRowsPerPage,
    safeReportPage * reportRowsPerPage
  );

  const frequentTradedSymbols = analytics.tradedAssetsReport
    .filter((row) => row.tradeCount > 0)
    .map((row) => row.symbol);
  const filteredSymbolSearch = frequentTradedSymbols.filter((symbol) =>
    symbol.toLowerCase().includes(calendarSearch.trim().toLowerCase())
  );

  const toggleCalendarSymbol = (symbol) => {
    const s = (symbol || "").trim().toUpperCase();
    if (!s || !frequentTradedSymbols.includes(s)) return;
    setSelectedSymbols((prev) =>
      prev.includes(s) ? prev.filter((item) => item !== s) : [...prev, s]
    );
    setSymbolsButtonLabel("Ready Selected Symbols");
    setTimeout(() => {
      setSymbolsButtonLabel("All Symbols");
    }, 1500);
  };

  const calendarPnlByDate = useMemo(() => {
    const activeSet = new Set(selectedSymbols);
    const byDate = new Map();
    for (const trade of analytics.realizedTrades) {
      if (!trade.closeDate) continue;
      if (activeSet.size > 0 && !activeSet.has((trade.asset || "").toUpperCase())) {
        continue;
      }
      byDate.set(trade.closeDate, (byDate.get(trade.closeDate) || 0) + (Number(trade.pnl) || 0));
    }
    return byDate;
  }, [analytics.realizedTrades, selectedSymbols]);

  const calendarMonthLabel = calendarCursor.toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
  const calendarYear = calendarCursor.getFullYear();
  const calendarMonth = calendarCursor.getMonth();
  const firstDayOffset = new Date(calendarYear, calendarMonth, 1).getDay();
  const monthDays = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const calendarCells = Array.from({ length: firstDayOffset + monthDays }, (_, idx) => {
    const dayNum = idx - firstDayOffset + 1;
    if (dayNum < 1) return { type: "blank", key: `b-${idx}` };
    const key = `${calendarYear}-${String(calendarMonth + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
    const pnl = calendarPnlByDate.get(key);
    return { type: "day", key, dayNum, pnl: Number.isFinite(pnl) ? pnl : null };
  });

  const moveCalendarMonth = (delta) => {
    setCalendarCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1));
  };

  const moveCalendarYear = (delta) => {
    setCalendarCursor((prev) => new Date(prev.getFullYear() + delta, prev.getMonth(), 1));
  };

  return (
    <div className="view-container journal-dashboard">
      <div className="portfolio-analytics-row journal-top-cards">
        <div className="metric-card glass">
          <label>Total Trades Taken</label>
          <div className="value">{analytics.totalTrades}</div>
        </div>
        <div className="metric-card glass">
          <label>Average Hold</label>
          <div className="value">{analytics.avgHoldDays.toFixed(1)}d</div>
        </div>
        <div className="metric-card glass journal-winrate-card">
          <label>Win Rate</label>
          <div className="value">{analytics.winRate.toFixed(1)}%</div>
          <div className="journal-winrate-body">
            <div className="journal-winrate-chart">
              <Chart
                options={winLossOptions}
                series={winLossSeries.some((v) => v > 0) ? winLossSeries : [1, 1]}
                type="donut"
                height={120}
              />
            </div>
            <div className="journal-winrate-breakdown">
              <div><span className="dot win" /> Wins: {analytics.wins}</div>
              <div><span className="dot breakeven" /> Breakevens: {analytics.breakevens}</div>
              <div><span className="dot loss" /> Losses: {analytics.losses}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Analytics</h2>
        </div>
        <div className="journal-stats-grid">
          {statsRows.map((stat) => (
            <div key={stat.label} className="journal-stat-card">
              <span className="journal-stat-label">{stat.label}</span>
              <span className="journal-stat-value">{formatValue(stat.value, stat.currency)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="journal-grid">
        <div className="watchlist-panel glass">
          <div className="section-header">
            <h2>Recent Executions</h2>
            <div className="asset-count">{executionRows.length} Records</div>
          </div>
          <div className="trade-list">
            {executionRows.length > 0 ? (
              executionRows.map((trade) => (
                <div key={trade.clientId || trade.id} className="trade-item">
                  <div className="trade-date greek">{trade.executionDate}</div>
                  <div className="trade-asset" style={{fontWeight: 700}}>{trade.asset}</div>
                  <div className={`trade-side ${trade.type === "BUY" ? "positive" : "negative"}`}>{trade.type}</div>
                  <div className="trade-price price">${(Number(trade.price) || 0).toFixed(2)}</div>
                  <div className="trade-details">
                    <div className="qty">× {Number(trade.quantity || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                    <div className="trade-meta">Cost {formatValue(Number(trade.notional) || 0, true)} · Pos {Number(trade.positionAfter || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty-state" style={{padding: '40px', color: '#64748b'}}>
                No trades recorded yet. Confirm an order to see it in your journal.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Calendar PnL</h2>
        </div>
        <div className="calendar-controls">
          <div className="calendar-nav">
            <button className="pagination-button" onClick={() => moveCalendarYear(-1)}>« Year</button>
            <button className="pagination-button" onClick={() => moveCalendarMonth(-1)}>‹ Month</button>
            <div className="pagination-label">{calendarMonthLabel}</div>
            <button className="pagination-button" onClick={() => moveCalendarMonth(1)}>Month ›</button>
            <button className="pagination-button" onClick={() => moveCalendarYear(1)}>Year »</button>
          </div>
          <div className="calendar-symbols-row">
            <button
              className={`pagination-button ${selectedSymbols.length > 0 ? "active" : ""}`}
              onClick={() => setIsSymbolsDropdownOpen((prev) => !prev)}
            >
              {symbolsButtonLabel}
            </button>
          </div>
          {isSymbolsDropdownOpen && (
            <div className="calendar-symbol-dropdown">
              <div className="calendar-symbol-search">
                <input
                  className="search-input"
                  placeholder="Search traded assets..."
                  value={calendarSearch}
                  onChange={(e) => setCalendarSearch(e.target.value)}
                />
              </div>
              <div className="calendar-symbol-checklist">
                {filteredSymbolSearch.length > 0 ? (
                  filteredSymbolSearch.slice(0, 30).map((symbol) => (
                    <label key={symbol} className="calendar-check-item">
                      <input
                        type="checkbox"
                        checked={selectedSymbols.includes(symbol)}
                        onChange={() => toggleCalendarSymbol(symbol)}
                      />
                      <span>{symbol}</span>
                    </label>
                  ))
                ) : (
                  <span className="meta">No traded symbols found.</span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="calendar-grid-header">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div className="calendar-grid">
          {calendarCells.map((cell) => {
            if (cell.type === "blank") {
              return <div key={cell.key} className="calendar-cell blank" />;
            }
            return (
              <div key={cell.key} className={`calendar-cell ${cell.pnl > 0 ? "positive" : cell.pnl < 0 ? "negative" : ""}`}>
                <div className="calendar-day">{cell.dayNum}</div>
                {cell.pnl != null && (
                  <div className="calendar-pnl">
                    {cell.pnl >= 0 ? "+" : ""}
                    {formatValue(cell.pnl, true)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="watchlist-panel glass">
        <div className="section-header">
          <h2>Traded Assets Report</h2>
          <div className="asset-count">{analytics.tradedAssetsReport.length} Assets</div>
        </div>
        {analytics.tradedAssetsReport.length === 0 ? (
          <div className="empty-state" style={{ padding: "24px", color: "#64748b" }}>
            No traded assets yet.
          </div>
        ) : (
          <>
            <div className="journal-report-table-wrap">
              <table className="journal-report-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Trade Count</th>
                    <th>Traded Notional</th>
                    <th>Current Position</th>
                    <th>Win Rate</th>
                    <th>Trade Duration</th>
                    <th>Avg Gain</th>
                    <th>Total Gain</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedReportRows.map((row) => (
                    <tr key={row.symbol}>
                      <td>{row.symbol}</td>
                      <td>{row.tradeCount}</td>
                      <td>{formatValue(row.tradedNotional, true)}</td>
                      <td>{Number(row.netPosition || 0).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td>{row.winRate.toFixed(1)}%</td>
                      <td>{row.tradeDuration.toFixed(1)}d</td>
                      <td className={row.avgGain >= 0 ? "positive" : "negative"}>{formatValue(row.avgGain, true)}</td>
                      <td className={row.totalGain >= 0 ? "positive" : "negative"}>{formatValue(row.totalGain, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="pagination-controls">
              <button
                className="pagination-button"
                disabled={safeReportPage === 1}
                onClick={() => setReportPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div className="pagination-label">Page {safeReportPage} of {reportTotalPages}</div>
              <button
                className="pagination-button"
                disabled={safeReportPage === reportTotalPages}
                onClick={() => setReportPage((p) => Math.min(reportTotalPages, p + 1))}
              >
                Next
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
