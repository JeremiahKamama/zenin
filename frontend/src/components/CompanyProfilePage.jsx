import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const COMPANY_PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

function isFresh(cacheEntry, ttlMs) {
  if (!cacheEntry?.updatedAt) return false;
  const ts = new Date(cacheEntry.updatedAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts < ttlMs;
}

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Not available";
  const abs = Math.abs(numeric);
  if (abs >= 1e12) return `$${(numeric / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(numeric / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(numeric / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(numeric / 1e3).toFixed(2)}K`;
  return `$${numeric.toFixed(2)}`;
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Not available";
  return `${(numeric * 100).toFixed(1)}%`;
}

function formatNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "Not available";
  return new Intl.NumberFormat("en-US").format(numeric);
}

function formatDate(value) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(date);
}

function formatLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function buildOverviewSections(profile, displayMeta) {
  const leadership = Array.isArray(profile?.leadership) ? profile.leadership.filter((person) => person?.name) : [];
  const peers = Array.isArray(profile?.peers) ? profile.peers : [];
  const earningsHistory = Array.isArray(profile?.earningsHistory) ? profile.earningsHistory : [];
  const manufacturing = profile?.manufacturing || {};
  const location = [profile?.city, profile?.state, profile?.country].filter(Boolean).join(", ");

  return {
    base: [
      {
        key: "overview",
        title: "Company overview",
        meta: "Foundation layer",
        items: [
          {
            title: "Business description & history",
            badge: "Context",
            description: profile?.summary || "Public business summary is not available yet for this stock.",
            bullets: [
              profile?.sector ? `Sector: ${profile.sector}` : null,
              profile?.industry ? `Industry: ${profile.industry}` : null,
              displayMeta?.theme ? `Tracked theme: ${displayMeta.theme}` : null,
              displayMeta?.category ? `Tracked category: ${displayMeta.category}` : null
            ].filter(Boolean)
          },
          {
            title: "Products & services portfolio",
            badge: "Context",
            description: displayMeta?.role || "Product-line detail is inferred from the public company summary and the app's stock taxonomy.",
            bullets: [
              displayMeta?.edge ? `Edge: ${displayMeta.edge}` : null,
              profile?.website ? `Website: ${profile.website}` : null,
              profile?.exchange ? `Primary exchange: ${profile.exchange}` : null
            ].filter(Boolean)
          },
          {
            title: "End-markets & customer base",
            badge: "Context",
            description: peers.length
              ? "Tracked peers help frame adjacent competitors and market structure."
              : "Peer mapping is limited for this stock in the current catalog.",
            bullets: peers.slice(0, 5).map((peer) => {
              const bits = [peer.symbol, peer.name, peer.category].filter(Boolean);
              return bits.join(" • ");
            })
          },
          {
            title: "Geographic footprint",
            badge: "Context",
            description: location || "Headquarters location is not available in the current public snapshot.",
            bullets: [
              profile?.address1 ? `Address: ${profile.address1}` : null,
              profile?.employees != null ? `Employees: ${formatNumber(profile.employees)}` : null,
              profile?.currency ? `Reporting currency: ${profile.currency}` : null
            ].filter(Boolean)
          }
        ]
      },
      {
        key: "financials",
        title: "Financial performance",
        meta: "Core numbers",
        items: [
          {
            title: "Revenue & growth",
            badge: "Quantitative",
            bullets: [
              `Revenue: ${formatMoney(profile?.totalRevenue)}`,
              `Revenue growth: ${formatPercent(profile?.revenueGrowth)}`,
              `Earnings growth: ${formatPercent(profile?.earningsGrowth)}`,
              `Market cap: ${formatMoney(profile?.marketCap)}`
            ]
          },
          {
            title: "Profitability margins",
            badge: "Quantitative",
            bullets: [
              `Gross margin: ${formatPercent(profile?.grossMargins)}`,
              `Operating margin: ${formatPercent(profile?.operatingMargins)}`,
              `EBITDA margin: ${formatPercent(profile?.ebitdaMargins)}`,
              `Profit margin: ${formatPercent(profile?.profitMargins)}`
            ]
          },
          {
            title: "Cash flow quality",
            badge: "Quantitative",
            bullets: [
              `Operating cash flow: ${formatMoney(profile?.operatingCashflow)}`,
              `Free cash flow: ${formatMoney(profile?.freeCashflow)}`,
              `Enterprise value: ${formatMoney(profile?.enterpriseValue)}`
            ]
          },
          {
            title: "Returns & capital efficiency",
            badge: "Quantitative",
            bullets: [
              `Return on assets: ${formatPercent(profile?.returnOnAssets)}`,
              `Return on equity: ${formatPercent(profile?.returnOnEquity)}`,
              `Price to book: ${Number.isFinite(Number(profile?.priceToBook)) ? Number(profile.priceToBook).toFixed(2) : "Not available"}`
            ]
          },
          {
            title: "Balance sheet & leverage",
            badge: "Quantitative",
            bullets: [
              `Total cash: ${formatMoney(profile?.totalCash)}`,
              `Total debt: ${formatMoney(profile?.totalDebt)}`,
              `Debt to equity: ${Number.isFinite(Number(profile?.debtToEquity)) ? Number(profile.debtToEquity).toFixed(1) : "Not available"}`,
              `Current ratio: ${Number.isFinite(Number(profile?.currentRatio)) ? Number(profile.currentRatio).toFixed(2) : "Not available"}`
            ]
          },
          {
            title: "Earnings performance",
            badge: "Quantitative",
            description: profile?.earnings?.nextEarnings
              ? `Next earnings date: ${formatDate(profile.earnings.nextEarnings)}`
              : "Upcoming earnings date is not available in the current snapshot.",
            bullets: earningsHistory.length
              ? earningsHistory.slice(0, 4).map((row) => {
                  const surprise = Number(row?.surprisePct);
                  const surpriseText = Number.isFinite(surprise) ? `${surprise.toFixed(1)}% surprise` : "surprise not available";
                  return `${formatDate(row?.date)} • est ${row?.epsEstimate ?? "n/a"} • actual ${row?.reportedEps ?? "n/a"} • ${surpriseText}`;
                })
              : ["Recent quarterly EPS performance is not available from the current public snapshot."]
          }
        ]
      },
      {
        key: "operations",
        title: "Operational metrics",
        meta: manufacturing?.isIndustrial ? "Factory floor KPIs" : "Operating snapshot",
        items: [
          {
            title: "Capacity utilization",
            badge: "Quantitative",
            bullets: Array.isArray(manufacturing?.factoryFootprint) && manufacturing.factoryFootprint.length
              ? manufacturing.factoryFootprint
              : ["Detailed plant-capacity disclosures are not available in structured form."]
          },
          {
            title: "Efficiency signals",
            badge: "Quantitative",
            bullets: Array.isArray(manufacturing?.efficiencySignals) && manufacturing.efficiencySignals.length
              ? manufacturing.efficiencySignals
              : ["Operational efficiency metrics are limited in the current public snapshot."]
          },
          {
            title: "Customer timelines & fulfillment",
            badge: "Context",
            bullets: Array.isArray(manufacturing?.customerFulfillment) && manufacturing.customerFulfillment.length
              ? manufacturing.customerFulfillment
              : ["Customer-timeline and fulfillment-rate disclosures are not available in structured form."]
          },
          {
            title: "Product inputs & throughput",
            badge: "Context",
            bullets: Array.isArray(manufacturing?.inputExposure) && manufacturing.inputExposure.length
              ? manufacturing.inputExposure
              : ["Input-cost and throughput disclosures are not available in structured form."]
          }
        ]
      },
      {
        key: "moat",
        title: "Market position & competitive moat",
        meta: "Durability of advantage",
        items: [
          {
            title: "Market share & industry ranking",
            badge: "Context",
            bullets: [
              profile?.industry ? `Industry group: ${profile.industry}` : null,
              peers.length ? `Tracked peer count: ${peers.length}` : null,
              displayMeta?.category ? `Internal category position: ${displayMeta.category}` : null
            ].filter(Boolean)
          },
          {
            title: "Pricing power evidence",
            badge: "Context",
            bullets: [
              `Gross margin signal: ${formatPercent(profile?.grossMargins)}`,
              `Operating margin signal: ${formatPercent(profile?.operatingMargins)}`,
              displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null
            ].filter(Boolean)
          },
          {
            title: "Tracked peer set",
            badge: "Context",
            bullets: peers.length
              ? peers.slice(0, 6).map((peer) => {
                  const parts = [peer.symbol, peer.name, peer.theme, peer.category].filter(Boolean);
                  return parts.join(" • ");
                })
              : ["A comparable peer set is not yet available in the internal stock catalog for this symbol."]
          }
        ]
      },
      {
        key: "governance",
        title: "Management & governance",
        meta: "Who runs the capital",
        items: [
          {
            title: "Leadership track record",
            badge: "Context",
            bullets: leadership.length
              ? leadership.slice(0, 6).map((leader) => {
                  const parts = [leader.name, leader.title, leader.age ? `age ${leader.age}` : null].filter(Boolean);
                  return parts.join(" • ");
                })
              : ["Leadership roster was not available in structured form from the current public snapshot."]
          },
          {
            title: "Capital allocation signals",
            badge: "Quantitative",
            bullets: [
              `Dividend yield: ${formatPercent(profile?.dividendYield)}`,
              `Analyst target: ${formatMoney(profile?.targetMeanPrice)}`,
              profile?.analystRating ? `Street rating: ${formatLabel(profile.analystRating)}` : null
            ].filter(Boolean)
          },
          {
            title: "Governance risk flags",
            badge: "Risk",
            bullets: [
              profile?.risk?.overallRisk != null ? `Overall risk score: ${profile.risk.overallRisk}` : null,
              profile?.risk?.auditRisk != null ? `Audit risk score: ${profile.risk.auditRisk}` : null,
              profile?.risk?.shareHolderRightsRisk != null ? `Shareholder rights risk: ${profile.risk.shareHolderRightsRisk}` : null
            ].filter(Boolean).length
              ? [
                  profile?.risk?.overallRisk != null ? `Overall risk score: ${profile.risk.overallRisk}` : null,
                  profile?.risk?.auditRisk != null ? `Audit risk score: ${profile.risk.auditRisk}` : null,
                  profile?.risk?.shareHolderRightsRisk != null ? `Shareholder rights risk: ${profile.risk.shareHolderRightsRisk}` : null
                ].filter(Boolean)
              : ["Structured governance risk fields were not available in the current public snapshot."]
          }
        ]
      }
    ],
    deep: [
      {
        key: "supply-chain",
        title: "Supply chain & input cost structure",
        meta: "Bill of materials lens",
        items: [
          {
            title: "Input exposure",
            badge: "Context",
            bullets: Array.isArray(manufacturing?.inputExposure) && manufacturing.inputExposure.length
              ? manufacturing.inputExposure
              : ["No structured input-cost map was available from the current public snapshot."]
          }
        ]
      },
      {
        key: "technology",
        title: "Production technology & R&D",
        meta: "Process edge",
        items: [
          {
            title: "Technology edge",
            badge: "Context",
            bullets: [
              displayMeta?.role || "Specific process-role metadata is not available in the stock catalog for this name.",
              displayMeta?.edge || "A differentiated technical edge was not captured in the current catalog entry."
            ]
          }
        ]
      },
      {
        key: "capex",
        title: "CapEx profile & asset quality",
        meta: "Asset intensity",
        items: [
          {
            title: "Balance sheet capacity",
            badge: "Quantitative",
            bullets: [
              `Enterprise value: ${formatMoney(profile?.enterpriseValue)}`,
              `Free cash flow: ${formatMoney(profile?.freeCashflow)}`,
              `Total debt: ${formatMoney(profile?.totalDebt)}`,
              `Total cash: ${formatMoney(profile?.totalCash)}`
            ]
          }
        ]
      },
      {
        key: "cyclicality",
        title: "Cyclicality & end-market dynamics",
        meta: "Demand sensitivity",
        items: [
          {
            title: "Market cycle sensitivity",
            badge: "Quantitative",
            bullets: [
              `Beta: ${Number.isFinite(Number(profile?.beta)) ? Number(profile.beta).toFixed(2) : "Not available"}`,
              `52-week range: ${formatMoney(profile?.fiftyTwoWeekLow)} to ${formatMoney(profile?.fiftyTwoWeekHigh)}`,
              `Revenue growth: ${formatPercent(profile?.revenueGrowth)}`,
              `Earnings growth: ${formatPercent(profile?.earningsGrowth)}`
            ]
          }
        ]
      },
      {
        key: "regulatory",
        title: "Regulatory & trade compliance",
        meta: "Jurisdictional map",
        items: [
          {
            title: "Listing & geography",
            badge: "Context",
            bullets: [
              profile?.exchange ? `Exchange: ${profile.exchange}` : null,
              profile?.country ? `Primary country disclosure: ${profile.country}` : null,
              "Detailed trade-compliance and export-control disclosures are not available in structured form from the current snapshot."
            ].filter(Boolean)
          }
        ]
      },
      {
        key: "esg",
        title: "ESG & sustainability",
        meta: "Disclosure depth",
        items: [
          {
            title: "Sustainability snapshot",
            badge: "Context",
            bullets: [
              "No dedicated ESG score feed is wired into this page yet.",
              "Use the company website, filings, and sustainability report for deeper emissions, water, and labor disclosures."
            ]
          }
        ]
      },
      {
        key: "growth",
        title: "Growth strategy & value levers",
        meta: "What can re-rate the stock",
        items: [
          {
            title: "Potential upside drivers",
            badge: "Context",
            bullets: [
              profile?.targetMeanPrice ? `Consensus target price: ${formatMoney(profile.targetMeanPrice)}` : null,
              displayMeta?.theme ? `Theme tailwind: ${displayMeta.theme}` : null,
              displayMeta?.edge ? `Execution edge: ${displayMeta.edge}` : null,
              profile?.earnings?.nextEarnings ? `Next catalyst: ${formatDate(profile.earnings.nextEarnings)}` : null
            ].filter(Boolean)
          }
        ]
      },
      {
        key: "risks",
        title: "Key risk factors",
        meta: "What can go wrong",
        items: [
          {
            title: "Financial and execution risks",
            badge: "Risk",
            bullets: [
              `Debt load: ${formatMoney(profile?.totalDebt)}`,
              `Debt to equity: ${Number.isFinite(Number(profile?.debtToEquity)) ? Number(profile.debtToEquity).toFixed(1) : "Not available"}`,
              profile?.risk?.overallRisk != null ? `Overall governance risk score: ${profile.risk.overallRisk}` : null,
              profile?.stale ? "This page is currently showing a cached snapshot because the latest upstream refresh was unavailable." : null
            ].filter(Boolean)
          }
        ]
      }
    ]
  };
}

export function CompanyProfilePage({ symbol, asset, onBack }) {
  const normalizedSymbol = String(symbol || asset?.symbol || "").trim().toUpperCase();
  const preferredTheme = String(asset?.theme || "").trim();
  const preferredCategory = String(asset?.category || "").trim();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("base");
  const [openSections, setOpenSections] = useState(() => new Set(["overview", "financials", "growth"]));

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const loadProfile = async () => {
      if (!normalizedSymbol) {
        setError("No stock symbol selected.");
        setLoading(false);
        return;
      }

      const cacheParams = {
        symbol: normalizedSymbol,
        theme: preferredTheme || null,
        category: preferredCategory || null
      };
      const cached = readResilientCache("company-profile", cacheParams);
      const cacheFresh = isFresh(cached, COMPANY_PROFILE_CACHE_TTL_MS);

      if (cached?.payload && typeof cached.payload === "object") {
        setProfile(cached.payload);
        if (cacheFresh && !cached.payload?.stale && !cached.payload?.unavailable) {
          setLoading(false);
          return;
        }
      }

      setLoading(true);
      setError("");

      try {
        const params = new URLSearchParams({ symbol: normalizedSymbol });
        if (preferredTheme) params.set("theme", preferredTheme);
        if (preferredCategory) params.set("category", preferredCategory);
        const res = await fetch(`${BACKEND_URL}/company-profile?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted || cancelled) return;
        if (!res.ok || data?.error) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        setProfile(data);
        writeResilientCache("company-profile", cacheParams, data);
      } catch (err) {
        if (controller.signal.aborted || cancelled) return;
        console.error("Failed to fetch company profile:", err);
        if (!cached?.payload) {
          setError(err?.message || "Failed to load company profile.");
        }
      } finally {
        if (!controller.signal.aborted && !cancelled) setLoading(false);
      }
    };

    loadProfile();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [normalizedSymbol, preferredTheme, preferredCategory]);

  const displayMeta = useMemo(() => ({
    theme: asset?.theme || profile?.catalog?.theme || null,
    category: asset?.category || profile?.catalog?.category || null,
    role: asset?.role || profile?.catalog?.role || null,
    edge: asset?.edge || profile?.catalog?.edge || null
  }), [asset, profile]);

  const companyName = asset?.name || profile?.name || normalizedSymbol;
  const sections = useMemo(() => buildOverviewSections(profile || {}, displayMeta), [profile, displayMeta]);
  const visibleSections = activeTab === "deep" ? sections.deep : sections.base;
  const earningsHistory = Array.isArray(profile?.earningsHistory) ? profile.earningsHistory : [];

  const statCards = [
    { label: "Market cap", value: formatMoney(profile?.marketCap) },
    { label: "Revenue", value: formatMoney(profile?.totalRevenue) },
    { label: "Next earnings", value: formatDate(profile?.earnings?.nextEarnings) },
    { label: "Analyst target", value: formatMoney(profile?.targetMeanPrice) }
  ];

  const toggleSection = (key) => {
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div className="company-page">
      <div className="company-page-header">
        <button className="company-page-back" onClick={onBack} type="button">
          Back
        </button>
        <div className="company-page-title-wrap">
          <div className="company-page-kicker">Stock Research Page</div>
          <h1>{companyName}</h1>
          <div className="company-page-subtitle">
            <span>{normalizedSymbol}</span>
            {profile?.industry && <span>{profile.industry}</span>}
            {displayMeta?.theme && <span>{displayMeta.theme}</span>}
            {displayMeta?.category && <span>{displayMeta.category}</span>}
          </div>
          <p>
            {profile?.summary || "Public company profile information will appear here once the stock snapshot loads."}
          </p>
        </div>
        <div className={`company-page-health ${profile?.stale ? "hazard" : "ok"}`}>
          {profile?.stale ? "Cached snapshot" : "Public snapshot"}
          <span>{formatDate(profile?.updatedAt)}</span>
        </div>
      </div>

      <div className="company-page-stats">
        {statCards.map((card) => (
          <div className="company-stat-card" key={card.label}>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
          </div>
        ))}
      </div>

      <div className="company-page-framework">
        <div className="company-page-tabs">
          <button
            type="button"
            className={`company-page-tab ${activeTab === "base" ? "active-base" : ""}`}
            onClick={() => setActiveTab("base")}
          >
            Base information
          </button>
          <button
            type="button"
            className={`company-page-tab ${activeTab === "deep" ? "active-deep" : ""}`}
            onClick={() => setActiveTab("deep")}
          >
            Deep dive
          </button>
        </div>

        <div className="company-page-legend">
          {activeTab === "base"
            ? "Universal company checkpoints that translate the public snapshot into a quick operating and financial read."
            : "A deeper operating lens using the manufacturing framework, with honest fallbacks where structured public disclosures are thin."}
        </div>

        {loading && !profile ? (
          <div className="company-page-empty">Loading company profile...</div>
        ) : error ? (
          <div className="company-page-empty">{error}</div>
        ) : (
          <div className="company-page-sections">
            {visibleSections.map((section, idx) => {
              const isOpen = openSections.has(section.key);
              return (
                <div key={section.key} className={`company-section ${isOpen ? "open" : ""}`}>
                  <button
                    type="button"
                    className="company-section-header"
                    onClick={() => toggleSection(section.key)}
                  >
                    <span className={`company-section-icon ${activeTab === "base" ? "icon-base" : "icon-deep"}`}>
                      {String(idx + 1).padStart(2, "0")}
                    </span>
                    <span className="company-section-title">{section.title}</span>
                    <span className="company-section-meta">{section.meta}</span>
                    <span className="company-section-chevron">{isOpen ? "▲" : "▼"}</span>
                  </button>
                  {isOpen && (
                    <div className="company-section-body">
                      {section.items.map((item) => (
                        <div key={item.title} className="company-section-item">
                          <div className="company-item-title">
                            {item.title}
                            <span className={`company-item-badge badge-${String(item.badge || "").toLowerCase()}`}>
                              {item.badge}
                            </span>
                          </div>
                          {item.description && <p className="company-item-description">{item.description}</p>}
                          {Array.isArray(item.bullets) && item.bullets.length > 0 && (
                            <ul className="company-item-bullets">
                              {item.bullets.map((bullet) => (
                                <li key={`${item.title}-${bullet}`}>{bullet}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {earningsHistory.length > 0 && (
        <div className="company-earnings-card">
          <div className="company-earnings-head">
            <h2>Recent earnings performance</h2>
            <span>{normalizedSymbol}</span>
          </div>
          <div className="company-earnings-table-wrap">
            <table className="company-earnings-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>EPS estimate</th>
                  <th>Reported EPS</th>
                  <th>Surprise</th>
                </tr>
              </thead>
              <tbody>
                {earningsHistory.slice(0, 8).map((row, index) => {
                  const surprise = Number(row?.surprisePct);
                  return (
                    <tr key={`${row?.date || "earnings"}-${index}`}>
                      <td>{formatDate(row?.date)}</td>
                      <td>{row?.epsEstimate ?? "n/a"}</td>
                      <td>{row?.reportedEps ?? "n/a"}</td>
                      <td className={Number.isFinite(surprise) ? (surprise >= 0 ? "positive" : "negative") : ""}>
                        {Number.isFinite(surprise) ? `${surprise.toFixed(1)}%` : "n/a"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
