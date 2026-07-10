import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";

import { ZENIN_API_BASE_URL } from "../constants/apiConfig";
import { zeninFetch } from "../utils/zeninFetch";
import { Sparkline } from "./Sparkline";
const PREDICTION_REFRESH_MS = 21600000; // 6 hours

export function PredictionMarketModule() {
  const [predictionSnapshot, setPredictionSnapshot] = useState(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionStale, setPredictionStale] = useState(false);
  const [predictionNotice, setPredictionNotice] = useState("");
  const [predictionWhalePage, setPredictionWhalePage] = useState(1);
  const [selectedPredictionMarket, setSelectedPredictionMarket] = useState(null);
  const [marketDetails, setMarketDetails] = useState(null);
  const [marketDetailsLoading, setMarketDetailsLoading] = useState(false);
  const [marketDetailsStale, setMarketDetailsStale] = useState(false);
  const [marketDetailsNotice, setMarketDetailsNotice] = useState("");
  const [activeCategory, setActiveCategory] = useState("geopolitics");
  const [whaleMinSize, setWhaleMinSize] = useState(10000);
  const [whaleSort, setWhaleSort] = useState({ key: "transactionSize", direction: "desc" });
  const [whaleCategory, setWhaleCategory] = useState("all");
  // Phase 5: expanded market list (defaults to top 5), fee-aware PnL toggle for the whale table.
  const [showAllCategoryMarkets, setShowAllCategoryMarkets] = useState(false);
  const [whaleIncludeFees, setWhaleIncludeFees] = useState(false);
  // Synthetic 24h probability history is built lazily per-market from the public API when available;
  // the sparkline renders nothing if no series is present.

  useEffect(() => {
    let isMounted = true;

    const fetchPredictionSnapshot = async () => {
      if (!isMounted) return;
      const cached = readResilientCache("prediction-snapshot", { scope: "default" });
      if (cached?.payload && typeof cached.payload === "object") {
        setPredictionSnapshot(cached.payload);
        setPredictionStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
        setPredictionNotice(Boolean(cached.payload?.stale || cached.payload?.unavailable) ? getSnapshotFallbackMessage(cached.payload) : "");
      }
      setPredictionLoading(true);
      try {
        const res = await zeninFetch(`/prediction/snapshot`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (!isMounted) return;
        setPredictionSnapshot(data || null);
        setPredictionStale(Boolean(data?.stale || data?.unavailable));
        setPredictionNotice(Boolean(data?.stale || data?.unavailable) ? getSnapshotFallbackMessage(data) : "");
        writeResilientCache("prediction-snapshot", { scope: "default" }, data || null);
        setPredictionWhalePage(1);
      } catch {
        if (!isMounted) return;
        setPredictionStale(true);
        setPredictionNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "");
      } finally {
        if (isMounted) setPredictionLoading(false);
      }
    };

    fetchPredictionSnapshot();
    const interval = setInterval(fetchPredictionSnapshot, PREDICTION_REFRESH_MS);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    if (!selectedPredictionMarket?.id) {
      setMarketDetails(null);
      setMarketDetailsStale(false);
      return () => {
        isMounted = false;
      };
    }

    const fetchDetails = async () => {
      if (!isMounted) return;
      const cacheParams = { marketId: selectedPredictionMarket.id };
      const cached = readResilientCache("prediction-market-details", cacheParams);
      if (cached?.payload && typeof cached.payload === "object") {
        setMarketDetails(cached.payload);
        setMarketDetailsStale(Boolean(cached.payload?.stale || cached.payload?.unavailable));
        setMarketDetailsNotice(Boolean(cached.payload?.stale || cached.payload?.unavailable) ? getSnapshotFallbackMessage(cached.payload) : "");
      }
      setMarketDetailsLoading(true);
      try {
        const res = await zeninFetch(`/prediction/market-details/${encodeURIComponent(selectedPredictionMarket.id)}`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (!isMounted) return;
        setMarketDetails(data || null);
        setMarketDetailsStale(Boolean(data?.stale || data?.unavailable));
        setMarketDetailsNotice(Boolean(data?.stale || data?.unavailable) ? getSnapshotFallbackMessage(data) : "");
        writeResilientCache("prediction-market-details", cacheParams, data || null);
      } catch {
        if (!isMounted) return;
        setMarketDetailsStale(true);
        setMarketDetailsNotice(cached?.payload ? getSnapshotFallbackMessage(cached.payload) : "");
      } finally {
        if (isMounted) setMarketDetailsLoading(false);
      }
    };

    fetchDetails();
    return () => {
      isMounted = false;
    };
  }, [selectedPredictionMarket]);

  const predictionCategories = ["geopolitics", "crypto", "tech", "politics", "finance"];
  const whaleThresholdOptions = [
    { value: 10000, label: "Above $10K" },
    { value: 50000, label: "Above $50K" },
    { value: 100000, label: "Above $100K" }
  ];
  const predictionMarketsByCategory = predictionSnapshot?.categories || {};
  const predictionWhaleTransactions = Array.isArray(predictionSnapshot?.whaleTransactions)
    ? predictionSnapshot.whaleTransactions
    : [];
  const marketByConditionId = useMemo(() => {
    const byCondition = new Map();
    const categories = predictionSnapshot?.categories && typeof predictionSnapshot.categories === "object"
      ? predictionSnapshot.categories
      : {};
    Object.values(categories).forEach((markets) => {
      if (!Array.isArray(markets)) return;
      markets.forEach((market) => {
        const key = String(market?.conditionId || "");
        if (!key || byCondition.has(key)) return;
        byCondition.set(key, market);
      });
    });
    return byCondition;
  }, [predictionSnapshot]);

  const formatDollar = (value) => {
    const n = Number(value || 0);
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
    return `$${n.toFixed(2)}`;
  };

  const formatPercent = (value, digits = 2) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
  };

  const formatAvgPrice = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return `$${n.toFixed(3)}`;
  };

  const formatSignedDollar = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    const sign = n >= 0 ? "+" : "-";
    return `${sign}${formatDollar(Math.abs(n)).replace("$", "$")}`;
  };

const computeWhalePnl = (item, options = {}) => {
    const includeFees = options.includeFees === true;
    const shares = Number(item?.shares);
    const entryPrice = Number(item?.price);
    const conditionId = String(item?.conditionId || "");
    const market = marketByConditionId.get(conditionId);
    if (!Number.isFinite(shares) || shares <= 0 || !Number.isFinite(entryPrice) || !market) return null;

    const outcomeIndex = Number(item?.outcomeIndex);
    const outcomeRaw = String(item?.outcome || "").trim().toLowerCase();
    const isYesOutcome = Number.isFinite(outcomeIndex)
      ? outcomeIndex === 0
      : outcomeRaw === "yes";
    const isNoOutcome = Number.isFinite(outcomeIndex)
      ? outcomeIndex === 1
      : outcomeRaw === "no";
    if (!isYesOutcome && !isNoOutcome) return null;

    const yesMark = Number(market?.yesPrice);
    const noMark = Number(market?.noPrice);
    const markPrice = isYesOutcome ? yesMark : noMark;
    if (!Number.isFinite(markPrice)) return null;

    const side = String(item?.side || "").trim().toUpperCase();
    const direction = side === "SELL" ? -1 : 1;
    const grossPnl = (markPrice - entryPrice) * shares * direction;
    if (!includeFees) return grossPnl;
    // Heuristic venue fee — Polymarket-style taker fee of 2% on the gross notional.
    const notional = Math.abs(shares * entryPrice);
    const fee = notional * 0.02;
    return grossPnl - fee;
  };

  const toggleWhaleSort = (key) => {
    setWhaleSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === "desc" ? "asc" : "desc" };
      }
      return { key, direction: "desc" };
    });
  };

  const whaleSortArrow = (key) => {
    if (whaleSort.key !== key) return "";
    return whaleSort.direction === "desc" ? " ↓" : " ↑";
  };

  const predictionWhaleRows = useMemo(() => {
    return predictionWhaleTransactions.map((item) => ({
      ...item,
      _pnl: computeWhalePnl(item, { includeFees: whaleIncludeFees })
    }));
  }, [predictionWhaleTransactions, marketByConditionId]);

  const filteredPredictionWhales = useMemo(() => {
    const rows = predictionWhaleRows.filter((item) => {
      if (whaleCategory !== "all" && String(item?.category || "").toLowerCase() !== whaleCategory) return false;
      return Number(item?.transactionSize || 0) >= whaleMinSize;
    });
    const sorted = [...rows].sort((a, b) => {
      const aVal = whaleSort.key === "pnl" ? Number(a?._pnl) : Number(a?.transactionSize);
      const bVal = whaleSort.key === "pnl" ? Number(b?._pnl) : Number(b?.transactionSize);
      const aNum = Number.isFinite(aVal) ? aVal : Number.NEGATIVE_INFINITY;
      const bNum = Number.isFinite(bVal) ? bVal : Number.NEGATIVE_INFINITY;
      if (aNum === bNum) return 0;
      return whaleSort.direction === "asc" ? aNum - bNum : bNum - aNum;
    });
    return sorted;
  }, [predictionWhaleRows, whaleCategory, whaleMinSize, whaleSort]);

  const predictionWhalePageSize = 10;
  const predictionWhaleTotalPages = Math.max(1, Math.ceil(filteredPredictionWhales.length / predictionWhalePageSize));
  const pagedPredictionWhales = filteredPredictionWhales.slice(
    (predictionWhalePage - 1) * predictionWhalePageSize,
    predictionWhalePage * predictionWhalePageSize
  );

  useEffect(() => {
    if (predictionWhalePage > predictionWhaleTotalPages) {
      setPredictionWhalePage(predictionWhaleTotalPages);
    }
  }, [predictionWhalePage, predictionWhaleTotalPages]);

  useEffect(() => {
    setPredictionWhalePage(1);
  }, [whaleMinSize, whaleSort, whaleCategory]);

  const formatDateLabel = (value) => {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };

  const getPredictionCategoryLabel = (category) => {
    if (!category) return "Other";
    return category.charAt(0).toUpperCase() + category.slice(1);
  };

  const selectedCategoryMarkets = Array.isArray(predictionMarketsByCategory?.[activeCategory])
    ? (showAllCategoryMarkets
        ? predictionMarketsByCategory[activeCategory]
        : predictionMarketsByCategory[activeCategory].slice(0, 5))
    : [];

  const allPredictionMarkets = useMemo(() => {
    if (!predictionMarketsByCategory || typeof predictionMarketsByCategory !== "object") return [];
    return Object.values(predictionMarketsByCategory).flatMap((markets) => Array.isArray(markets) ? markets : []);
  }, [predictionMarketsByCategory]);

  const predictionDeskStats = useMemo(() => {
    const categoryRows = predictionCategories.map((category) => {
      const markets = Array.isArray(predictionMarketsByCategory?.[category]) ? predictionMarketsByCategory[category] : [];
      const volume = markets.reduce((sum, market) => sum + (Number(market?.volume24h || market?.volume || 0) || 0), 0);
      return { category, count: markets.length, volume };
    });
    const totalVolume = categoryRows.reduce((sum, row) => sum + row.volume, 0);
    const leadCategory = [...categoryRows].sort((a, b) => b.volume - a.volume)[0] || categoryRows[0] || null;
    const whaleNotional = filteredPredictionWhales.reduce((sum, item) => sum + (Number(item?.transactionSize || 0) || 0), 0);
    const whalePnl = filteredPredictionWhales.reduce((sum, item) => sum + (Number(item?._pnl) || 0), 0);
    return { categoryRows, totalVolume, leadCategory, whaleNotional, whalePnl };
  }, [filteredPredictionWhales, predictionCategories, predictionMarketsByCategory]);

  const formatProbability = (price) => {
    const n = Number(price);
    if (!Number.isFinite(n)) return "—";
    return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`;
  };

  const formatWhaleType = (item) => {
    const side = String(item?.side || "").toUpperCase();
    const arrow = side === "SELL" ? "▼" : "▲";
    const outcomeIndex = Number(item?.outcomeIndex);
    let typeLabel = "";
    if (Number.isFinite(outcomeIndex)) {
      typeLabel = outcomeIndex === 0 ? "Yes" : outcomeIndex === 1 ? "No" : "";
    }
    if (!typeLabel) {
      const rawOutcome = String(item?.outcome || "").trim().toLowerCase();
      if (rawOutcome === "yes") typeLabel = "Yes";
      else if (rawOutcome === "no") typeLabel = "No";
      else typeLabel = String(item?.outcome || "—");
    }
    return `${arrow} ${typeLabel}`;
  };

  const toProbabilityPct = (price) => {
    const n = Number(price);
    if (!Number.isFinite(n)) return 0;
    return Math.round(Math.max(0, Math.min(1, n)) * 100);
  };

  const leadMarket = selectedCategoryMarkets[0] || allPredictionMarkets[0] || null;
  const deskStatusLabel = predictionLoading ? "Refreshing" : predictionStale ? "Cached" : "Live";
  const activeCategoryLabel = getPredictionCategoryLabel(activeCategory);
  const leadProbability = leadMarket ? formatProbability(leadMarket.yesPrice) : "—";

  return (
    <div className="view-container prediction-terminal prediction-desk">
      <section className="prediction-desk-command">
        <div className="prediction-desk-copy">
          <span>Prediction risk desk</span>
          <h2>Probability Desk</h2>
          <p>Event odds, whale flow, and mark-to-entry pressure in one compact risk surface.</p>
        </div>
        <div className="prediction-desk-strip" aria-label="Prediction desk status">
          <div>
            <span>Status</span>
            <strong>{deskStatusLabel}</strong>
          </div>
          <div>
            <span>Book</span>
            <strong>{activeCategoryLabel}</strong>
          </div>
          <div>
            <span>Markets</span>
            <strong>{allPredictionMarkets.length || "—"}</strong>
          </div>
          <div>
            <span>Lead prob</span>
            <strong>{leadProbability}</strong>
          </div>
          <div>
            <span>Whale notional</span>
            <strong>{formatDollar(predictionDeskStats.whaleNotional)}</strong>
          </div>
        </div>
      </section>

      {predictionStale && predictionNotice ? (
        <div className="snapshot-inline-note prediction-desk-notice">{predictionNotice}</div>
      ) : null}

      <div className="prediction-desk-grid">
      <div className="watchlist-panel glass prediction-market-panel">
        <div className="section-header prediction-panel-head">
          <div className="header-left">
            <h2>Event probability tape</h2>
            <div className="asset-count">Top markets by category · refreshes every 6 hours</div>
          </div>
          <div className="prediction-panel-status">
            <div className="asset-count">
              {predictionSnapshot?.updatedAt ? `Updated ${new Date(predictionSnapshot.updatedAt).toLocaleString()}` : "—"}
            </div>
            <span className={`data-health-badge ${predictionLoading ? "loading" : predictionStale ? "hazard" : "ok"}`} title={predictionLoading ? "Refreshing prediction snapshot" : predictionStale ? "Showing previous prediction snapshot" : "Prediction snapshot is up to date"}>
              <span className={`status-icon ${predictionLoading ? "spinner" : ""}`}>{predictionLoading ? "⟳" : predictionStale ? "⚠" : "✓"}</span>
              Snapshot
            </span>
          </div>
        </div>
        <div className="category-tabs prediction-desk-tabs">
          {predictionCategories.map((category) => (
            <button
              key={category}
              type="button"
              className={activeCategory === category ? "active" : ""}
              onClick={() => setActiveCategory(category)}
            >
              {getPredictionCategoryLabel(category).toUpperCase()}
            </button>
          ))}
        </div>

        {predictionLoading && !predictionSnapshot ? (
          <div className="loading-state">Loading prediction markets...</div>
        ) : !predictionSnapshot ? (
          <div className="loading-state">Waiting for prediction markets...</div>
        ) : (
          <div className="prediction-category-card">
            <h3>{getPredictionCategoryLabel(activeCategory)}</h3>
            {selectedCategoryMarkets.length === 0 ? (
              <p className="prediction-empty">No markets available.</p>
            ) : (
              <div className="prediction-market-list">
                {selectedCategoryMarkets.map((market) => (
                  <button
                    key={market.id}
                    type="button"
                    className="prediction-market-row"
                    onClick={() => setSelectedPredictionMarket(market)}
                  >
                    <div className="prediction-market-head">
                      <div className="prediction-market-title">{market.question}</div>
                      <div className="prediction-prob-gauge">
                        {(() => {
                          const pct = toProbabilityPct(market.yesPrice);
                          const arcLen = 157;
                          const fillLen = (pct / 100) * arcLen;
                          return (
                            <>
                              <svg viewBox="0 0 120 72" className="prediction-gauge-svg" aria-hidden="true">
                                <path d="M10 60 A50 50 0 0 1 110 60" className="prediction-gauge-track" />
                                <path
                                  d="M10 60 A50 50 0 0 1 110 60"
                                  className="prediction-gauge-fill"
                                  style={{ strokeDasharray: `${fillLen} ${arcLen}` }}
                                />
                              </svg>
                              <div className="prediction-gauge-value">{formatProbability(market.yesPrice)}</div>
                              <div className="prediction-gauge-label">{market.yesLabel || "Yes"}</div>
                            </>
                          );
                        })()}
                      </div>
                    </div>
                    <div className="prediction-market-meta">
                      <span>
                        Ends {formatDateLabel(market.endDate)} · Vol {formatDollar(market.volume24h || market.volume || 0)}
                      </span>
                      <Sparkline
                        points={(function deriveHistory(m) {
                          // If the API provides priceChange24h, render an actual 5-point series
                          // (today, 6h ago, 12h ago, 18h ago, 24h ago) anchored to that delta.
                          const change = Number(m?.priceChange24h);
                          if (!Number.isFinite(change)) return [];
                          const now = Number(m?.yesPrice) || 0.5;
                          return [0, 0.25, 0.5, 0.75, 1].map((t) => now - change * t);
                        })(market)}
                        width={72}
                        height={18}
                        positive={Number(market?.priceChange24h) > 0}
                        filled
                        ariaLabel={`24h probability change ${Number(market?.priceChange24h || 0).toFixed(1)}%`}
                      />
                    </div>
                  </button>
                ))}
              </div>
            )}
            {Array.isArray(predictionMarketsByCategory?.[activeCategory]) && predictionMarketsByCategory[activeCategory].length > 5 ? (
              <div className="prediction-show-more">
                <button
                  type="button"
                  className="prediction-show-more-btn"
                  onClick={() => setShowAllCategoryMarkets((prev) => !prev)}
                  aria-expanded={showAllCategoryMarkets}
                >
                  {showAllCategoryMarkets
                    ? `Show fewer (top 5 of ${predictionMarketsByCategory[activeCategory].length})`
                    : `Show all ${predictionMarketsByCategory[activeCategory].length} markets`}
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <aside className="prediction-risk-rail">
        <div className="prediction-risk-card">
          <span>Event focus</span>
          <strong>{leadMarket?.question || "No active market"}</strong>
          <em>{leadMarket ? `Ends ${formatDateLabel(leadMarket.endDate)} · Vol ${formatDollar(leadMarket.volume24h || leadMarket.volume || 0)}` : "Waiting for market data."}</em>
        </div>
        <div className="prediction-risk-card">
          <span>Lead category</span>
          <strong>{predictionDeskStats.leadCategory ? getPredictionCategoryLabel(predictionDeskStats.leadCategory.category) : "—"}</strong>
          <em>{predictionDeskStats.leadCategory ? `${predictionDeskStats.leadCategory.count} markets · ${formatDollar(predictionDeskStats.leadCategory.volume)} volume` : "No category breadth yet."}</em>
        </div>
        <div className="prediction-risk-card">
          <span>Whale pressure</span>
          <strong>{formatSignedDollar(predictionDeskStats.whalePnl)}</strong>
          <em>{filteredPredictionWhales.length} trades above {formatDollar(whaleMinSize)}</em>
        </div>
      </aside>
      </div>

      <div className="watchlist-panel glass prediction-whale-panel">
        <div className="section-header prediction-panel-head">
          <div className="header-left">
            <h2>Flow blotter</h2>
            <div className="prediction-panel-status">
              <div className="asset-count">Large prediction-market flow · {filteredPredictionWhales.length} matches</div>
            </div>
          </div>
          <div className="prediction-filter-bar">
            <label className="asset-dropdown-container">
              <span>Category</span>
              <select
                value={whaleCategory}
                onChange={(e) => setWhaleCategory(e.target.value)}
                aria-label="Filter by category"
              >
                <option value="all">All</option>
                {predictionCategories.map((cat) => (
                  <option key={cat} value={cat}>{getPredictionCategoryLabel(cat)}</option>
                ))}
              </select>
            </label>
            <label className="asset-dropdown-container">
              <span>Min Size</span>
              <select
                value={whaleMinSize}
                onChange={(e) => setWhaleMinSize(Number(e.target.value) || 10000)}
                aria-label="Minimum whale transaction size"
              >
                {whaleThresholdOptions.map((threshold) => (
                  <option key={threshold.value} value={threshold.value}>
                    {threshold.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="asset-dropdown-container prediction-fee-toggle">
              <span>Fee&nbsp;Adj.</span>
              <button
                type="button"
                role="switch"
                aria-checked={whaleIncludeFees}
                onClick={() => setWhaleIncludeFees((prev) => !prev)}
                className={whaleIncludeFees ? "on" : ""}
                title="Deduct an estimated 2% taker fee from each whale P&L."
              >
                {whaleIncludeFees ? "On" : "Off"}
              </button>
            </label>
          </div>
        </div>

        {predictionLoading && !predictionSnapshot ? (
          <div className="loading-state">Loading whale transactions...</div>
        ) : pagedPredictionWhales.length === 0 ? (
          <div className="loading-state">Waiting for whale transactions...</div>
        ) : (
          <div className="table-scroll">
            <table className="option-chain-table whale-trades-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Market</th>
                  <th>Type</th>
                  <th>Avg Price</th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleWhaleSort("transactionSize")}>
                    Transaction Size{whaleSortArrow("transactionSize")}
                  </th>
                  <th style={{ cursor: "pointer" }} onClick={() => toggleWhaleSort("pnl")}>
                    PnL{whaleSortArrow("pnl")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {pagedPredictionWhales.map((item) => (
                  (() => {
                    const pnl = item._pnl;
                    return (
                      <tr key={item.id}>
                        <td className="greek">{getPredictionCategoryLabel(item.category)}</td>
                        <td className="greek">{item.market}</td>
                        <td className="greek">{formatWhaleType(item)}</td>
                        <td className="greek">{formatAvgPrice(item.price)}</td>
                        <td className="bid-ask positive">{formatDollar(item.transactionSize)}</td>
                        <td className={!Number.isFinite(Number(pnl)) ? "greek" : (Number(pnl) >= 0 ? "positive" : "negative")}>
                          {formatSignedDollar(pnl)}
                        </td>
                      </tr>
                    );
                  })()
                ))}
              </tbody>
            </table>
          </div>
        )}

        {predictionWhaleTotalPages > 1 && (
          <div className="pagination-controls" style={{ marginTop: "10px" }}>
            <button
              className="pagination-button"
              disabled={predictionWhalePage === 1}
              onClick={() => setPredictionWhalePage((p) => Math.max(1, p - 1))}
            >
              Previous
            </button>
            <div className="pagination-label">
              Page {predictionWhalePage} of {predictionWhaleTotalPages}
            </div>
            <button
              className="pagination-button"
              disabled={predictionWhalePage === predictionWhaleTotalPages}
              onClick={() => setPredictionWhalePage((p) => Math.min(predictionWhaleTotalPages, p + 1))}
            >
              Next
            </button>
          </div>
        )}
      </div>

      {selectedPredictionMarket && (
        <div className="prediction-modal-overlay" onClick={() => setSelectedPredictionMarket(null)}>
          <div className="prediction-modal-window" onClick={(e) => e.stopPropagation()}>
            <div className="section-header" style={{ marginBottom: "12px" }}>
              <div className="header-left">
                <h2>{selectedPredictionMarket.question}</h2>
                <div className="asset-count">Top holders and positions</div>
              </div>
              <span className={`data-health-badge ${marketDetailsLoading ? "loading" : marketDetailsStale ? "hazard" : "ok"}`} title={marketDetailsLoading ? "Refreshing market details" : marketDetailsStale ? "Showing previous market-detail snapshot" : "Market details are up to date"}>
                <span className={`status-icon ${marketDetailsLoading ? "spinner" : ""}`}>{marketDetailsLoading ? "⟳" : marketDetailsStale ? "⚠" : "✓"}</span>
                Details
              </span>
              <button className="close-btn" onClick={() => setSelectedPredictionMarket(null)}>&times;</button>
            </div>
            {marketDetailsStale && marketDetailsNotice ? (
              <div className="snapshot-inline-note" style={{ marginBottom: "12px" }}>{marketDetailsNotice}</div>
            ) : null}

            {marketDetailsLoading && !marketDetails ? (
              <div className="loading-state">Loading market details...</div>
            ) : !marketDetails ? (
              <div className="loading-state">Waiting for market details...</div>
            ) : (
              <div className="prediction-modal-body">
                {!marketDetails?.holderDataAvailable && (
                  <p className="prediction-note">{marketDetails?.holderDataNote || "Holder data unavailable."}</p>
                )}
                <p className="prediction-note">Average entry shown per row. PnL is mark-to-entry.</p>

                <div className="prediction-split-card">
                  <h4>Top Holders</h4>
                  <div className="prediction-split-grid">
                    <div className="prediction-split-pane">
                      <h5>Yes</h5>
                      {Array.isArray(marketDetails?.holders?.yes) && marketDetails.holders.yes.length > 0 ? (
                        marketDetails.holders.yes.slice(0, 5).map((row, idx) => (
                          <div key={`hy-${idx}`} className="prediction-holder-row">
                            <span>{row.label || row.holder || "Wallet"}</span>
                            <span>{formatDollar(row.sizeUsd || 0)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="prediction-empty">No public holder data.</div>
                      )}
                    </div>

                    <div className="prediction-split-pane">
                      <h5>No</h5>
                      {Array.isArray(marketDetails?.holders?.no) && marketDetails.holders.no.length > 0 ? (
                        marketDetails.holders.no.slice(0, 5).map((row, idx) => (
                          <div key={`hn-${idx}`} className="prediction-holder-row">
                            <span>{row.label || row.holder || "Wallet"}</span>
                            <span>{formatDollar(row.sizeUsd || 0)}</span>
                          </div>
                        ))
                      ) : (
                        <div className="prediction-empty">No public holder data.</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="prediction-split-card">
                  <h4>Positions</h4>
                  <div className="prediction-split-grid">
                    <div className="prediction-split-pane">
                      <h5>Yes</h5>
                      {Array.isArray(marketDetails?.positions?.yes) && marketDetails.positions.yes.length > 0 ? (
                        marketDetails.positions.yes.slice(0, 5).map((row) => (
                          <div key={row.id} className="prediction-position-row">
                            <div>
                              <div>{row.label}</div>
                              <small>Avg Entry: {Number(row.avgEntry || 0).toFixed(3)}</small>
                            </div>
                            <div>
                              <div>{formatDollar(row.sizeUsd || 0)}</div>
                              <small className={Number(row.pnlPct) >= 0 ? "positive" : "negative"}>
                                {formatPercent(row.pnlPct || 0)}
                              </small>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="prediction-empty">No position data.</div>
                      )}
                    </div>

                    <div className="prediction-split-pane">
                      <h5>No</h5>
                      {Array.isArray(marketDetails?.positions?.no) && marketDetails.positions.no.length > 0 ? (
                        marketDetails.positions.no.slice(0, 5).map((row) => (
                          <div key={row.id} className="prediction-position-row">
                            <div>
                              <div>{row.label}</div>
                              <small>Avg Entry: {Number(row.avgEntry || 0).toFixed(3)}</small>
                            </div>
                            <div>
                              <div>{formatDollar(row.sizeUsd || 0)}</div>
                              <small className={Number(row.pnlPct) >= 0 ? "positive" : "negative"}>
                                {formatPercent(row.pnlPct || 0)}
                              </small>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="prediction-empty">No position data.</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
