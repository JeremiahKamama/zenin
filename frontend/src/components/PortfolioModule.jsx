import { useState, useMemo } from "react";
import ReactApexChart from "react-apexcharts";
import { calculateAccountSnapshot, INITIAL_ACCOUNT_BALANCE } from "../utils/accountMetrics";
import { calculateOptionPnL } from "../utils/optionsPnL";

export function PortfolioModule({
  portfolio,
  trades = [],
  balance = 0,
  accountMetrics = null,
  calculatePortfolioValue,
  calculatePortfolioGain,
  activeOptionsTrades = [],
  multiChainCache = {},
  spotPrices = {},
  onRemove,
  onSellAsset,
  onSelectAsset
}){
  const [chartMode, setChartMode] = useState("equity");
  const [chartInterval, setChartInterval] = useState("1D");
  const [showDiversificationModal, setShowDiversificationModal] = useState(false);
  const [holdingsSortBy, setHoldingsSortBy] = useState("value");
  const [selectedHolding, setSelectedHolding] = useState(null);
  const [benchmarkSymbol, setBenchmarkSymbol] = useState("SPY");
  const [selectedTaxLotMethod, setSelectedTaxLotMethod] = useState("hifo");
  const INTERVALS = ["1D", "1W", "1M", "3M", "1Y", "ALL"];

// ✅ 1) compute portfolioValue first
const portfolioValue = calculatePortfolioValue();

// ✅ 2) compute metrics next
const derivedAccountMetrics = useMemo(
  () =>
    calculateAccountSnapshot({
      trades,
      portfolioValue,
      balance,
    }),
  [trades, portfolioValue, balance]
);

const activeAccountMetrics = accountMetrics || derivedAccountMetrics;
const initialBalance =
  Number(activeAccountMetrics?.initialBalance) || INITIAL_ACCOUNT_BALANCE;

const tradeTimeline = Array.isArray(activeAccountMetrics?.tradeTimeline)
  ? activeAccountMetrics.tradeTimeline
  : [];

// ✅ 3) now liveAvailableBalance exists
const liveAvailableBalance = Number.isFinite(
  Number(activeAccountMetrics?.liveAvailableBalance)
)
  ? Number(activeAccountMetrics.liveAvailableBalance)
  : initialBalance;

// ✅ 4) compute totalOptionsValue safely (NO undefined helpers)
const totalOptionsValue = (Array.isArray(activeOptionsTrades)
  ? activeOptionsTrades
  : []
).reduce((acc, trade) => {
  const chain = multiChainCache[trade.asset];
  const spot = spotPrices[trade.asset];
  const metrics = calculateOptionPnL(trade, chain, spot);
  const value = Number(metrics.pnl || 0);
  return acc + (Number.isFinite(value) ? value : 0);
}, 0);

const optionTimelineAdjustments = useMemo(() => {
  return (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : [])
    .map((trade) => {
      const openedAtRaw = trade?.executedAt || trade?.openedAt || trade?.createdAt || trade?.date;
      const openedAt = new Date(openedAtRaw || 0).getTime();
      if (!Number.isFinite(openedAt) || openedAt <= 0) return null;
      const chain = multiChainCache?.[trade.asset];
      const spot = spotPrices?.[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      const currentPnl = Number(metrics?.pnl || 0);
      if (!Number.isFinite(currentPnl)) return null;
      return { openedAt, currentPnl };
    })
    .filter(Boolean)
    .sort((a, b) => a.openedAt - b.openedAt);
}, [activeOptionsTrades, multiChainCache, spotPrices]);

// ✅ 5) now totalAccountEquity is safe
const totalAccountEquity =
  liveAvailableBalance + portfolioValue + totalOptionsValue;

// keep your existing name
const currentAccountEquity = totalAccountEquity;

const isProfitable = currentAccountEquity >= initialBalance;
  const chartColor = chartMode === "pnl" ? (isProfitable ? "#22c55e" : "#ef4444") : "#38bdf8";

  const chartData = useMemo(() => {
    const pointCountMap = { "1D": 24, "1W": 7, "1M": 30, "3M": 90, "1Y": 52, "ALL": 120, "YTD": 52, "5Y": 60, "MAX": 120 };
    const points = pointCountMap[chartInterval] || 24;
    const now = Date.now();
    const start = (() => {
      if (chartInterval === "1D") return now - 24 * 60 * 60 * 1000;
      if (chartInterval === "1W") return now - 7 * 24 * 60 * 60 * 1000;
      if (chartInterval === "1M") return now - 30 * 24 * 60 * 60 * 1000;
      if (chartInterval === "3M") return now - 90 * 24 * 60 * 60 * 1000;
      if (chartInterval === "1Y") return now - 365 * 24 * 60 * 60 * 1000;
      if (chartInterval === "ALL") {
        const firstTradeTs = tradeTimeline[0]?.t;
        return Number.isFinite(firstTradeTs) ? firstTradeTs : now - 365 * 24 * 60 * 60 * 1000;
      }
      if (chartInterval === "YTD") {
        const d = new Date(now);
        return new Date(d.getFullYear(), 0, 1).getTime();
      }
      if (chartInterval === "5Y") return now - 5 * 365 * 24 * 60 * 60 * 1000;
      const firstTradeTs = tradeTimeline[0]?.t;
      return Number.isFinite(firstTradeTs) ? firstTradeTs : now - 30 * 24 * 60 * 60 * 1000;
    })();

    const inRangeTrades = tradeTimeline.filter((trade) => trade.t >= start && trade.t <= now && Number.isFinite(trade.equity));
    const beforeRangeTrade = [...tradeTimeline]
      .reverse()
      .find((trade) => trade.t < start && Number.isFinite(trade.equity));
    const startEquity = Number.isFinite(beforeRangeTrade?.equity) ? beforeRangeTrade.equity : initialBalance;

    const optionOpenAnchors = optionTimelineAdjustments.map((entry, idx) => ({
      t: entry.openedAt,
      equity: Number.isFinite(beforeRangeTrade?.equity) ? beforeRangeTrade.equity : startEquity,
      id: `opt-open-${idx}`
    }));

    const anchors = [
      { t: start, equity: startEquity },
      ...inRangeTrades.map((trade) => ({ t: trade.t, equity: trade.equity })),
      ...optionOpenAnchors.filter((entry) => entry.t >= start && entry.t <= now),
      { t: now, equity: currentAccountEquity }
    ].sort((a, b) => a.t - b.t);

    let anchorIdx = 0;
    const step = points > 1 ? (now - start) / (points - 1) : 0;

    const getOptionAdjustmentAt = (timestamp) => {
      return optionTimelineAdjustments.reduce((sum, entry) => {
        if (timestamp <= entry.openedAt) return sum;
        const horizon = Math.max(1, now - entry.openedAt);
        const progress = Math.max(0, Math.min(1, (timestamp - entry.openedAt) / horizon));
        return sum + (entry.currentPnl * progress);
      }, 0);
    };

    const toSeriesValue = (equity) => {
      if (chartMode === "equity") return equity;
      if (chartMode === "percentage") return ((equity - initialBalance) / initialBalance) * 100;
      return equity - initialBalance;
    };

    return Array.from({ length: points }, (_, i) => {
      const t = start + step * i;
      while (anchorIdx + 1 < anchors.length && anchors[anchorIdx + 1].t <= t) {
        anchorIdx += 1;
      }
      const baseEquity = Number(anchors[anchorIdx]?.equity ?? initialBalance);
      const equity = baseEquity + getOptionAdjustmentAt(t);
      return [
        t, // timestamp in ms for ApexCharts datetime axis
        Number(toSeriesValue(equity).toFixed(2))
      ];
    });
  }, [chartInterval, chartMode, tradeTimeline, currentAccountEquity, optionTimelineAdjustments, initialBalance]);
  const yFormatter = (val) => {
    if (chartMode === "percentage") return `${val.toFixed(2)}%`;
    if (chartMode === "pnl") return `$${val.toFixed(2)}`;
    return `$${val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const chartOptions = {
    chart: { type: "area", toolbar: { show: false }, background: "transparent", animations: { enabled: false } },
    theme: { mode: "dark" },
    stroke: { curve: "smooth", width: 2, colors: [chartColor] },
    fill: {
      type: "gradient",
      gradient: {
        colorStops: [{ offset: 0, color: chartColor, opacity: 0.3 }, { offset: 100, color: chartColor, opacity: 0 }]
      }
    },
    xaxis: { type: "datetime", labels: { style: { colors: "#64748b", fontSize: "10px" } }, axisBorder: { show: false }, axisTicks: { show: false } },
    yaxis: { labels: { style: { colors: "#94a3b8", fontSize: "11px" }, formatter: yFormatter } },
    grid: { borderColor: "rgba(255,255,255,0.05)", strokeDashArray: 4, xaxis: { lines: { show: false } } },
    tooltip: { theme: "dark", x: { format: "dd MMM yyyy HH:mm" }, y: { formatter: yFormatter } },
    dataLabels: { enabled: false },
    markers: { size: 0 }
  };

  const diversificationRows = useMemo(() => {
    const stockLikeHoldings = (Array.isArray(portfolio) ? portfolio : []).filter((item) => {
      const type = String(item?.type || "").trim().toLowerCase();
      return ["stock", "stocks", "equity", "etf", "etfs"].includes(type) || !!item?.theme;
    });
    const source = stockLikeHoldings.length > 0 ? stockLikeHoldings : (Array.isArray(portfolio) ? portfolio : []);
    const totalExposure = source.reduce(
      (sum, item) => sum + ((Number(item?.price) || 0) * (Number(item?.quantity) || 0)),
      0
    );
    const grouped = new Map();

    source.forEach((item) => {
      const theme = String(item?.theme || item?.type || "Unassigned").trim() || "Unassigned";
      const value = (Number(item?.price) || 0) * (Number(item?.quantity) || 0);
      const row = grouped.get(theme) || {
        theme,
        positions: 0,
        value: 0,
        symbols: []
      };
      row.positions += 1;
      row.value += value;
      const symbol = String(item?.symbol || "").trim().toUpperCase();
      if (symbol && !row.symbols.includes(symbol)) row.symbols.push(symbol);
      grouped.set(theme, row);
    });

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        weight: totalExposure > 0 ? (row.value / totalExposure) * 100 : 0
      }))
      .sort((a, b) => b.value - a.value);
  }, [portfolio]);

  const attributionRows = useMemo(() => {
    const bySector = new Map();
    const byRegion = new Map();
    const byFactor = new Map();
    (Array.isArray(portfolio) ? portfolio : []).forEach((item) => {
      const qty = Number(item?.quantity || 0);
      const px = Number(item?.price || 0);
      const value = qty * px;
      const entry = Number(item?.entryPrice || px || 0);
      const pnl = value - (entry * qty);
      const sector = String(item?.theme || item?.sector || "Unclassified");
      const region = String(item?.region || item?.country || "Global");
      const factor = String(item?.factor || item?.style || (Number(item?.beta || 1) > 1.1 ? "High Beta" : "Core"));
      bySector.set(sector, (bySector.get(sector) || 0) + pnl);
      byRegion.set(region, (byRegion.get(region) || 0) + pnl);
      byFactor.set(factor, (byFactor.get(factor) || 0) + pnl);
    });
    const toRows = (map, group) => [...map.entries()].map(([name, pnl]) => ({ group, name, pnl })).sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
    return {
      sector: toRows(bySector, "Sector"),
      region: toRows(byRegion, "Region"),
      factor: toRows(byFactor, "Factor")
    };
  }, [portfolio]);

  const exposureRows = useMemo(() => {
    const groups = {
      sector: new Map(),
      country: new Map(),
      currency: new Map()
    };
    let total = 0;
    (Array.isArray(portfolio) ? portfolio : []).forEach((item) => {
      const value = (Number(item?.price || 0) * Number(item?.quantity || 0));
      total += value;
      const sector = String(item?.theme || item?.sector || "Unclassified");
      const country = String(item?.country || item?.region || "Global");
      const currency = String(item?.currency || "USD");
      groups.sector.set(sector, (groups.sector.get(sector) || 0) + value);
      groups.country.set(country, (groups.country.get(country) || 0) + value);
      groups.currency.set(currency, (groups.currency.get(currency) || 0) + value);
    });
    const normalize = (map, bucket) =>
      [...map.entries()]
        .map(([name, value]) => ({
          bucket,
          name,
          value,
          weight: total > 0 ? (value / total) * 100 : 0
        }))
        .sort((a, b) => b.weight - a.weight);
    return [...normalize(groups.sector, "Sector"), ...normalize(groups.country, "Country"), ...normalize(groups.currency, "Currency")];
  }, [portfolio]);

  const attributionSummary = useMemo(() => {
    const sectorTop = attributionRows?.sector?.[0] || null;
    const regionTop = attributionRows?.region?.[0] || null;
    return {
      sectorTop,
      regionTop
    };
  }, [attributionRows]);

  // Performance Metrics
  const metrics = useMemo(() => {
    const EPS = 1e-8;
    const annualization = Math.sqrt(252);
    const riskFreeDaily = 0.0425 / 252;
    const formatMetric = (value, digits = 2) => (Number.isFinite(value) ? value.toFixed(digits) : "N/A");

    const equityPoints = [
      { t: Date.now(), equity: currentAccountEquity },
      ...tradeTimeline
        .filter((point) => Number.isFinite(point?.equity))
        .map((point) => ({ t: Number(point.t) || 0, equity: Number(point.equity) }))
    ]
      .filter((point) => Number.isFinite(point.equity) && point.equity > 0)
      .sort((a, b) => a.t - b.t);

    if (equityPoints.length < 2) {
      return {
        sharpe: "N/A",
        sortino: "N/A",
        maxDrawdown: "0.00",
        alpha: "N/A",
        beta: "N/A"
      };
    }

    const returns = [];
    for (let i = 1; i < equityPoints.length; i += 1) {
      const prev = equityPoints[i - 1].equity;
      const next = equityPoints[i].equity;
      if (prev <= EPS || !Number.isFinite(prev) || !Number.isFinite(next)) continue;
      const r = (next / prev) - 1;
      if (Number.isFinite(r)) returns.push(r);
    }

    const meanReturn = returns.length
      ? returns.reduce((sum, r) => sum + r, 0) / returns.length
      : NaN;
    const variance = returns.length > 1
      ? returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) / (returns.length - 1)
      : NaN;
    const stdDev = Number.isFinite(variance) && variance > EPS ? Math.sqrt(variance) : NaN;

    const downsideSquares = returns.map((r) => Math.min(0, r - riskFreeDaily) ** 2);
    const downsideVariance = downsideSquares.length
      ? downsideSquares.reduce((sum, v) => sum + v, 0) / downsideSquares.length
      : NaN;
    const downsideDeviation = Number.isFinite(downsideVariance) && downsideVariance > EPS ? Math.sqrt(downsideVariance) : NaN;

    const sharpe = Number.isFinite(stdDev) ? ((meanReturn - riskFreeDaily) / stdDev) * annualization : NaN;
    const sortino = Number.isFinite(downsideDeviation) ? ((meanReturn - riskFreeDaily) / downsideDeviation) * annualization : NaN;

    let peak = equityPoints[0].equity;
    let maxDrawdown = 0;
    equityPoints.forEach((point) => {
      peak = Math.max(peak, point.equity);
      const drawdown = peak > EPS ? ((peak - point.equity) / peak) * 100 : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    return {
      sharpe: formatMetric(sharpe),
      sortino: formatMetric(sortino),
      maxDrawdown: formatMetric(maxDrawdown),
      alpha: "N/A",
      beta: "N/A"
    };
  }, [tradeTimeline, currentAccountEquity]);

  const predictionMarketRows = useMemo(() => {
    const source = Array.isArray(trades) ? trades : [];
    const predictionTrades = source
      .filter((trade) => {
        const mt = String(trade?.marketType || "").toLowerCase();
        return ["prediction", "polymarket", "yesno"].includes(mt);
      })
      .map((trade) => {
        const side = String(trade?.side || trade?.type || "").toLowerCase() === "sell" ? "sell" : "buy";
        const qty = Math.abs(Number(trade?.quantity) || 0);
        const price = Number(trade?.price) || 0;
        const ts = new Date(trade?.executedAt || trade?.date || 0).getTime() || 0;
        const market = String(trade?.name || trade?.asset || "Unknown Market").trim();
        return { market, side, qty, price, ts };
      })
      .filter((trade) => trade.qty > 0 && trade.price >= 0 && trade.market)
      .sort((a, b) => a.ts - b.ts);

    if (!predictionTrades.length) return [];

    const byMarket = new Map();
    predictionTrades.forEach((trade) => {
      const row = byMarket.get(trade.market) || {
        market: trade.market,
        netQty: 0,
        netCost: 0,
        realizedPnl: 0,
        lastPrice: 0,
        lastTs: 0
      };
      if (trade.side === "buy") {
        row.netQty += trade.qty;
        row.netCost += trade.qty * trade.price;
      } else {
        const qtyToClose = Math.min(row.netQty, trade.qty);
        const avgCost = row.netQty > 0 ? row.netCost / row.netQty : 0;
        row.realizedPnl += qtyToClose * (trade.price - avgCost);
        row.netQty -= qtyToClose;
        row.netCost -= qtyToClose * avgCost;
      }
      row.lastPrice = trade.price;
      row.lastTs = trade.ts;
      byMarket.set(trade.market, row);
    });

    return [...byMarket.values()]
      .map((row) => {
        const avgOpenCost = row.netQty > 0 ? row.netCost / row.netQty : 0;
        const unrealizedPnl = row.netQty > 0 ? row.netQty * (row.lastPrice - avgOpenCost) : 0;
        const pnl = row.realizedPnl + unrealizedPnl;
        return { market: row.market, pnl, netQty: row.netQty, updatedAt: row.lastTs };
      })
      .sort((a, b) => Math.abs(b.pnl) - Math.abs(a.pnl));
  }, [trades]);

  const combinedHoldings = useMemo(() => {
    const spotRows = (Array.isArray(portfolio) ? portfolio : []).map((item) => {
      const positionValue = (Number(item?.price) || 0) * (Number(item?.quantity) || 0);
      const entryPrice = Number(item?.entryPrice);
      const basisPrice = Number.isFinite(entryPrice) ? entryPrice : Number(item?.price) || 0;
      const positionGain = positionValue - (basisPrice * (Number(item?.quantity) || 0));
      return {
        kind: "spot",
        key: `spot-${item.id}`,
        positionValue,
        positionGain,
        row: item
      };
    });

    const optionRows = (Array.isArray(activeOptionsTrades) ? activeOptionsTrades : []).map((trade) => {
      const chain = multiChainCache[trade.asset];
      const spot = spotPrices[trade.asset];
      const metrics = calculateOptionPnL(trade, chain, spot);
      const currentMark = Number(metrics?.currentMark || 0);
      const qty = Number(trade?.qty || trade?.quantity || 1);
      const pnl = Number(metrics?.pnl || 0);
      return {
        kind: "options",
        key: `opt-${trade.id}`,
        positionValue: Math.abs(currentMark * qty),
        positionGain: pnl,
        row: trade,
        metrics
      };
    });

    return [...spotRows, ...optionRows].sort((a, b) => (b.positionValue || 0) - (a.positionValue || 0));
  }, [portfolio, activeOptionsTrades, multiChainCache, spotPrices]);

  const sortedHoldings = useMemo(() => {
    const score = (row) => {
      if (holdingsSortBy === "value") return Number(row.positionValue || 0);
      if (holdingsSortBy === "pnl") return Number(row.positionGain || 0);
      if (holdingsSortBy === "return") {
        const base = row.kind === "spot"
          ? (Number(row.row?.entryPrice || row.row?.price || 0) * Number(row.row?.quantity || 0))
          : Math.abs(Number(row.row?.netPremiumAtEntry || 0) * Number(row.row?.qty || row.row?.quantity || 1));
        return base > 0 ? (Number(row.positionGain || 0) / base) * 100 : 0;
      }
      if (holdingsSortBy === "risk") return Math.abs(Number(row.positionGain || 0));
      return Number(row.positionValue || 0);
    };
    return [...combinedHoldings].sort((a, b) => score(b) - score(a));
  }, [combinedHoldings, holdingsSortBy]);

  const benchmarkSeries = useMemo(() => {
    const drift = benchmarkSymbol === "SPY" ? 0.0008 : benchmarkSymbol === "ACWI" ? 0.0006 : 0.0005;
    if (!Array.isArray(chartData) || chartData.length === 0) return [];
    const first = Number(chartData[0]?.[1] || 0);
    return chartData.map((point, idx) => {
      const t = point[0];
      const base = first * (1 + drift * idx);
      return [t, Number(base.toFixed(2))];
    });
  }, [chartData, benchmarkSymbol]);

  const rebalanceSuggestions = useMemo(() => {
    const holdings = sortedHoldings.filter((row) => row.kind === "spot");
    const total = holdings.reduce((sum, row) => sum + Number(row.positionValue || 0), 0);
    if (!holdings.length || total <= 0) return [];
    const target = 100 / holdings.length;
    return holdings.map((row) => {
      const current = (Number(row.positionValue || 0) / total) * 100;
      const drift = current - target;
      const action = drift > 2 ? "Trim" : drift < -2 ? "Add" : "Hold";
      return {
        symbol: row.row?.symbol || row.row?.asset || "—",
        current,
        target,
        drift,
        action
      };
    }).sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift));
  }, [sortedHoldings]);

  const formatMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "$0.00";
    return `$${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatSignedMoney = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return "$0.00";
    return `${num >= 0 ? "+" : "-"}$${Math.abs(num).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const stablecoinSymbols = useMemo(
    () => new Set(["USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USDE", "USDD"]),
    []
  );

  const exposureSummary = useMemo(() => {
    const pickTop = (bucket) => exposureRows.find((row) => String(row.bucket || "").toLowerCase() === bucket) || null;
    return {
      sector: pickTop("sector"),
      country: pickTop("country"),
      currency: pickTop("currency")
    };
  }, [exposureRows]);

  const bestPerformer = useMemo(() => {
    const rows = Array.isArray(portfolio) ? portfolio : [];
    if (!rows.length) return null;
    return [...rows].sort((a, b) => Number(b?.priceChangePercent || 0) - Number(a?.priceChangePercent || 0))[0];
  }, [portfolio]);

  const holdingsTableRows = useMemo(() => {
    const total = sortedHoldings.reduce((sum, row) => sum + Number(row?.positionValue || 0), 0);
    return sortedHoldings.map((holding) => {
      if (holding.kind === "spot") {
        const item = holding.row;
        const symbol = String(item?.symbol || "N/A").toUpperCase();
        const quantity = Number(item?.quantity || 0);
        const allocation = total > 0 ? (Number(holding.positionValue || 0) / total) * 100 : 0;
        const isStable = stablecoinSymbols.has(symbol) || String(item?.type || "").toLowerCase() === "stablecoin";
        const status = isStable ? "Cash" : "Hold";
        return {
          key: holding.key,
          kind: "spot",
          symbol,
          name: item?.name || symbol,
          allocation,
          markValueMain: formatMoney(holding.positionValue),
          markValueSub: `${quantity.toFixed(4)} ${symbol}`,
          pnlMain: formatSignedMoney(holding.positionGain),
          pnlSub: `${Number(item?.priceChangePercent || 0) >= 0 ? "+" : ""}${Number(item?.priceChangePercent || 0).toFixed(2)}%`,
          pnlPositive: Number(holding.positionGain || 0) >= 0,
          status,
          statusClass: status.toLowerCase(),
          raw: item
        };
      }

      const trade = holding.row;
      const symbol = String(trade?.asset || "OPT").toUpperCase();
      const qty = Number(trade?.qty || trade?.quantity || 0);
      const allocation = total > 0 ? (Number(holding.positionValue || 0) / total) * 100 : 0;
      const pnl = Number(holding.positionGain || 0);
      const base = Math.abs(Number(trade?.netPremiumAtEntry || 0) * Math.max(1, qty));
      const pct = base > 0 ? (pnl / base) * 100 : 0;
      return {
        key: holding.key,
        kind: "options",
        symbol,
        name: trade?.strategy || "Options",
        allocation,
        markValueMain: formatMoney(holding.positionValue),
        markValueSub: `${qty.toFixed(5)} Units`,
        pnlMain: formatSignedMoney(pnl),
        pnlSub: `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`,
        pnlPositive: pnl >= 0,
        status: "Options",
        statusClass: "options",
        raw: trade
      };
    });
  }, [sortedHoldings, stablecoinSymbols]);

  const recentActivityRows = useMemo(() => {
    const rows = (Array.isArray(trades) ? trades : [])
      .map((trade) => {
        const ts = new Date(trade?.executedAt || trade?.date || 0).getTime();
        const qty = Number(trade?.quantity || 0);
        const notional = Number(trade?.notional || (Number(trade?.price || 0) * qty));
        const symbol = String(trade?.asset || "Asset").toUpperCase();
        const isSell = String(trade?.side || trade?.type || "").toLowerCase() === "sell";
        return {
          id: trade?.id || `${symbol}-${ts}`,
          symbol,
          side: isSell ? "Sell" : "Buy",
          tone: isSell ? "sell" : "buy",
          ts,
          qty: Math.abs(qty),
          notional: Number.isFinite(notional) ? Math.abs(notional) : 0
        };
      })
      .filter((row) => Number.isFinite(row.ts) && row.ts > 0)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 4);

    const now = Date.now();
    return rows.map((row) => {
      const hours = Math.floor((now - row.ts) / (60 * 60 * 1000));
      const when = hours >= 24 ? `${Math.floor(hours / 24)}d ago` : hours >= 1 ? `${hours}h ago` : "just now";
      return { ...row, when };
    });
  }, [trades]);

  const totalGainLoss = Number(calculatePortfolioGain?.() || 0);
  const totalReturnPct = initialBalance > 0 ? (totalGainLoss / initialBalance) * 100 : 0;
  const cashWeight = currentAccountEquity > 0 ? (liveAvailableBalance / currentAccountEquity) * 100 : 0;

  return (
    <div className="portfolio-module portfolio-v2">
      <div className="portfolio-v2-head">
        <div className="portfolio-v2-title-row">
          <h2>Portfolio</h2>
          <span className="portfolio-v2-badge">v2</span>
        </div>
        <div className="portfolio-v2-toolbar">
          <select className="portfolio-v2-select" defaultValue="all">
            <option value="all">All Accounts</option>
          </select>
          <div className="portfolio-v2-range">
            {INTERVALS.map((int) => (
              <button
                key={int}
                type="button"
                className={`portfolio-v2-range-btn ${chartInterval === int ? "active" : ""}`}
                onClick={() => setChartInterval(int)}
              >
                {int}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="portfolio-v2-top-cards">
        <article className="portfolio-v2-stat-card">
          <span className="label">Total Account Equity</span>
          <strong>{formatMoney(currentAccountEquity)}</strong>
          <span className={`delta ${totalGainLoss >= 0 ? "positive" : "negative"}`}>
            {formatSignedMoney(totalGainLoss)} ({totalReturnPct >= 0 ? "+" : ""}{totalReturnPct.toFixed(2)}%)
          </span>
        </article>
        <article className="portfolio-v2-stat-card">
          <span className="label">Cash</span>
          <strong>{formatMoney(liveAvailableBalance)}</strong>
          <span className="sub">{cashWeight.toFixed(1)}% of portfolio</span>
        </article>
        <article className="portfolio-v2-stat-card">
          <span className="label">Best Performing</span>
          <strong>{bestPerformer?.symbol || "N/A"}</strong>
          <span className="delta positive">
            {bestPerformer ? `${Number(bestPerformer?.priceChangePercent || 0) >= 0 ? "+" : ""}${Number(bestPerformer?.priceChangePercent || 0).toFixed(2)}%` : "N/A"}
          </span>
        </article>
        <article className="portfolio-v2-stat-card">
          <span className="label">Exposure Summary</span>
          <div className="portfolio-v2-mini-grid">
            <div><span>Sector</span><strong>{exposureSummary.sector?.name || "Unclassified"} {exposureSummary.sector ? `${exposureSummary.sector.weight.toFixed(1)}%` : ""}</strong></div>
            <div><span>Country</span><strong>{exposureSummary.country?.name || "Global"} {exposureSummary.country ? `${exposureSummary.country.weight.toFixed(1)}%` : ""}</strong></div>
            <div><span>Currency</span><strong>{exposureSummary.currency?.name || "USD"} {exposureSummary.currency ? `${exposureSummary.currency.weight.toFixed(1)}%` : ""}</strong></div>
          </div>
        </article>
      </div>

      <div className="portfolio-v2-main-grid">
        <div className="portfolio-v2-left">
          <section className="watchlist-panel glass portfolio-v2-panel">
            <div className="section-header">
              <h2>Holdings &amp; Positions</h2>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span className="asset-count">{holdingsTableRows.length} Positions</span>
                <select
                  value={holdingsSortBy}
                  onChange={(e) => setHoldingsSortBy(e.target.value)}
                  className="portfolio-v2-select"
                >
                  <option value="value">Sort: Value</option>
                  <option value="pnl">Sort: PnL</option>
                  <option value="return">Sort: Return</option>
                  <option value="risk">Sort: Risk</option>
                </select>
              </div>
            </div>
            <div className="portfolio-v2-table-wrap">
              <table className="portfolio-v2-table">
                <thead>
                  <tr>
                    <th>Symbol / Name</th>
                    <th>Allocation</th>
                    <th>Mark / Value</th>
                    <th>P&amp;L</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {holdingsTableRows.map((row) => (
                    <tr key={row.key} onClick={() => row.kind === "spot" ? onSelectAsset?.(row.raw) : null}>
                      <td>
                        <div className="portfolio-v2-symbol-cell">
                          <div className="portfolio-v2-symbol-avatar">{row.symbol.slice(0, 1)}</div>
                          <div>
                            <strong>{row.symbol}</strong>
                            <span>{row.name}</span>
                          </div>
                        </div>
                      </td>
                      <td>{row.allocation.toFixed(2)}%</td>
                      <td>
                        <div className="portfolio-v2-stack">
                          <strong>{row.markValueMain}</strong>
                          <span>{row.markValueSub}</span>
                        </div>
                      </td>
                      <td>
                        <div className={`portfolio-v2-stack ${row.pnlPositive ? "positive" : "negative"}`}>
                          <strong>{row.pnlMain}</strong>
                          <span>{row.pnlSub}</span>
                        </div>
                      </td>
                      <td>
                        <span className={`portfolio-v2-status ${row.statusClass}`}>{row.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={2}><span>Total Account Equity</span> <strong>{formatMoney(currentAccountEquity)}</strong></td>
                    <td colSpan={3}><span>Total Gain/Loss</span> <strong className={totalGainLoss >= 0 ? "positive" : "negative"}>{formatSignedMoney(totalGainLoss)} ({totalReturnPct >= 0 ? "+" : ""}{totalReturnPct.toFixed(2)}%)</strong></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>

          <div className="portfolio-v2-two-col">
            <section className="watchlist-panel glass portfolio-v2-panel">
              <div className="section-header"><h2>Performance Attribution</h2></div>
              <div className="portfolio-v2-attrib-grid">
                {[{ key: "sector", label: "By Sector" }, { key: "region", label: "By Region" }, { key: "factor", label: "By Factor" }].map((group) => {
                  const first = attributionRows[group.key]?.[0];
                  return (
                    <div key={group.key} className="portfolio-v2-attrib-card">
                      <span>{group.label}</span>
                      <strong>{first?.name || "Unclassified"}</strong>
                      <em className={(first?.pnl || 0) >= 0 ? "positive" : "negative"}>
                        {first ? formatSignedMoney(first.pnl) : "$0.00"}
                      </em>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="watchlist-panel glass portfolio-v2-panel">
              <div className="section-header"><h2>Exposure Heatmap</h2></div>
              <div className="portfolio-v2-heatmap">
                {exposureRows.slice(0, 3).map((row) => (
                  <div key={`${row.bucket}-${row.name}`} className="portfolio-v2-heat-cell">
                    <span>{row.bucket}</span>
                    <strong>{row.name}</strong>
                    <em>{row.weight.toFixed(1)}%</em>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <section className="watchlist-panel glass portfolio-v2-panel">
            <div className="section-header"><h2>Rebalancing Suggestions</h2></div>
            <div className="table-scroll">
              <table className="portfolio-v2-table rebalance">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Current</th>
                    <th>Target</th>
                    <th>Drift</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rebalanceSuggestions.slice(0, 8).map((row) => (
                    <tr key={`reb-${row.symbol}`}>
                      <td>{row.symbol}</td>
                      <td>{row.current.toFixed(2)}%</td>
                      <td>{row.target.toFixed(2)}%</td>
                      <td className={row.drift >= 0 ? "negative" : "positive"}>{row.drift >= 0 ? "+" : ""}{row.drift.toFixed(2)}%</td>
                      <td><span className="portfolio-v2-status hold">{row.action}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <aside className="portfolio-v2-right">
          <section className="watchlist-panel glass portfolio-v2-panel">
            <div className="section-header"><h2>Performance Metrics</h2></div>
            <div className="portfolio-v2-metric-list">
              {[
                { label: "Sharpe Ratio", value: metrics.sharpe },
                { label: "Sortino Ratio", value: metrics.sortino },
                { label: "Max Drawdown", value: `${metrics.maxDrawdown}%` },
                { label: "Alpha (Jensen's)", value: metrics.alpha },
                { label: "Beta", value: metrics.beta }
              ].map((m) => (
                <div key={m.label} className="portfolio-v2-metric-row">
                  <span>{m.label}</span>
                  <strong className={m.label === "Max Drawdown" ? "positive" : Number(m.value) < 0 ? "negative" : ""}>{m.value}</strong>
                </div>
              ))}
            </div>
          </section>

          <section className="watchlist-panel glass portfolio-v2-panel">
            <div className="section-header"><h2>Prediction Markets</h2><div className="asset-count">{predictionMarketRows.length} Markets</div></div>
            {predictionMarketRows.length === 0 ? (
              <div className="portfolio-v2-empty">
                <p>No prediction market trades yet.</p>
                <button type="button" className="portfolio-v2-link">Explore Prediction Markets</button>
              </div>
            ) : (
              <div className="portfolio-v2-activity-list">
                {predictionMarketRows.slice(0, 4).map((row) => (
                  <div key={row.market} className="portfolio-v2-activity-row">
                    <div className="portfolio-v2-activity-main">
                      <strong>{row.market}</strong>
                      <span>{row.netQty.toFixed(2)} qty</span>
                    </div>
                    <div className={`portfolio-v2-activity-pnl ${row.pnl >= 0 ? "positive" : "negative"}`}>{formatSignedMoney(row.pnl)}</div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="watchlist-panel glass portfolio-v2-panel">
            <div className="section-header"><h2>Recent Activity</h2></div>
            <div className="portfolio-v2-activity-list">
              {recentActivityRows.map((row) => (
                <div key={row.id} className="portfolio-v2-activity-row">
                  <div className={`portfolio-v2-activity-dot ${row.tone}`}>{row.tone === "sell" ? "↘" : "↗"}</div>
                  <div className="portfolio-v2-activity-main">
                    <strong>{row.side} {row.symbol}</strong>
                    <span>{row.when}</span>
                  </div>
                  <div className="portfolio-v2-activity-value">{formatMoney(row.notional)}</div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>

      {showDiversificationModal ? (
        <div className="modal-overlay" onClick={() => setShowDiversificationModal(false)}>
          <div className="modal-content portfolio-diversification-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header" style={{ marginBottom: "12px" }}>
              <div>
                <h2 style={{ margin: 0 }}>Diversification By Theme</h2>
                <p style={{ margin: "6px 0 0", fontSize: "12px", color: "var(--color-text-secondary)" }}>
                  Theme exposure across your current stock picks.
                </p>
              </div>
              <button type="button" className="pagination-button" onClick={() => setShowDiversificationModal(false)}>
                Close
              </button>
            </div>

            {diversificationRows.length === 0 ? (
              <div className="loading-state">No themed holdings yet.</div>
            ) : (
              <div className="table-scroll">
                <table className="option-chain-table">
                  <thead>
                    <tr>
                      <th>Theme</th>
                      <th>Positions</th>
                      <th>Symbols</th>
                      <th>Exposure</th>
                      <th>Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diversificationRows.map((row) => (
                      <tr key={row.theme}>
                        <td className="greek">{row.theme}</td>
                        <td className="greek">{row.positions}</td>
                        <td className="greek">{row.symbols.join(", ") || "—"}</td>
                        <td className="bid-ask positive">
                          ${row.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </td>
                        <td className="greek">{row.weight.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {selectedHolding ? (
        <div className="modal-overlay" onClick={() => setSelectedHolding(null)}>
          <div className="modal-content portfolio-diversification-modal" onClick={(event) => event.stopPropagation()}>
            <div className="section-header" style={{ marginBottom: "10px" }}>
              <h2 style={{ margin: 0 }}>{selectedHolding.symbol} Detail</h2>
              <button type="button" className="pagination-button" onClick={() => setSelectedHolding(null)}>Close</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", marginBottom: "10px" }}>
              <div className="journal-stat-card"><span className="journal-stat-label">Value</span><span className="journal-stat-value">${Number(selectedHolding.positionValue || 0).toFixed(2)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">PnL</span><span className="journal-stat-value">{Number(selectedHolding.positionGain || 0) >= 0 ? "+" : ""}${Number(selectedHolding.positionGain || 0).toFixed(2)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">Quantity</span><span className="journal-stat-value">{Number(selectedHolding.quantity || 0).toFixed(2)}</span></div>
              <div className="journal-stat-card"><span className="journal-stat-label">Price</span><span className="journal-stat-value">${Number(selectedHolding.price || 0).toFixed(2)}</span></div>
            </div>
            <div style={{ borderTop: "1px solid rgba(148,163,184,0.14)", paddingTop: "10px", marginTop: "10px" }}>
              <div style={{ fontSize: "12px", color: "#94a3b8", marginBottom: "6px" }}>Tax Lot Optimizer</div>
              <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
                <select value={selectedTaxLotMethod} onChange={(e) => setSelectedTaxLotMethod(e.target.value)} style={{ background: "rgba(15,23,42,0.7)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.25)", borderRadius: "8px", padding: "4px 8px", fontSize: "12px" }}>
                  <option value="fifo">FIFO</option>
                  <option value="lifo">LIFO</option>
                  <option value="hifo">HIFO</option>
                  <option value="average">Average Cost</option>
                </select>
                <span style={{ fontSize: "12px", color: "#cbd5e1" }}>
                  Suggested lot method: <strong>{selectedTaxLotMethod.toUpperCase()}</strong> for this sale.
                </span>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
