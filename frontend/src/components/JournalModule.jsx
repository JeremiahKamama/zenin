import { useEffect, useMemo, useState } from "react";
import Chart from "react-apexcharts";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const TRADE_REPORT_REFRESH_MS = 2 * 60 * 60 * 1000; // 2 hours

export function JournalModule({ trades = [], portfolio = [], balance = 0, accountEquity = null }) {
  const [reportPage, setReportPage] = useState(1);
  const [calendarCursor, setCalendarCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [isSymbolsDropdownOpen, setIsSymbolsDropdownOpen] = useState(false);
  const [symbolsButtonLabel, setSymbolsButtonLabel] = useState("All Symbols");
  const [calendarSearch, setCalendarSearch] = useState("");
  const [selectedSymbols, setSelectedSymbols] = useState([]);
  const [livePriceBySymbol, setLivePriceBySymbol] = useState({});
  const [lastReportPriceRefreshAt, setLastReportPriceRefreshAt] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());

  useEffect(() => {
    const intervalId = setInterval(() => setNowTs(Date.now()), 60 * 1000);
    return () => clearInterval(intervalId);
  }, []);

  const reportSymbols = useMemo(() => {
    const symbols = new Set();
    (Array.isArray(trades) ? trades : []).forEach((trade) => {
      const symbol = String(trade?.asset || "").trim().toUpperCase();
      if (symbol) symbols.add(symbol);
    });
    (Array.isArray(portfolio) ? portfolio : []).forEach((holding) => {
      const symbol = String(holding?.symbol || "").trim().toUpperCase();
      if (symbol) symbols.add(symbol);
    });
    return [...symbols];
  }, [trades, portfolio]);

  useEffect(() => {
    setReportPage(1);
  }, [trades]);

  const handleCloseOption = (tradeId) => {
  const tradeToClose = activeOptionsTrades.find(t => t.id === tradeId);
  const closingMark = getLiveOptionMarkFromDerive(tradeToClose);
  
  const closedRecord = {
    id: `opt_close_${Date.now()}`,
    asset: tradeToClose.asset,
    type: tradeToClose.legs.direction === "short" ? "BUY" : "SELL", // Closing transaction
    quantity: tradeToClose.qty,
    price: closingMark,
    executedAt: new Date().toISOString(),
    notional: closingMark * tradeToClose.qty,
    marketType: "Options"
  };

  setTrades(prev => [...prev, closedRecord]);
  setActiveOptionsTrades(prev => prev.filter(t => t.id !== tradeId));
};

  useEffect(() => {
    if (reportSymbols.length === 0) {
      setLivePriceBySymbol({});
      setLastReportPriceRefreshAt(null);
      return;
    }

    let isCancelled = false;

    const enrichWithCategoryPrices = async (symbols, category, target) => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/watchlist?category=${encodeURIComponent(category)}&symbols=${encodeURIComponent(symbols.join(","))}`
        );
        if (!res.ok) return;
        const data = await res.json();
        const assets = Array.isArray(data?.assets) ? data.assets : [];
        assets.forEach((asset) => {
          const symbol = String(asset?.symbol || "").trim().toUpperCase();
          const price = Number(asset?.price);
          if (!symbol || !Number.isFinite(price)) return;
          target[symbol] = price;
        });
      } catch {
        // keep best-effort behavior
      }
    };

    const enrichWithSearchPrice = async (symbol, type, target) => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/search?q=${encodeURIComponent(symbol)}&type=${encodeURIComponent(type)}`
        );
        if (!res.ok) return false;
        const data = await res.json();
        const results = Array.isArray(data?.results) ? data.results : [];
        const exact = results.find((item) => String(item?.symbol || "").trim().toUpperCase() === symbol) || results[0];
        const price = Number(exact?.price);
        if (!Number.isFinite(price)) return false;
        target[symbol] = price;
        return true;
      } catch {
        return false;
      }
    };

    const refreshReportPrices = async () => {
      const next = {};
      const symbols = [...reportSymbols];

      await enrichWithCategoryPrices(symbols, "stocks", next);
      await enrichWithCategoryPrices(symbols, "bonds", next);
      await enrichWithCategoryPrices(symbols, "commodities", next);
      await enrichWithCategoryPrices(symbols, "metals", next);
      await enrichWithCategoryPrices(symbols, "crypto", next);

      const unresolved = symbols.filter((symbol) => !Number.isFinite(next[symbol]));
      for (const symbol of unresolved) {
        const foundTradfi = await enrichWithSearchPrice(symbol, "tradfi", next);
        if (foundTradfi) continue;
        await enrichWithSearchPrice(symbol, "crypto", next);
      }

      if (isCancelled) return;
      setLivePriceBySymbol((prev) => ({ ...prev, ...next }));
      setLastReportPriceRefreshAt(Date.now());
    };

    refreshReportPrices();
    const intervalId = setInterval(refreshReportPrices, TRADE_REPORT_REFRESH_MS);
    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [reportSymbols]);

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
    let totalHoldDurationQty = 0;
    let totalHoldDurationQtyDays = 0;
    let totalVolume = 0;

    for (const trade of sortedTrades) {
      const type = (trade.type || "").toUpperCase();
      const asset = normalizeSymbol(trade.asset);
      const qty = Math.max(0, safeNum(trade.quantity));
      const price = safeNum(trade.price);
      const dateObj = parseTradeDate(trade.executedAt || trade.date);
      if (qty <= 0) continue;

      const tradeNotionalRaw = safeNum(trade.notional);
      const tradeNotional = Math.abs(tradeNotionalRaw > 0 ? tradeNotionalRaw : price * qty);
      totalVolume += tradeNotional;

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
            ? Math.max(0, (dateObj.getTime() - lot.date.getTime()) / dayMs)
            : 0;

          const normalizedCloseDate = /^\d{4}-\d{2}-\d{2}$/.test(trade.date || "")
            ? trade.date
            : (dateObj ? `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, "0")}-${String(dateObj.getDate()).padStart(2, "0")}` : "");

          realized.push({
            asset,
            pnl,
            holdDays,
            qty: matchedQty,
            volume: price * matchedQty,
            closeDate: normalizedCloseDate
          });
          totalHoldDurationQty += matchedQty;
          totalHoldDurationQtyDays += holdDays * matchedQty;

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
    const totalRealizedTrades = decisiveTrades + breakevens.length;
    const realizedGainLoss = realized.reduce((acc, r) => acc + r.pnl, 0);
    for (const lots of lotsByAsset.values()) {
      for (const lot of lots) {
        const lotQty = Math.max(0, safeNum(lot.qty));
        if (lotQty <= eps) continue;
        const holdDays = lot.date ? Math.max(0, (nowTs - lot.date.getTime()) / dayMs) : 0;
        totalHoldDurationQty += lotQty;
        totalHoldDurationQtyDays += holdDays * lotQty;
      }
    }
    const avgHoldDays = totalHoldDurationQty > eps
      ? totalHoldDurationQtyDays / totalHoldDurationQty
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
        netQtyFromTrades: 0,
        holdDurationQty: 0,
        holdDurationQtyDays: 0
      };
      row.executionCount += 1;
      const notional = Math.abs(safeNum(trade.notional) || (price * qty));
      row.tradedNotional += notional;
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
        netQtyFromTrades: 0,
        holdDurationQty: 0,
        holdDurationQtyDays: 0
      };
      row.realizedCount += 1;
      row.totalHoldDays += r.holdDays;
      row.holdDurationQty += Math.max(0, safeNum(r.qty));
      row.holdDurationQtyDays += r.holdDays * Math.max(0, safeNum(r.qty));
      row.totalGain += r.pnl;
      if (r.pnl > eps) row.wins += 1;
      else if (r.pnl < -eps) row.losses += 1;
      else row.breakevens += 1;
      symbolStats.set(key, row);
    }

    for (const [symbol, lots] of lotsByAsset.entries()) {
      const row = symbolStats.get(symbol) || {
        symbol,
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
        netQtyFromTrades: 0,
        holdDurationQty: 0,
        holdDurationQtyDays: 0
      };
      for (const lot of lots) {
        const lotQty = Math.max(0, safeNum(lot.qty));
        if (lotQty <= eps) continue;
        const holdDays = lot.date ? Math.max(0, (nowTs - lot.date.getTime()) / dayMs) : 0;
        row.holdDurationQty += lotQty;
        row.holdDurationQtyDays += holdDays * lotQty;
      }
      symbolStats.set(symbol, row);
    }

    const portfolioPositionMap = new Map();
    for (const holding of portfolio || []) {
      const symbol = normalizeSymbol(holding.symbol);
      portfolioPositionMap.set(symbol, (portfolioPositionMap.get(symbol) || 0) + safeNum(holding.quantity));
    }

    const lastBuyPriceBySymbol = new Map();
    for (const trade of sortedTrades) {
      const type = (trade.type || "").toUpperCase();
      if (type !== "BUY") continue;
      const symbol = normalizeSymbol(trade.asset);
      const price = safeNum(trade.price);
      if (price > 0) {
        lastBuyPriceBySymbol.set(symbol, price);
      }
    }

    const portfolioPriceMap = new Map();
    for (const holding of portfolio || []) {
      const symbol = normalizeSymbol(holding.symbol);
      const price = safeNum(holding.price);
      if (price > 0) {
        portfolioPriceMap.set(symbol, price);
      }
    }

    const tradedAssetsReport = [...symbolStats.values()]
      .map((row) => {
        const decisive = row.wins + row.losses;
        const winRate = decisive ? (row.wins / decisive) * 100 : 0;
        const avgDuration = row.holdDurationQty > eps ? (row.holdDurationQtyDays / row.holdDurationQty) : 0;
        const openLots = lotsByAsset.get(row.symbol) || [];
        const openQty = openLots.reduce((sum, lot) => sum + safeNum(lot.qty), 0);
        const openCost = openLots.reduce((sum, lot) => sum + (safeNum(lot.qty) * safeNum(lot.price)), 0);
        const avgPurchasePrice = openQty > eps
          ? openCost / openQty
          : (lastBuyPriceBySymbol.get(row.symbol) || 0);
        const currentPrice =
          safeNum(livePriceBySymbol[row.symbol]) ||
          portfolioPriceMap.get(row.symbol) ||
          0;
        const priceMove = (avgPurchasePrice > 0 && currentPrice > 0)
          ? (currentPrice - avgPurchasePrice)
          : 0;
        const currentPosition = portfolioPositionMap.has(row.symbol)
          ? portfolioPositionMap.get(row.symbol)
          : row.netQtyFromTrades;
        const totalGain = currentPosition > eps ? priceMove * currentPosition : 0;
        const avgGain = priceMove;

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
          totalGain
        };
      })
      .sort((a, b) => {
        if (b.tradeCount !== a.tradeCount) return b.tradeCount - a.tradeCount;
        if (b.tradedNotional !== a.tradedNotional) return b.tradedNotional - a.tradedNotional;
        if (b.totalGain !== a.totalGain) return b.totalGain - a.totalGain;
        return a.symbol.localeCompare(b.symbol);
      });

    const unrealizedFromOpenLots = [...lotsByAsset.entries()].reduce((sum, [symbol, lots]) => {
      const currentPrice =
        safeNum(livePriceBySymbol[symbol]) ||
        portfolioPriceMap.get(symbol) ||
        0;
      if (currentPrice <= 0) return sum;
      return sum + lots.reduce((lotSum, lot) => {
        const lotQty = Math.max(0, safeNum(lot.qty));
        const lotEntry = safeNum(lot.price);
        if (lotQty <= eps || lotEntry <= 0) return lotSum;
        return lotSum + ((currentPrice - lotEntry) * lotQty);
      }, 0);
    }, 0);

    const openLotSymbols = new Set([...lotsByAsset.keys()]);
    const unrealizedFromPortfolioFallback = (portfolio || []).reduce((sum, holding) => {
      const symbol = normalizeSymbol(holding.symbol);
      if (openLotSymbols.has(symbol)) return sum;
      const currentPrice = safeNum(holding.price);
      const qty = safeNum(holding.quantity);
      const entryPrice = safeNum(holding.entryPrice);
      if (currentPrice <= 0 || qty <= 0 || entryPrice <= 0) return sum;
      return sum + ((currentPrice - entryPrice) * qty);
    }, 0);

    const unrealizedPnl = unrealizedFromOpenLots + unrealizedFromPortfolioFallback;
    const totalGainLoss = realizedGainLoss + unrealizedPnl;

    return {
      totalTrades: sortedTrades.length,
      avgHoldDays,
      wins: wins.length,
      losses: losses.length,
      breakevens: breakevens.length,
      winRate: decisiveTrades ? (wins.length / decisiveTrades) * 100 : 0,
      breakevenRate: totalRealizedTrades ? (breakevens.length / totalRealizedTrades) * 100 : 0,
      totalGainLoss,
      realizedPnl: realizedGainLoss,
      unrealizedPnl,
      tradeExpectancy: realized.length ? realizedGainLoss / realized.length : 0,
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
  }, [trades, portfolio, livePriceBySymbol, nowTs]);

  const portfolioValue = useMemo(
    () => (portfolio || []).reduce((total, item) => total + ((Number(item.price) || 0) * (Number(item.quantity) || 0)), 0),
    [portfolio]
  );
  const availableBalance = Number.isFinite(Number(balance)) ? Number(balance) : 0;
  const totalAccountEquity = Number.isFinite(Number(accountEquity))
    ? Number(accountEquity)
    : availableBalance + portfolioValue;

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
    { label: "Realized PnL", value: analytics.realizedPnl, currency: true },
    { label: "Unrealized PnL", value: analytics.unrealizedPnl, currency: true },
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

  const formatDurationFromDays = (days) => {
    const safeDays = Number.isFinite(Number(days)) ? Number(days) : 0;
    const hours = safeDays * 24;
    if (Math.abs(hours) < 24) {
      return `${hours.toFixed(1)}h`;
    }
    return `${safeDays.toFixed(1)}d`;
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
    const normalizeDateKey = (dateStr) => {
      if (!dateStr) return "";
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
      const d = new Date(dateStr);
      if (Number.isNaN(d.getTime())) return "";
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    };

    const equityByDate = new Map();
    const sorted = [...executionRows].sort((a, b) => {
      const ta = new Date(a.executedAt || a.date || 0).getTime() || 0;
      const tb = new Date(b.executedAt || b.date || 0).getTime() || 0;
      return ta - tb;
    });

    for (const trade of sorted) {
      const dayKey = normalizeDateKey(trade.executedAt || trade.date);
      if (!dayKey) continue;
      const eqRaw = Number(trade.accountEquityAfter);
      const balRaw = Number(trade.balanceAfter);
      const pvRaw = Number(trade.portfolioValueAfter);
      const eq = Number.isFinite(eqRaw)
        ? eqRaw
        : (Number.isFinite(balRaw) && Number.isFinite(pvRaw) ? balRaw + pvRaw : null);
      if (Number.isFinite(eq)) {
        // keep last execution equity snapshot of that day
        equityByDate.set(dayKey, eq);
      }
    }

    const today = new Date();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    if (Number.isFinite(totalAccountEquity)) {
      equityByDate.set(todayKey, Number(totalAccountEquity));
    }

    const orderedDates = [...equityByDate.keys()].sort();
    const pnlByDate = new Map();
    let prevEquity = null;
    for (const day of orderedDates) {
      const eq = Number(equityByDate.get(day));
      if (!Number.isFinite(eq)) continue;
      if (prevEquity === null) {
        prevEquity = eq;
        pnlByDate.set(day, 0);
        continue;
      }
      pnlByDate.set(day, eq - prevEquity);
      prevEquity = eq;
    }

    if (selectedSymbols.length === 0) {
      return pnlByDate;
    }

    // Symbol-filtered fallback uses realized closes for selected symbols.
    const activeSet = new Set(selectedSymbols);
    const realizedByDate = new Map();
    for (const trade of analytics.realizedTrades) {
      if (!trade.closeDate) continue;
      if (activeSet.size > 0 && !activeSet.has((trade.asset || "").toUpperCase())) {
        continue;
      }
      realizedByDate.set(trade.closeDate, (realizedByDate.get(trade.closeDate) || 0) + (Number(trade.pnl) || 0));
    }
    return realizedByDate;
  }, [analytics.realizedTrades, selectedSymbols, executionRows, totalAccountEquity]);

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
          <div className="value">{formatDurationFromDays(analytics.avgHoldDays)}</div>
        </div>
        <div className="metric-card glass">
          <label>Available Balance</label>
          <div className="value">{formatValue(availableBalance, true)}</div>
        </div>
        <div className="metric-card glass">
          <label>Total Account Equity</label>
          <div className="value">{formatValue(totalAccountEquity, true)}</div>
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
                    <div className="trade-meta">
                      {trade.type === "BUY" ? "" : "Proceeds "}{formatValue(Number(trade.notional) || 0, true)}
                    </div>
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
                <div className={`calendar-day ${cell.pnl > 0 ? "positive" : cell.pnl < 0 ? "negative" : ""}`}>{cell.dayNum}</div>
                {cell.pnl != null && (
                  <div className={`calendar-pnl ${cell.pnl > 0 ? "positive" : cell.pnl < 0 ? "negative" : ""}`}>
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
          <div className="asset-count">
            {analytics.tradedAssetsReport.length} Assets
            {lastReportPriceRefreshAt ? ` · Prices refreshed ${new Date(lastReportPriceRefreshAt).toLocaleString()}` : ""}
          </div>
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
                      <td>{formatDurationFromDays(row.tradeDuration)}</td>
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
