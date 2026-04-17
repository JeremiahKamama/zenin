import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";

const BACKEND_URL = import.meta.env.VITE_API_URL || "https://zenin-mx6w.onrender.com/api";
const COMPANY_PROFILE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * UTILS & FORMATTERS
 */
function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "N/A";
  const abs = Math.abs(numeric);
  if (abs >= 1e12) return `$${(numeric / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(numeric / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(numeric / 1e6).toFixed(2)}M`;
  return `$${numeric.toLocaleString()}`;
}

export function CompanyProfilePage({ symbol = "AAPL" }) {
  const [profile, setProfile] = useState(null);
  const [regulatory, setRegulatory] = useState(null); // New state for deep industry fields
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function fetchDeepProfile() {
      setLoading(true);
      try {
        // We fetch from a combined intelligence endpoint that aggregates 
        // Yahoo (financials) + Regulatory sources (SEC, FDA, USAspending, etc.)
        const res = await fetch(`${BACKEND_URL}/stocks/profile/intelligence?symbol=${symbol}`);
        const data = await res.json();
        
        if (data.error) throw new Error(data.error);
        
        setProfile(data.yahooData || {});
        setRegulatory(data.regulatoryData || {});
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (symbol) fetchDeepProfile();
  }, [symbol]);

  // Industry-Specific Framework Router
  const renderIndustryFramework = () => {
    const sector = profile?.sector?.toLowerCase() || "";
    const industry = profile?.industry?.toLowerCase() || "";

    // 1. PHARMACEUTICALS & BIOTECH (FDA Source)
    if (industry.includes("pharmaceutical") || industry.includes("biotech")) {
      return (
        <div className="intelligence-card glass">
          <div className="card-header">
            <h3>FDA Pipeline & Regulatory Intelligence</h3>
            <span className="source-tag">Source: FDA.gov</span>
          </div>
          <div className="framework-grid">
            <div className="framework-item">
              <label>Phase III Trials</label>
              <span>{regulatory?.fda?.phase3Count || 0} Compounds</span>
            </div>
            <div className="framework-item">
              <label>PDUFA Dates (Next 12M)</label>
              <span>{regulatory?.fda?.pdufaUpcoming || "None"}</span>
            </div>
            <div className="framework-item">
              <label>Patent Expiration Risk</label>
              <span className="warning-text">{regulatory?.fda?.patentRisk || "Low"}</span>
            </div>
          </div>
        </div>
      );
    }

    // 2. DEFENSE & AEROSPACE (USAspending Source)
    if (industry.includes("aerospace") || industry.includes("defense")) {
      return (
        <div className="intelligence-card glass">
          <div className="card-header">
            <h3>Federal Award & Defense Contract Analysis</h3>
            <span className="source-tag">Source: USAspending.gov</span>
          </div>
          <div className="framework-grid">
            <div className="framework-item">
              <label>Total Federal Obligations (YTD)</label>
              <span>{formatMoney(regulatory?.defense?.totalAwards)}</span>
            </div>
            <div className="framework-item">
              <label>Top Awarding Agency</label>
              <span>{regulatory?.defense?.primaryAgency || "Dept. of Defense"}</span>
            </div>
            <div className="framework-item">
              <label>Contract Backlog Duration</label>
              <span>{regulatory?.defense?.backlogYears || "N/A"} Years</span>
            </div>
          </div>
        </div>
      );
    }

    // 3. ENERGY & UTILITIES (EIA / FERC Source)
    if (sector.includes("energy") || sector.includes("utilities")) {
      return (
        <div className="intelligence-card glass">
          <div className="card-header">
            <h3>Energy Infrastructure & FERC Filings</h3>
            <span className="source-tag">Source: EIA / FERC</span>
          </div>
          <div className="framework-grid">
            <div className="framework-item">
              <label>Net Generation Capacity</label>
              <span>{regulatory?.energy?.capacity || "N/A"} MWh</span>
            </div>
            <div className="framework-item">
              <label>Regulatory Rate Base</label>
              <span>{formatMoney(regulatory?.energy?.rateBase)}</span>
            </div>
            <div className="framework-item">
              <label>Carbon Intensity Score</label>
              <span>{regulatory?.energy?.carbonScore || "Pending"}</span>
            </div>
          </div>
        </div>
      );
    }

    // Default: Standard Corporate Framework (SEC Source)
    return (
      <div className="intelligence-card glass">
        <div className="card-header">
          <h3>SEC Filing Analysis & Insider Activity</h3>
          <span className="source-tag">Source: SEC.gov / EDGAR</span>
        </div>
        <div className="framework-grid">
          <div className="framework-item">
            <label>Latest 10-K/Q Filed</label>
            <a href={regulatory?.sec?.lastFilingUrl} target="_blank" rel="noreferrer">
              {regulatory?.sec?.lastFilingDate || "View SEC.gov"}
            </a>
          </div>
          <div className="framework-item">
            <label>Institutional Ownership</label>
            <span>{regulatory?.sec?.instOwnership || "N/A"}%</span>
          </div>
          <div className="framework-item">
            <label>Auditor Opinion</label>
            <span>{regulatory?.sec?.auditor || "Clean"}</span>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return <div className="loading-container">Synchronizing Regulatory Intelligence...</div>;
  if (error) return <div className="error-card">{error}</div>;

  return (
    <div className="company-profile-container">
      {/* HEADER: YAHOO SOURCE */}
      <div className="profile-header-section">
        <div className="header-top">
          <div>
            <h1>{profile.longName} ({symbol})</h1>
            <p className="sector-info">{profile.sector} • {profile.industry} • {profile.fullTimeEmployees?.toLocaleString()} Employees</p>
          </div>
          <div className="price-box">
            <span className="current-price">${profile.currentPrice?.toFixed(2)}</span>
            <span className={`price-change ${profile.regularMarketChange >= 0 ? "positive" : "negative"}`}>
              {profile.regularMarketChangePercent?.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      <div className="profile-content-grid">
        {/* LEFT COLUMN: CORE FINANCIALS (YAHOO) */}
        <div className="main-stats-col">
          <div className="stats-card glass">
            <h2>Headline Financials & Valuation</h2>
            <div className="metrics-list">
              <div className="metric">
                <label>Market Cap</label>
                <span>{formatMoney(profile.marketCap)}</span>
              </div>
              <div className="metric">
                <label>Trailing P/E</label>
                <span>{profile.trailingPE?.toFixed(2) || "N/A"}</span>
              </div>
              <div className="metric">
                <label>EV/EBITDA</label>
                <span>{profile.enterpriseToEbitda?.toFixed(2) || "N/A"}</span>
              </div>
              <div className="metric">
                <label>Div. Yield</label>
                <span>{(profile.dividendYield * 100)?.toFixed(2) || "0.00"}%</span>
              </div>
            </div>
          </div>

          <div className="description-card glass" style={{ marginTop: '20px' }}>
            <h2>Business Summary</h2>
            <p>{profile.longBusinessSummary}</p>
          </div>
        </div>

        {/* RIGHT COLUMN: INDUSTRY FRAMEWORKS (REGULATORY) */}
        <div className="intelligence-col">
          {renderIndustryFramework()}
          
          <div className="events-card glass" style={{ marginTop: '20px' }}>
            <h3>Market Calendar</h3>
            <div className="event-item">
              <label>Next Earnings</label>
              <span>{new Date(profile.earningsDate).toLocaleDateString()}</span>
            </div>
            <div className="event-item">
              <label>Ex-Dividend Date</label>
              <span>{profile.exDividendDate || "N/A"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}