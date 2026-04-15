import { useEffect, useMemo, useState } from "react";

const RAW_BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const BACKEND_URL = RAW_BACKEND_URL.replace(/\/+$/, "");
const PREDICTION_REFRESH_MS = 21600000; // 6 hours

export function PredictionMarketModule() {
  const [predictionSnapshot, setPredictionSnapshot] = useState(null);
  const [predictionLoading, setPredictionLoading] = useState(false);
  const [predictionError, setPredictionError] = useState("");
  const [predictionWhalePage, setPredictionWhalePage] = useState(1);
  const [selectedPredictionMarket, setSelectedPredictionMarket] = useState(null);
  const [marketDetails, setMarketDetails] = useState(null);
  const [marketDetailsLoading, setMarketDetailsLoading] = useState(false);
  const [marketDetailsError, setMarketDetailsError] = useState("");
  const [activeCategory, setActiveCategory] = useState("geopolitics");

  useEffect(() => {
    let isMounted = true;

    const fetchPredictionSnapshot = async () => {
      if (!isMounted) return;
      setPredictionLoading(true);
      setPredictionError("");
      try {
        const res = await fetch(`${BACKEND_URL}/prediction/snapshot`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (!isMounted) return;
        setPredictionSnapshot(data || null);
        setPredictionWhalePage(1);
      } catch {
        if (!isMounted) return;
        setPredictionError("Unable to load prediction markets.");
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
      setMarketDetailsError("");
      return () => {
        isMounted = false;
      };
    }

    const fetchDetails = async () => {
      if (!isMounted) return;
      setMarketDetailsLoading(true);
      setMarketDetailsError("");
      try {
        const res = await fetch(`${BACKEND_URL}/prediction/market-details/${encodeURIComponent(selectedPredictionMarket.id)}`);
        if (!res.ok) {
          const text = await res.text();
          throw new Error(`HTTP ${res.status}: ${text}`);
        }
        const data = await res.json();
        if (!isMounted) return;
        setMarketDetails(data || null);
      } catch {
        if (!isMounted) return;
        setMarketDetailsError("Unable to load market holder and position details.");
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

  const predictionWhalePageSize = 10;
  const predictionWhaleTotalPages = Math.max(1, Math.ceil(predictionWhaleTransactions.length / predictionWhalePageSize));
  const pagedPredictionWhales = predictionWhaleTransactions.slice(
    (predictionWhalePage - 1) * predictionWhalePageSize,
    predictionWhalePage * predictionWhalePageSize
  );

  useEffect(() => {
    if (predictionWhalePage > predictionWhaleTotalPages) {
      setPredictionWhalePage(predictionWhaleTotalPages);
    }
  }, [predictionWhalePage, predictionWhaleTotalPages]);

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

  const computeWhalePnl = (item) => {
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

    const side = String(item?.side || "").toUpperCase();
    const direction = side === "SELL" ? -1 : 1;
    return (markPrice - entryPrice) * shares * direction;
  };

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
    ? predictionMarketsByCategory[activeCategory].slice(0, 5)
    : [];

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

  return (
    <div className="view-container prediction-terminal">
      <div className="watchlist-panel glass prediction-market-panel" style={{ padding: "16px" }}>
        <div className="section-header" style={{ marginBottom: "10px" }}>
          <div className="header-left">
            <h2>Prediction Markets</h2>
            <div className="asset-count">Top 5 markets per category · refreshes every 6 hours</div>
          </div>
          <div className="asset-count">
            {predictionSnapshot?.updatedAt ? `Updated ${new Date(predictionSnapshot.updatedAt).toLocaleString()}` : "—"}
          </div>
        </div>
        <div className="category-tabs" style={{ marginBottom: "12px" }}>
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

        {predictionLoading ? (
          <div className="loading-state">Loading prediction markets...</div>
        ) : predictionError ? (
          <div className="loading-state">{predictionError}</div>
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
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="watchlist-panel glass prediction-whale-panel" style={{ padding: "16px" }}>
        <div className="section-header" style={{ marginBottom: "10px" }}>
          <div className="header-left">
            <h2>Whale Transactions</h2>
            <div className="asset-count">Large prediction-market flow above $10K</div>
          </div>
        </div>

        {predictionLoading ? (
          <div className="loading-state">Loading whale transactions...</div>
        ) : predictionError ? (
          <div className="loading-state">{predictionError}</div>
        ) : pagedPredictionWhales.length === 0 ? (
          <div className="loading-state">No whale transactions available.</div>
        ) : (
          <div className="table-scroll">
            <table className="option-chain-table whale-trades-table">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Market</th>
                  <th>Type</th>
                  <th>Avg Price</th>
                  <th>Transaction Size</th>
                  <th>PnL</th>
                </tr>
              </thead>
              <tbody>
                {pagedPredictionWhales.map((item) => (
                  (() => {
                    const pnl = computeWhalePnl(item);
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
              <button className="close-btn" onClick={() => setSelectedPredictionMarket(null)}>&times;</button>
            </div>

            {marketDetailsLoading ? (
              <div className="loading-state">Loading market details...</div>
            ) : marketDetailsError ? (
              <div className="loading-state">{marketDetailsError}</div>
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
