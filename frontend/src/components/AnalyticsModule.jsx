// src/components/AnalyticsModule.jsx
import { useEffect, useMemo, useState } from "react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

const CATEGORY_TABS = [
  { id: "crypto", label: "Crypto", description: "Hyperliquid, Bybit, Binance + Dune analytics" },
  { id: "options", label: "Options", description: "Binance + Deribit options data" },
  { id: "equities", label: "Equities", description: "Asset Classes, Industries, Regions" },
];

const EMPTY_CRYPTO = {
  updatedAt: null,
  perpMetrics: [],
  kimchiPremium: null,
  etfInflows: [],
  perpVolumeByProtocol: [],
  revenueByProtocol: [],
  optionsVolumeByAsset: [],
  optionsMaxPain: [],
  perpsMarketShare: [],
  perpsOverview: [],
};

const EMPTY_OPTIONS = {
  updatedAt: null,
  totalOptionsOpenInterestUsd: null,
  optionsVolumeByAsset: [],
  optionsMaxPain: [],
  volumeByExchangeRoute: [],
  greeks: [],
  oiByStrike: [],
};

const EMPTY_EQUITIES = {
  updatedAt: null,
  benchmarkPerformance: [],
  annualReturns: [],
  reitData: { benchmarks: [] },
  mmfYields: [],
  fundsList: [],
};

function formatMoney(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `$${amount.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

function formatCompactMoney(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: digits,
  }).format(amount);
}

function formatPercent(value, digits = 2) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(digits)}%`;
}

function formatDateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function normalizeCryptoPayload(payload) {
  return {
    updatedAt: payload?.updatedAt || payload?.asOf || null,
    perpMetrics: Array.isArray(payload?.perpMetrics)
      ? payload.perpMetrics
      : Array.isArray(payload?.oiAndFunding)
      ? payload.oiAndFunding
      : [],
    kimchiPremium: payload?.kimchiPremium || null,
    etfInflows: Array.isArray(payload?.etfInflows) ? payload.etfInflows : [],
    perpVolumeByProtocol: Array.isArray(payload?.perpVolumeByProtocol)
      ? payload.perpVolumeByProtocol
      : [],
    revenueByProtocol: Array.isArray(payload?.revenueByProtocol)
      ? payload.revenueByProtocol
      : Array.isArray(payload?.revenuePerProtocol)
      ? payload.revenuePerProtocol
      : [],
    optionsVolumeByAsset: Array.isArray(payload?.optionsVolumeByAsset)
      ? payload.optionsVolumeByAsset
      : Array.isArray(payload?.optionsVolume)
      ? payload.optionsVolume
      : [],
    optionsMaxPain: Array.isArray(payload?.optionsMaxPain)
      ? payload.optionsMaxPain
      : [],
    perpsMarketShare: Array.isArray(payload?.perpsMarketShare) ? payload.perpsMarketShare : [],
    perpsOverview: Array.isArray(payload?.perpsOverview) ? payload.perpsOverview : [],
  };
}

function normalizeOptionsPayload(payload) {
  return {
    updatedAt: payload?.updatedAt || payload?.asOf || null,
    totalOptionsOpenInterestUsd:
      payload?.totalOptionsOpenInterestUsd ?? payload?.totalOptionsOI ?? null,
    optionsVolumeByAsset: Array.isArray(payload?.optionsVolumeByAsset)
      ? payload.optionsVolumeByAsset
      : Array.isArray(payload?.optionsVolume)
      ? payload.optionsVolume
      : [],
    optionsMaxPain: Array.isArray(payload?.optionsMaxPain)
      ? payload.optionsMaxPain
      : [],
    volumeByExchangeRoute: Array.isArray(payload?.volumeByExchangeRoute)
      ? payload.volumeByExchangeRoute
      : Array.isArray(payload?.optionsVolumeByExchangeRoute)
      ? payload.optionsVolumeByExchangeRoute
      : [],
    greeks: Array.isArray(payload?.greeks) ? payload.greeks : [],
    oiByStrike: Array.isArray(payload?.oiByStrike) ? payload.oiByStrike : [],
  };
}

function normalizeEquitiesPayload(payload) {
  return {
    updatedAt: payload?.updatedAt || null,
    benchmarkPerformance: Array.isArray(payload?.benchmarkPerformance) ? payload.benchmarkPerformance : [],
    annualReturns: Array.isArray(payload?.annualReturns) ? payload.annualReturns : [],
    reitData: payload?.reitData || { benchmarks: [] },
    mmfYields: Array.isArray(payload?.mmfYields) ? payload.mmfYields : [],
    fundsList: Array.isArray(payload?.fundsList) ? payload.fundsList : [],
  };
}

function AnalyticsStatCard({ title, value, subvalue, source, tone = "neutral" }) {
  const toneMap = {
    neutral: { border: "rgba(148,163,184,0.18)", color: "#e2e8f0" },
    positive: { border: "rgba(34,197,94,0.28)", color: "#86efac" },
    negative: { border: "rgba(239,68,68,0.28)", color: "#fca5a5" },
    info: { border: "rgba(56,189,248,0.24)", color: "#7dd3fc" },
  };
  const chosen = toneMap[tone] || toneMap.neutral;

  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        border: `1px solid ${chosen.border}`,
        borderRadius: 14,
        padding: 16,
        minHeight: 110,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#94a3b8",
            }}
          >
            {title}
          </div>
          <div
            style={{
              marginTop: 10,
              fontSize: 24,
              fontWeight: 700,
              color: chosen.color,
            }}
          >
            {value}
          </div>
          {subvalue ? (
            <div style={{ marginTop: 6, fontSize: 12, color: "#cbd5e1" }}>
              {subvalue}
            </div>
          ) : null}
        </div>
        {source ? (
          <div>
            <span
              style={{
                padding: "4px 8px",
                borderRadius: 999,
                border: "1px solid rgba(148,163,184,0.18)",
                fontSize: 10,
                color: "#94a3b8",
                whiteSpace: "nowrap",
              }}
            >
              {source}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function AnalyticsTableCard({ title, subtitle, columns, rows = [], emptyText }) {
  return (
    <div
      style={{
        background: "rgba(0, 0, 0, 0.85)",
        backdropFilter: "blur(12px)",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 14,
        padding: 16,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          gap: 12,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>
            {title}
          </div>
          {subtitle ? (
            <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>
              {subtitle}
            </div>
          ) : null}
        </div>
      </div>

      {(rows || []).length === 0 ? (
        <div style={{ padding: "18px 6px 6px", fontSize: 13, color: "#94a3b8" }}>
          {emptyText}
        </div>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              minWidth: 420,
            }}
          >
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column.key}
                    style={{
                      textAlign: column.align || "left",
                      padding: "0 0 10px",
                      fontSize: 11,
                      color: "#64748b",
                      fontWeight: 600,
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(148,163,184,0.14)",
                    }}
                  >
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows || []).map((row, idx) => (
                <tr key={row.id || `${title}-${idx}`}>
                  {columns.map((column) => {
                    const cellValue = row[column.key];
                    return (
                      <td
                        key={column.key}
                        style={{
                          padding: "12px 0",
                          fontSize: 13,
                          color: "#e2e8f0",
                          textAlign: column.align || "left",
                          borderBottom:
                            idx === (rows || []).length - 1
                              ? "none"
                              : "1px solid rgba(148,163,184,0.08)",
                        }}
                      >
                        {column.render
                          ? column.render(cellValue, row)
                          : typeof cellValue === 'object' && cellValue !== null
                            ? JSON.stringify(cellValue)
                            : cellValue ?? "—"}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function AnalyticsModule({ backendUrl }) {
  const [activeTab, setActiveTab] = useState("crypto");
  const [cryptoData, setCryptoData] = useState(EMPTY_CRYPTO);
  const [optionsData, setOptionsData] = useState(EMPTY_OPTIONS);
  const [equitiesData, setEquitiesData] = useState(EMPTY_EQUITIES);
  const [loading, setLoading] = useState({ crypto: false, options: false, equities: false });
  const [errors, setErrors] = useState({ crypto: "", options: "", equities: "" });
  
  const [etfAssetToggle, setEtfAssetToggle] = useState("All");
  const [etfPeriodToggle, setEtfPeriodToggle] = useState("daily");
  const [selectedPerpExchange, setSelectedPerpExchange] = useState("Hyperliquid");

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      setLoading((prev) => ({ ...prev, [activeTab]: true }));
      setErrors((prev) => ({ ...prev, [activeTab]: "" }));

      try {
        const res = await fetch(`${backendUrl}/analytics/${activeTab}`, {
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const payload = await res.json();
        if (cancelled) return;

        if (activeTab === "crypto") {
          setCryptoData(normalizeCryptoPayload(payload));
        } else if (activeTab === "options") {
          setOptionsData(normalizeOptionsPayload(payload));
        } else if (activeTab === "equities") {
          setEquitiesData(normalizeEquitiesPayload(payload));
        }
      } catch (err) {
        if (cancelled || err?.name === "AbortError") return;
        setErrors((prev) => ({
          ...prev,
          [activeTab]:
            "Analytics endpoint is not returning data yet. Wire the backend route and refresh.",
        }));
      } finally {
        if (!cancelled) {
          setLoading((prev) => ({ ...prev, [activeTab]: false }));
        }
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [activeTab, backendUrl]);

  const cryptoPerps = useMemo(() => {
    const preferredOrder = ["BTC", "ETH", "SOL", "HYPE", "BNB"];
    const currentMetrics = (cryptoData.perpMetrics || []).filter(
      (m) => m.exchange === selectedPerpExchange
    );
    const bySymbol = new Map(
      currentMetrics.map((row) => [
        String(row.symbol || "").toUpperCase(),
        row,
      ])
    );
    return preferredOrder
      .map((symbol) => {
        const row = bySymbol.get(symbol);
        if (!row) return null;
        return {
          id: `${selectedPerpExchange}-${symbol}`,
          symbol,
          openInterestUsd:
            row?.openInterestUsd ?? row?.oiUsd ?? row?.openInterest ?? null,
          fundingRate: row?.fundingRate ?? row?.funding ?? null,
          exchange: row?.exchange || selectedPerpExchange,
        };
      })
      .filter((row) => row !== null);
  }, [cryptoData, selectedPerpExchange]);

  const cryptoTotalOi = useMemo(
    () =>
      cryptoPerps.reduce(
        (sum, row) => sum + (Number(row.openInterestUsd) || 0),
        0
      ),
    [cryptoPerps]
  );

  const optionsTotalVolume = useMemo(
    () =>
      (optionsData.optionsVolumeByAsset || []).reduce(
        (sum, row) => sum + (Number(row.volumeUsd ?? row.volume) || 0),
        0
      ),
    [optionsData]
  );

  const currentUpdatedAt =
    activeTab === "crypto"
      ? cryptoData.updatedAt
      : activeTab === "options"
      ? optionsData.updatedAt
      : equitiesData.updatedAt;
  const currentError = errors[activeTab];
  const currentLoading = loading[activeTab];

  return (
    <div className="view-container" style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Header */}
      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 12,
              letterSpacing: "0.09em",
              textTransform: "uppercase",
              color: "#64748b",
            }}
          >
            Analytics
          </div>
          <h2
            style={{
              margin: "6px 0 0",
              fontSize: 24,
              fontWeight: 700,
              color: "#f8fafc",
            }}
          >
            Cross-market dashboards
          </h2>
          <p
            style={{
              margin: "8px 0 0",
              maxWidth: 760,
              fontSize: 13,
              lineHeight: 1.55,
              color: "#94a3b8",
            }}
          >
            Switch between Crypto and Options analytics. The module is structured
            for Hyperliquid + Dune on crypto and Binance + Derive + Deribit on options.
          </p>
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", paddingTop: 6 }}>
          Last update: {formatDateTime(currentUpdatedAt)}
        </div>
      </section>

      {/* Tabs */}
      <section>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {CATEGORY_TABS.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                style={{
                  borderRadius: 999,
                  border: active
                    ? "1px solid rgba(56,189,248,0.38)"
                    : "1px solid rgba(148,163,184,0.16)",
                  background: active
                    ? "rgba(56,189,248,0.12)"
                    : "rgba(15,23,42,0.78)",
                  color: active ? "#7dd3fc" : "#cbd5e1",
                  padding: "12px 16px",
                  cursor: "pointer",
                  textAlign: "left",
                  minWidth: 220,
                }}
              >
                <div style={{ fontSize: 14, fontWeight: 600 }}>{tab.label}</div>
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 12,
                    color: active ? "#bae6fd" : "#94a3b8",
                  }}
                >
                  {tab.description}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Loading / error */}
      {currentLoading && (
        <div
          style={{
            padding: 18,
            borderRadius: 14,
            background: "rgba(15,23,42,0.72)",
            border: "1px solid rgba(148,163,184,0.16)",
            color: "#cbd5e1",
          }}
        >
          Loading {activeTab} analytics...
        </div>
      )}

      {currentError && !currentLoading && (
        <div
          style={{
            padding: 18,
            borderRadius: 14,
            background: "rgba(15,23,42,0.72)",
            border: "1px solid rgba(245,158,11,0.22)",
            color: "#fbbf24",
          }}
        >
          {currentError}
        </div>
      )}

      {/* Content */}
      {!currentLoading && !currentError && (
        <>
          {activeTab === "crypto" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsStatCard
                  title="Tracked OI"
                  value={formatCompactMoney(cryptoTotalOi)}
                  subvalue={`${selectedPerpExchange} open interest for tracked assets`}
                  source={selectedPerpExchange === "Hyperliquid" ? "HL" : selectedPerpExchange}
                  tone="info"
                />
                <AnalyticsStatCard
                  title="Kimchi Premium"
                  value={formatPercent(
                    cryptoData.kimchiPremium?.valuePct ??
                      cryptoData.kimchiPremium?.value
                  )}
                  subvalue={cryptoData.kimchiPremium?.market || "KR vs global spread"}
                  source="Dune"
                  tone={
                    (cryptoData.kimchiPremium?.valuePct ??
                      cryptoData.kimchiPremium?.value ??
                      0) >= 0
                      ? "positive"
                      : "negative"
                  }
                />
                <AnalyticsStatCard
                  title="ETF Inflows"
                  value={formatCompactMoney(
                    (cryptoData.etfInflows || []).reduce(
                      (sum, row) =>
                        sum +
                        (Number(row.netUsd ?? row.netFlowUsd ?? 0) || 0),
                      0
                    )
                  )}
                  subvalue="Summed from latest ETF inflow rows"
                  source="Dune"
                  tone="positive"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    background: "rgba(15,23,42,0.6)",
                    padding: "10px 16px",
                    borderRadius: 12,
                    border: "1px solid rgba(148,163,184,0.12)"
                  }}>
                    <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500 }}>Exchange Venue</span>
                    <div style={{ display: "flex", gap: 4 }}>
                      {["Hyperliquid", "Binance", "Bybit"].map((ex) => (
                        <button
                          key={ex}
                          onClick={() => setSelectedPerpExchange(ex)}
                          style={{
                            padding: "6px 12px",
                            fontSize: 12,
                            borderRadius: 8,
                            cursor: "pointer",
                            background: selectedPerpExchange === ex ? "rgba(56,189,248,0.2)" : "transparent",
                            border: `1px solid ${selectedPerpExchange === ex ? "#38bdf8" : "rgba(255,255,255,0.08)"}`,
                            color: selectedPerpExchange === ex ? "#38bdf8" : "#94a3b8",
                            transition: "all 0.2s ease"
                          }}
                        >
                          {ex}
                        </button>
                      ))}
                    </div>
                  </div>

                  <AnalyticsTableCard
                    title="Perpetual OI & funding"
                    subtitle={`${selectedPerpExchange} perp markets for key assets`}
                    emptyText={`No ${selectedPerpExchange} perp context rows returned yet.`}
                  columns={[
                    { key: "symbol", label: "Asset" },
                    {
                      key: "openInterestUsd",
                      label: "Open Interest",
                      align: "right",
                      render: (v) => formatMoney(v),
                    },
                    {
                      key: "fundingRate",
                      label: "Funding Rate",
                      align: "right",
                      render: (v) => formatPercent(Number(v) * 100),
                    },
                    { key: "exchange", label: "Venue", align: "right" },
                  ]}
                  rows={cryptoPerps}
                />
              </div>

                <div style={{
                  background: "rgba(0, 0, 0, 0.85)",
                  backdropFilter: "blur(12px)",
                  border: "1px solid rgba(148, 163, 184, 0.16)",
                  borderRadius: 14,
                  padding: 16,
                  display: "flex", flexDirection: "column",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: "#f8fafc" }}>ETF Inflows</div>
                      <div style={{ marginTop: 4, fontSize: 12, color: "#94a3b8" }}>Asset flows by manager</div>
                    </div>
                    <div style={{ display: "flex", gap: 8 }}>
                      <select style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 6, padding: "4px 8px", fontSize: 12 }} value={etfAssetToggle} onChange={(e) => setEtfAssetToggle(e.target.value)}>
                        <option value="All">All Assets</option>
                        <option value="BTC">BTC</option>
                        <option value="ETH">ETH</option>
                        <option value="SOL">SOL</option>
                      </select>
                      <select style={{ background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.2)", borderRadius: 6, padding: "4px 8px", fontSize: 12 }} value={etfPeriodToggle} onChange={(e) => setEtfPeriodToggle(e.target.value)}>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="quarterly">Quarterly</option>
                      </select>
                    </div>
                  </div>
                  <AnalyticsTableCard
                    title=""
                    subtitle=""
                    emptyText="No ETF inflow rows returned yet."
                    columns={[
                      { key: "manager", label: "Manager" },
                      { key: "ticker", label: "Ticker" },
                      { key: "asset", label: "Asset" },
                      {
                        key: "netUsd",
                        label: "Net Flow",
                        align: "right",
                        render: (v) => formatMoney(v),
                      },
                    ]}
                    rows={(cryptoData.etfInflows || [])
                      .filter(r => (etfAssetToggle === "All" || r.asset === etfAssetToggle) && r.period === etfPeriodToggle)
                      .map((row, idx) => ({
                        id: row.id || `etf-${idx}`,
                        manager: row.manager,
                        ticker: row.ticker,
                        asset: row.asset,
                        netUsd: row.netUsd,
                      }))}
                  />
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
                  gap: 14,
                  marginBottom: 14,
                }}
              >
                <AnalyticsTableCard
                  title="Perps Overview"
                  subtitle="Top 24h Volume and Open Interest rankings"
                  emptyText="No perp overview rows available."
                  columns={[
                    { key: "protocol", label: "Protocol" },
                    {
                      key: "volume24h",
                      label: "24h Vol",
                      align: "right",
                      render: (v) => formatCompactMoney(v),
                    },
                    {
                      key: "openInterest",
                      label: "Open Interest",
                      align: "right",
                      render: (v) => formatCompactMoney(v),
                    },
                  ]}
                  rows={(cryptoData.perpsOverview || []).map((row, idx) => ({
                    id: `perp-ov-${idx}`,
                    ...row,
                  }))}
                />

                <div
                  style={{
                    background: "rgba(0, 0, 0, 0.85)",
                    backdropFilter: "blur(12px)",
                    borderRadius: 12,
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    padding: 20,
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.4)"
                  }}
                >
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ color: "#fff", fontSize: 16, fontWeight: 600 }}>
                      Open Interest Market Share
                    </div>
                    <div style={{ color: "rgba(255, 255, 255, 0.5)", fontSize: 12 }}>
                      Distribution of total OI across major protocols
                    </div>
                  </div>
                  <div style={{ flex: 1, minHeight: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={cryptoData.perpsMarketShare}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={100}
                          paddingAngle={5}
                          dataKey="sharePct"
                          nameKey="protocol"
                          stroke="none"
                        >
                          {cryptoData.perpsMarketShare.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            background: "rgba(10, 15, 30, 0.95)",
                            border: "1px solid rgba(255, 255, 255, 0.1)",
                            borderRadius: 8,
                            boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                          }}
                          itemStyle={{ color: "#fff" }}
                          formatter={(value) => [`${value}%`, "Market Share"]}
                        />
                        <Legend
                          verticalAlign="bottom"
                          height={36}
                          wrapperStyle={{ paddingTop: 20 }}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsTableCard
                  title="Perp volume by protocol"
                  subtitle="Dune aggregation for perp protocols"
                  emptyText="No perp volume rows returned yet."
                  columns={[
                    { key: "protocol", label: "Protocol" },
                    {
                      key: "volumeUsd",
                      label: "Volume",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.volume ?? null),
                    },
                  ]}
                  rows={(cryptoData.perpVolumeByProtocol || []).map(
                    (row, idx) => ({
                      id: row.id || `perp-vol-${idx}`,
                      protocol: row.protocol,
                      volumeUsd: row.volumeUsd ?? row.volume,
                    })
                  )}
                />

                <AnalyticsTableCard
                  title="Revenue per protocol"
                  subtitle="Protocol revenue sourced from Dune"
                  emptyText="No revenue rows returned yet."
                  columns={[
                    { key: "protocol", label: "Protocol" },
                    {
                      key: "revenueUsd",
                      label: "Revenue",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.revenue ?? null),
                    },
                  ]}
                  rows={(cryptoData.revenueByProtocol || []).map(
                    (row, idx) => ({
                      id: row.id || `rev-${idx}`,
                      protocol: row.protocol,
                      revenueUsd: row.revenueUsd ?? row.revenue,
                    })
                  )}
                />
              </div>
            </>
          ) : activeTab === "options" ? (
            <>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsStatCard
                  title="Total Options OI"
                  value={formatCompactMoney(
                    optionsData.totalOptionsOpenInterestUsd
                  )}
                  subvalue="Aggregated from Binance, Derive and Deribit"
                  source="Multi-venue"
                  tone="info"
                />
                <AnalyticsStatCard
                  title="Tracked Options Volume"
                  value={formatCompactMoney(optionsTotalVolume)}
                  subvalue="Volume per available asset"
                  source="Binance + Derive + Deribit"
                  tone="positive"
                />
                <AnalyticsStatCard
                  title="Venue Count"
                  value={String(
                    new Set(
                      (optionsData.volumeByExchangeRoute || [])
                        .map((row) => row.exchange)
                        .filter(Boolean)
                    ).size || 0
                  )}
                  subvalue="Distinct exchange routes in the payload"
                  source="Routes"
                  tone="neutral"
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                  gap: 14,
                }}
              >
                <AnalyticsTableCard
                  title="Options volume per asset"
                  subtitle="By asset, with exchange route where available"
                  emptyText="No options volume rows returned yet."
                  columns={[
                    { key: "asset", label: "Asset" },
                    { key: "exchange", label: "Exchange" },
                    { key: "route", label: "Route" },
                    {
                      key: "volumeUsd",
                      label: "Volume",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.volume ?? null),
                    },
                  ]}
                  rows={(optionsData.optionsVolumeByAsset || []).map(
                    (row, idx) => ({
                      id: row.id || `opt-asset-${idx}`,
                      asset: row.asset,
                      exchange: row.exchange,
                      route: row.route,
                      volumeUsd: row.volumeUsd ?? row.volume,
                    })
                  )}
                />

                <AnalyticsTableCard
                  title="Options max pain"
                  subtitle="By exchange, asset and expiry"
                  emptyText="No options max pain rows returned yet."
                  columns={[
                    { key: "exchange", label: "Exchange" },
                    { key: "asset", label: "Asset" },
                    { key: "expiry", label: "Expiry" },
                    {
                      key: "maxPain",
                      label: "Max Pain",
                      align: "right",
                      render: (v) => formatMoney(v, 0),
                    },
                  ]}
                  rows={(optionsData.optionsMaxPain || []).map((row, idx) => ({
                    id: row.id || `opt-maxpain-${idx}`,
                    exchange: row.exchange,
                    asset: row.asset,
                    expiry: row.expiry,
                    maxPain: row.maxPain,
                  }))}
                />

                <AnalyticsTableCard
                  title="Options volume by exchange route"
                  subtitle="Aggregated route table requested for Binance, Derive and Deribit"
                  emptyText="No exchange-route rows returned yet."
                  columns={[
                    { key: "exchange", label: "Exchange" },
                    { key: "route", label: "Route" },
                    { key: "asset", label: "Asset" },
                    {
                      key: "volumeUsd",
                      label: "Volume",
                      align: "right",
                      render: (v, row) =>
                        formatMoney(v ?? row.volume ?? null),
                    },
                  ]}
                  rows={(optionsData.volumeByExchangeRoute || []).map(
                    (row, idx) => ({
                      id: row.id || `opt-route-${idx}`,
                      exchange: row.exchange,
                      route: row.route,
                      asset: row.asset,
                      volumeUsd: row.volumeUsd ?? row.volume,
                    })
                  )}
                />

                <AnalyticsTableCard
                  title="Options Greeks"
                  subtitle="Latest Greeks from Deribit"
                  emptyText="No Greeks returned yet."
                  columns={[
                    { key: "instrument", label: "Instrument" },
                    { key: "delta", label: "Delta", align: "right", render: v => v?.toFixed(2) },
                    { key: "gamma", label: "Gamma", align: "right", render: v => v?.toFixed(2) },
                    { key: "vega", label: "Vega", align: "right", render: v => v?.toFixed(2) },
                    { key: "theta", label: "Theta", align: "right", render: v => v?.toFixed(2) },
                    { key: "iv", label: "IV", align: "right", render: v => formatPercent(v) },
                  ]}
                  rows={(optionsData.greeks || []).map((r, i) => ({ id: `grk-${i}`, ...r }))}
                />

                <AnalyticsTableCard
                  title="Options OI by Strike & Expiry"
                  subtitle="Latest options open interest"
                  emptyText="No OI rows returned yet."
                  columns={[
                    { key: "asset", label: "Asset" },
                    { key: "strike", label: "Strike", align: "right", render: v => formatMoney(v, 0) },
                    { key: "expiry", label: "Expiry", align: "right" },
                    { key: "type", label: "Type", align: "center" },
                    { key: "oi", label: "OI", align: "right", render: v => formatMoney(v, 0) },
                    { key: "exchange", label: "Exchange", align: "right" },
                  ]}
                  rows={(optionsData.oiByStrike || []).map((r, i) => ({ id: `oi-${i}`, ...r }))}
                />
              </div>
            </>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 20 }}>
                {/* Benchmark Performance Summary */}
                <AnalyticsTableCard
                  title="Benchmark Performance (CAGR)"
                  subtitle="Periodic returns for major equity and REIT indices"
                  emptyText="No benchmark performance data."
                  columns={[
                    { key: "name", label: "Index Name" },
                    { key: "yr1", label: "1Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr3", label: "3Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr5", label: "5Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr10", label: "10Y", align: "right", render: v => formatPercent(v) },
                    { key: "yr20", label: "20Y", align: "right", render: v => formatPercent(v) },
                  ]}
                  rows={equitiesData.benchmarkPerformance}
                />

                {/* Annual Returns Series */}
                <AnalyticsTableCard
                  title="Historical Annual Total Returns"
                  subtitle="20-year annual series (USD Total Return)"
                  emptyText="No historical returns data."
                  columns={[
                    { key: "year", label: "Year" },
                    { key: "sp500", label: "S&P 500", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                    { key: "msciWorld", label: "MSCI World", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                    { key: "msciEm", label: "MSCI EM", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                    { key: "reits", label: "REITs (Global)", align: "right", render: v => <span style={{ color: v >= 0 ? "#86efac" : "#fca5a5" }}>{formatPercent(v)}</span> },
                  ]}
                  rows={equitiesData.annualReturns}
                />

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(350px, 1fr))", gap: 20 }}>
                  {/* REIT Detailed Data */}
                  <AnalyticsTableCard
                    title={`REIT Benchmarks (${equitiesData.reitData?.provider || ""})`}
                    subtitle="FTSE EPRA/Nareit Regional & Country indices"
                    emptyText="No REIT benchmark data."
                    columns={[
                      { key: "name", label: "Region / Country" },
                      { key: "yr1", label: "1Y", align: "right", render: v => formatPercent(v) },
                      { key: "yr3", label: "3Y", align: "right", render: v => formatPercent(v) },
                      { key: "yr5", label: "5Y", align: "right", render: v => formatPercent(v) },
                    ]}
                    rows={equitiesData.reitData?.benchmarks || []}
                  />

                  {/* MMF Table */}
                  <AnalyticsTableCard
                    title="Money Market Fund (MMF) Yields"
                    subtitle="Yield ranges for local currency markets"
                    emptyText="No MMF yield data."
                    columns={[
                      { key: "country", label: "Jurisdiction" },
                      { key: "currency", label: "Currency" },
                      { key: "yieldRange", label: "Yield Range", align: "right" },
                      { key: "note", label: "Notes", align: "right" },
                    ]}
                    rows={equitiesData.mmfYields}
                  />
                </div>

                {/* Funds List */}
                <AnalyticsTableCard
                  title="Institutional Fund Directory"
                  subtitle="Representative funds for selected providers and jurisdictions"
                  emptyText="No funds directory data."
                  columns={[
                    { key: "provider", label: "Provider" },
                    { key: "name", label: "Fund Name" },
                    { key: "jurisdiction", label: "Jurisdiction" },
                    { key: "type", label: "Type" },
                    { key: "aum", label: "AUM", align: "right" },
                  ]}
                  rows={equitiesData.fundsList}
                />
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
