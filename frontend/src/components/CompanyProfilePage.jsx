import { useEffect, useMemo, useState } from "react";
import { readResilientCache, writeResilientCache } from "../utils/resilientData";
import { getSnapshotFallbackMessage } from "../utils/staleNotice";

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

function formatDecimal(value, digits = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : "Not available";
}

function normalizeFrameworkKey(theme, category) {
  const raw = `${theme || ""} ${category || ""}`.trim().toLowerCase();
  if (/(^|\W)(ai|artificial intelligence)(\W|$)/.test(raw)) return "ai";
  if (raw.includes("robot")) return "robotics";
  if (raw.includes("defense")) return "defense";
  if (raw.includes("energy")) return "energy";
  if (raw.includes("pharma") || raw.includes("medicine") || raw.includes("drug") || raw.includes("biotech")) return "pharma";
  if (raw.includes("transport")) return "transportation";
  if (raw.includes("space")) return "space";
  return "generic";
}

function compactBullets(items, fallback) {
  const cleaned = (Array.isArray(items) ? items : [])
    .map((item) => (item == null ? "" : String(item).trim()))
    .filter(Boolean);
  return cleaned.length ? cleaned : [fallback];
}

function buildItem(title, badge, bullets, description, fallback) {
  return {
    title,
    badge,
    description,
    bullets: compactBullets(bullets, fallback || "Structured public disclosures for this section are limited right now.")
  };
}

function buildSection(key, title, meta, items) {
  return {
    key,
    title,
    meta,
    items: (Array.isArray(items) ? items : []).filter(Boolean)
  };
}

function buildFrameworkContext(profile, displayMeta) {
  const leadership = Array.isArray(profile?.leadership) ? profile.leadership.filter((person) => person?.name) : [];
  const peers = Array.isArray(profile?.peers) ? profile.peers : [];
  const earningsHistory = Array.isArray(profile?.earningsHistory) ? profile.earningsHistory : [];
  const manufacturing = profile?.manufacturing || {};
  const location = [profile?.city, profile?.state, profile?.country].filter(Boolean).join(", ");
  return {
    leadership,
    peers,
    earningsHistory,
    manufacturing,
    location,
    peerSummary: compactBullets(
      peers.slice(0, 6).map((peer) => [peer.symbol, peer.name, peer.theme, peer.category].filter(Boolean).join(" • ")),
      "A comparable peer set is not yet available in the internal stock catalog for this symbol."
    ),
    leadershipSummary: compactBullets(
      leadership.slice(0, 6).map((leader) => [leader.name, leader.title, leader.age ? `age ${leader.age}` : null].filter(Boolean).join(" • ")),
      "Leadership roster was not available in structured form from the current public snapshot."
    ),
    earningsSummary: compactBullets(
      earningsHistory.slice(0, 4).map((row) => {
        const surprise = Number(row?.surprisePct);
        const surpriseText = Number.isFinite(surprise) ? `${surprise.toFixed(1)}% surprise` : "surprise not available";
        return `${formatDate(row?.date)} • est ${row?.epsEstimate ?? "n/a"} • actual ${row?.reportedEps ?? "n/a"} • ${surpriseText}`;
      }),
      "Recent quarterly EPS performance is not available from the current public snapshot."
    ),
    snapshotBullets: compactBullets([
      location ? `Headquarters: ${location}` : null,
      profile?.sector ? `Sector: ${profile.sector}` : null,
      profile?.industry ? `Industry: ${profile.industry}` : null,
      profile?.employees != null ? `Employees: ${formatNumber(profile.employees)}` : null,
      displayMeta?.theme ? `Tracked theme: ${displayMeta.theme}` : null,
      displayMeta?.category ? `Tracked category: ${displayMeta.category}` : null
    ], "Company identity and footprint data is limited in the current public snapshot."),
    businessBullets: compactBullets([
      displayMeta?.role ? `Role in theme: ${displayMeta.role}` : null,
      displayMeta?.edge ? `Edge: ${displayMeta.edge}` : null,
      profile?.website ? `Website: ${profile.website}` : null,
      profile?.exchange ? `Primary exchange: ${profile.exchange}` : null,
      profile?.currency ? `Reporting currency: ${profile.currency}` : null
    ], "Product-line detail is inferred from the public company summary and the stock catalog."),
    financialGrowthBullets: compactBullets([
      `Revenue: ${formatMoney(profile?.totalRevenue)}`,
      `Revenue growth: ${formatPercent(profile?.revenueGrowth)}`,
      `Earnings growth: ${formatPercent(profile?.earningsGrowth)}`,
      `Market cap: ${formatMoney(profile?.marketCap)}`
    ], "Top-line financial growth data is limited in the current public snapshot."),
    profitabilityBullets: compactBullets([
      `Gross margin: ${formatPercent(profile?.grossMargins)}`,
      `Operating margin: ${formatPercent(profile?.operatingMargins)}`,
      `EBITDA margin: ${formatPercent(profile?.ebitdaMargins)}`,
      `Profit margin: ${formatPercent(profile?.profitMargins)}`
    ], "Margin disclosures are limited in the current public snapshot."),
    cashflowBullets: compactBullets([
      `Operating cash flow: ${formatMoney(profile?.operatingCashflow)}`,
      `Free cash flow: ${formatMoney(profile?.freeCashflow)}`,
      `Enterprise value: ${formatMoney(profile?.enterpriseValue)}`
    ], "Cash-flow quality fields are limited in the current public snapshot."),
    balanceSheetBullets: compactBullets([
      `Total cash: ${formatMoney(profile?.totalCash)}`,
      `Total debt: ${formatMoney(profile?.totalDebt)}`,
      `Debt to equity: ${formatDecimal(profile?.debtToEquity, 1)}`,
      `Current ratio: ${formatDecimal(profile?.currentRatio, 2)}`
    ], "Balance-sheet and leverage fields are limited in the current public snapshot."),
    valuationBullets: compactBullets([
      `Trailing P/E: ${formatDecimal(profile?.trailingPE, 2)}`,
      `Forward P/E: ${formatDecimal(profile?.forwardPE, 2)}`,
      `Price to book: ${formatDecimal(profile?.priceToBook, 2)}`,
      `Analyst target: ${formatMoney(profile?.targetMeanPrice)}`
    ], "Valuation fields are limited in the current public snapshot."),
    returnsBullets: compactBullets([
      `Return on assets: ${formatPercent(profile?.returnOnAssets)}`,
      `Return on equity: ${formatPercent(profile?.returnOnEquity)}`,
      `Beta: ${formatDecimal(profile?.beta, 2)}`,
      `52-week range: ${formatMoney(profile?.fiftyTwoWeekLow)} to ${formatMoney(profile?.fiftyTwoWeekHigh)}`
    ], "Return and market-sensitivity fields are limited in the current public snapshot."),
    governanceBullets: compactBullets([
      profile?.risk?.overallRisk != null ? `Overall risk score: ${profile.risk.overallRisk}` : null,
      profile?.risk?.auditRisk != null ? `Audit risk score: ${profile.risk.auditRisk}` : null,
      profile?.risk?.shareHolderRightsRisk != null ? `Shareholder rights risk: ${profile.risk.shareHolderRightsRisk}` : null,
      profile?.analystRating ? `Street rating: ${formatLabel(profile.analystRating)}` : null
    ], "Structured governance risk fields were not available in the current public snapshot."),
    operationsBullets: compactBullets(manufacturing?.factoryFootprint, "Detailed plant or asset-footprint disclosures are not available in structured form."),
    efficiencyBullets: compactBullets(manufacturing?.efficiencySignals, "Operational efficiency metrics are limited in the current public snapshot."),
    customerBullets: compactBullets(manufacturing?.customerFulfillment, "Customer-timeline and fulfillment disclosures are not available in structured form."),
    inputBullets: compactBullets(manufacturing?.inputExposure, "Input-cost and throughput disclosures are not available in structured form."),
    catalystBullets: compactBullets([
      profile?.earnings?.nextEarnings ? `Next earnings date: ${formatDate(profile.earnings.nextEarnings)}` : null,
      profile?.targetMeanPrice ? `Consensus target price: ${formatMoney(profile.targetMeanPrice)}` : null,
      displayMeta?.theme ? `Theme tailwind: ${displayMeta.theme}` : null,
      displayMeta?.edge ? `Execution edge: ${displayMeta.edge}` : null
    ], "Forward catalyst disclosures are limited in the current public snapshot."),
    riskBullets: compactBullets([
      `Debt load: ${formatMoney(profile?.totalDebt)}`,
      `Debt to equity: ${formatDecimal(profile?.debtToEquity, 1)}`,
      profile?.risk?.overallRisk != null ? `Overall governance risk score: ${profile.risk.overallRisk}` : null,
      profile?.stale ? "This page is currently showing a cached snapshot because the latest upstream refresh was unavailable." : null
    ], "Key risk factors are only partially available from the current structured snapshot.")
  };
}

function buildFrameworkSections(profile, displayMeta) {
  const ctx = buildFrameworkContext(profile, displayMeta);
  const frameworkKey = normalizeFrameworkKey(displayMeta?.theme, displayMeta?.category);

  const genericFramework = {
    key: "generic",
    label: "General",
    subtitle: "Theme-aware stock research page",
    baseTabLabel: "Base information",
    deepTabLabel: "Deep dive",
    baseLegend: "Universal company checkpoints that translate the public snapshot into a quick operating and financial read.",
    deepLegend: "A deeper operating lens using the available public snapshot, with honest fallbacks where structured disclosures are thin.",
    base: [
      buildSection("overview", "Company overview", "Foundation layer", [
        buildItem("Business description & history", "Context", ctx.snapshotBullets, profile?.summary || "Public business summary is not available yet for this stock."),
        buildItem("Products & services portfolio", "Context", ctx.businessBullets),
        buildItem("End-markets & customer base", "Context", ctx.peerSummary, ctx.peers.length ? "Tracked peers help frame adjacent competitors and market structure." : "Peer mapping is limited for this stock in the current catalog."),
        buildItem("Geographic footprint", "Context", [
          profile?.address1 ? `Address: ${profile.address1}` : null,
          profile?.employees != null ? `Employees: ${formatNumber(profile.employees)}` : null,
          profile?.currency ? `Reporting currency: ${profile.currency}` : null
        ])
      ]),
      buildSection("financials", "Financial performance", "Core numbers", [
        buildItem("Revenue & growth", "Quantitative", ctx.financialGrowthBullets),
        buildItem("Profitability margins", "Quantitative", ctx.profitabilityBullets),
        buildItem("Cash flow quality", "Quantitative", ctx.cashflowBullets),
        buildItem("Balance sheet & leverage", "Quantitative", ctx.balanceSheetBullets),
        buildItem("Earnings performance", "Quantitative", ctx.earningsSummary, profile?.earnings?.nextEarnings ? `Next earnings date: ${formatDate(profile.earnings.nextEarnings)}` : "Upcoming earnings date is not available in the current snapshot.")
      ]),
      buildSection("operations", "Operational metrics", ctx.manufacturing?.isIndustrial ? "Factory floor KPIs" : "Operating snapshot", [
        buildItem("Capacity utilization", "Quantitative", ctx.operationsBullets),
        buildItem("Efficiency signals", "Quantitative", ctx.efficiencyBullets),
        buildItem("Customer timelines & fulfillment", "Context", ctx.customerBullets),
        buildItem("Product inputs & throughput", "Context", ctx.inputBullets)
      ]),
      buildSection("moat", "Market position & competitive moat", "Durability of advantage", [
        buildItem("Market share & industry ranking", "Context", [
          profile?.industry ? `Industry group: ${profile.industry}` : null,
          ctx.peers.length ? `Tracked peer count: ${ctx.peers.length}` : null,
          displayMeta?.category ? `Internal category position: ${displayMeta.category}` : null
        ]),
        buildItem("Pricing power evidence", "Context", [
          `Gross margin signal: ${formatPercent(profile?.grossMargins)}`,
          `Operating margin signal: ${formatPercent(profile?.operatingMargins)}`,
          displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null
        ]),
        buildItem("Tracked peer set", "Context", ctx.peerSummary)
      ]),
      buildSection("governance", "Management & governance", "Who runs the capital", [
        buildItem("Leadership track record", "Context", ctx.leadershipSummary),
        buildItem("Capital allocation signals", "Quantitative", [
          `Dividend yield: ${formatPercent(profile?.dividendYield)}`,
          `Analyst target: ${formatMoney(profile?.targetMeanPrice)}`,
          profile?.analystRating ? `Street rating: ${formatLabel(profile.analystRating)}` : null
        ]),
        buildItem("Governance risk flags", "Risk", ctx.governanceBullets)
      ])
    ],
    deep: [
      buildSection("supply-chain", "Supply chain & input cost structure", "Bill of materials lens", [
        buildItem("Input exposure", "Context", ctx.inputBullets)
      ]),
      buildSection("technology", "Production technology & R&D", "Process edge", [
        buildItem("Technology edge", "Context", [
          displayMeta?.role || "Specific process-role metadata is not available in the stock catalog for this name.",
          displayMeta?.edge || "A differentiated technical edge was not captured in the current catalog entry."
        ])
      ]),
      buildSection("capex", "CapEx profile & asset quality", "Asset intensity", [
        buildItem("Balance sheet capacity", "Quantitative", ctx.balanceSheetBullets)
      ]),
      buildSection("cyclicality", "Cyclicality & end-market dynamics", "Demand sensitivity", [
        buildItem("Market cycle sensitivity", "Quantitative", ctx.returnsBullets)
      ]),
      buildSection("regulatory", "Regulatory & trade compliance", "Jurisdictional map", [
        buildItem("Listing & geography", "Context", [
          profile?.exchange ? `Exchange: ${profile.exchange}` : null,
          profile?.country ? `Primary country disclosure: ${profile.country}` : null,
          "Detailed compliance and export-control disclosures are not available in structured form from the current snapshot."
        ])
      ]),
      buildSection("growth", "Growth strategy & value levers", "What can re-rate the stock", [
        buildItem("Potential upside drivers", "Context", ctx.catalystBullets)
      ]),
      buildSection("risks", "Key risk factors", "What can go wrong", [
        buildItem("Financial and execution risks", "Risk", ctx.riskBullets)
      ])
    ]
  };

  const frameworks = {
    defense: {
      ...genericFramework,
      key: "defense",
      label: "Defense",
      subtitle: "Defense company investor framework",
      baseLegend: "Fast-scan defense-company context focused on mission role, program exposure, manufacturing footprint, and revenue visibility.",
      deepLegend: "Serious-analysis defense lens focused on contract economics, execution risk, budget exposure, and strategic moat.",
      base: [
        buildSection("snapshot", "Company Snapshot", "Strategic role", [
          buildItem("Identity, scale, and mission focus", "Context", [
            ...ctx.snapshotBullets,
            profile?.marketCap ? `Market cap: ${formatMoney(profile.marketCap)}` : null,
            profile?.enterpriseValue ? `Enterprise value: ${formatMoney(profile.enterpriseValue)}` : null
          ], profile?.summary),
          buildItem("Capability and domain tags", "Context", ctx.businessBullets)
        ]),
        buildSection("business-model", "Business Model", "How revenue is won", [
          buildItem("Contract visibility and revenue predictability", "Context", [
            displayMeta?.category ? `Defense sub-sector: ${displayMeta.category}` : null,
            `Revenue: ${formatMoney(profile?.totalRevenue)}`,
            `Backlog proxy via scale: ${formatMoney(profile?.enterpriseValue)}`,
            profile?.earnings?.nextEarnings ? `Next update window: ${formatDate(profile.earnings.nextEarnings)}` : null
          ], "Program-level contract mix is not available in structured public form."),
          buildItem("Customer and program exposure", "Context", ctx.peerSummary, "Tracked peers help frame adjacent programs, platforms, and customer sets.")
        ]),
        buildSection("capabilities", "Product and Capability Portfolio", "What the company delivers", [
          buildItem("Platforms, systems, and services", "Context", ctx.businessBullets, displayMeta?.role || profile?.summary),
          buildItem("Manufacturing and delivery footprint", "Quantitative", ctx.operationsBullets)
        ]),
        buildSection("revenue-quality", "Customers and Revenue Quality", "Durability of revenue", [
          buildItem("Revenue concentration and visibility", "Quantitative", ctx.financialGrowthBullets),
          buildItem("Recent earnings and delivery cadence", "Quantitative", ctx.earningsSummary)
        ]),
        buildSection("financials", "Financial Profile", "Core numbers", [
          buildItem("Margins and cash generation", "Quantitative", [...ctx.profitabilityBullets, ...ctx.cashflowBullets]),
          buildItem("Balance sheet and capital support", "Quantitative", ctx.balanceSheetBullets)
        ]),
        buildSection("governance", "Management and Governance", "Who runs the capital", [
          buildItem("Leadership track record", "Context", ctx.leadershipSummary),
          buildItem("Governance and risk flags", "Risk", ctx.governanceBullets)
        ])
      ],
      deep: [
        buildSection("operations", "Operations and Execution", "Programs to delivery", [
          buildItem("Execution footprint and efficiency", "Quantitative", [...ctx.operationsBullets, ...ctx.efficiencyBullets]),
          buildItem("Customer timelines and fulfillment", "Context", ctx.customerBullets)
        ]),
        buildSection("capital-allocation", "Capital Allocation", "Balance sheet choices", [
          buildItem("Cash, debt, and shareholder posture", "Quantitative", [...ctx.balanceSheetBullets, ...ctx.valuationBullets])
        ]),
        buildSection("competitive-position", "Competitive Position", "Strategic moat", [
          buildItem("Peer map and sector standing", "Context", ctx.peerSummary),
          buildItem("Moat indicators", "Context", [
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null,
            `Gross margin signal: ${formatPercent(profile?.grossMargins)}`,
            `Operating margin signal: ${formatPercent(profile?.operatingMargins)}`
          ])
        ]),
        buildSection("regulatory", "Regulatory, Security, and Compliance", "Policy exposure", [
          buildItem("Listing, geography, and compliance limits", "Risk", [
            profile?.exchange ? `Exchange: ${profile.exchange}` : null,
            profile?.country ? `Primary country disclosure: ${profile.country}` : null,
            "Detailed security-clearance, export-control, and classified-program disclosures are not available in structured form."
          ])
        ]),
        buildSection("deep-analytics", "Deep Dive Analytics", "Budget and execution lens", [
          buildItem("Investor takeaways", "Context", [...ctx.catalystBullets, ...ctx.riskBullets])
        ])
      ]
    },
    energy: {
      ...genericFramework,
      key: "energy",
      label: "Energy",
      subtitle: "Energy company investor framework",
      baseLegend: "Fast-scan energy-company context focused on asset mix, commercial exposure, operations, and revenue quality.",
      deepLegend: "Serious-analysis energy lens focused on asset quality, commodity sensitivity, cost position, and transition readiness.",
      base: [
        buildSection("snapshot", "Company Snapshot", "Value-chain role", [
          buildItem("Identity, scale, and energy positioning", "Context", [...ctx.snapshotBullets, profile?.marketCap ? `Market cap: ${formatMoney(profile.marketCap)}` : null], profile?.summary),
          buildItem("Energy-model and geography tags", "Context", ctx.businessBullets)
        ]),
        buildSection("asset-portfolio", "Asset Portfolio and Energy Mix", "What it owns or operates", [
          buildItem("Major assets, production, or generation mix", "Context", [...ctx.operationsBullets, ...ctx.businessBullets]),
          buildItem("Commercial footprint", "Context", ctx.peerSummary)
        ]),
        buildSection("business-model", "Business Model", "Revenue predictability", [
          buildItem("Commodity-linked versus contracted economics", "Context", [
            displayMeta?.category ? `Energy segment: ${displayMeta.category}` : null,
            `Revenue: ${formatMoney(profile?.totalRevenue)}`,
            `Free cash flow: ${formatMoney(profile?.freeCashflow)}`,
            `Operating cash flow: ${formatMoney(profile?.operatingCashflow)}`
          ]),
          buildItem("Revenue quality and counterparties", "Quantitative", [...ctx.financialGrowthBullets, ...ctx.returnsBullets])
        ]),
        buildSection("operations", "Operations and Capacity", "Asset performance", [
          buildItem("Capacity and throughput", "Quantitative", ctx.operationsBullets),
          buildItem("Efficiency and reliability signals", "Quantitative", ctx.efficiencyBullets)
        ]),
        buildSection("financials", "Financial Profile", "Core numbers", [
          buildItem("Margins and cash generation", "Quantitative", [...ctx.profitabilityBullets, ...ctx.cashflowBullets]),
          buildItem("Balance sheet and leverage", "Quantitative", ctx.balanceSheetBullets)
        ]),
        buildSection("governance", "Management and Governance", "Capital stewards", [
          buildItem("Leadership track record", "Context", ctx.leadershipSummary),
          buildItem("Capital allocation and governance", "Quantitative", [...ctx.valuationBullets, ...ctx.governanceBullets])
        ])
      ],
      deep: [
        buildSection("commercial-exposure", "End Markets and Commercial Exposure", "Who pays and on what terms", [
          buildItem("Counterparty and demand exposure", "Context", [...ctx.customerBullets, ...ctx.peerSummary]),
          buildItem("Commodity sensitivity", "Risk", [...ctx.returnsBullets, ...ctx.riskBullets])
        ]),
        buildSection("capital-allocation", "Capital Allocation", "Cash return and reinvestment", [
          buildItem("Dividend, debt, and valuation posture", "Quantitative", [
            `Dividend yield: ${formatPercent(profile?.dividendYield)}`,
            ...ctx.balanceSheetBullets,
            ...ctx.valuationBullets
          ])
        ]),
        buildSection("competitive-position", "Competitive Position", "Asset quality and moat", [
          buildItem("Asset quality and market position", "Context", [
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null,
            profile?.industry ? `Industry group: ${profile.industry}` : null,
            ...ctx.peerSummary.slice(0, 4)
          ])
        ]),
        buildSection("regulatory", "Regulatory, Safety, and Sustainability", "Policy and transition", [
          buildItem("Geography, regulation, and sustainability watchpoints", "Risk", [
            profile?.country ? `Primary country disclosure: ${profile.country}` : null,
            profile?.exchange ? `Exchange: ${profile.exchange}` : null,
            "Detailed emissions, permitting, and safety disclosures are not available in structured form from the current snapshot."
          ])
        ]),
        buildSection("investor-takeaways", "Investor Takeaways Summary", "What matters most", [
          buildItem("Key upside and downside drivers", "Context", [...ctx.catalystBullets, ...ctx.riskBullets])
        ])
      ]
    },
    pharma: {
      ...genericFramework,
      key: "pharma",
      label: "Pharma / Medicine",
      subtitle: "Pharmaceutical company investor framework",
      baseLegend: "Fast-scan pharma-company context focused on product concentration, therapeutic exposure, pipeline signals, and manufacturing risk.",
      deepLegend: "Serious-analysis pharma lens focused on pipeline quality, exclusivity risk, manufacturing resilience, and earnings durability.",
      base: [
        buildSection("snapshot", "Company Snapshot", "Maturity and market position", [
          buildItem("Identity and therapeutic positioning", "Context", ctx.snapshotBullets, profile?.summary),
          buildItem("Business-model and product tags", "Context", ctx.businessBullets)
        ]),
        buildSection("portfolio", "Product Portfolio and Therapeutic Areas", "What it sells or develops", [
          buildItem("Commercial portfolio and key products", "Context", [...ctx.businessBullets, ...ctx.peerSummary.slice(0, 3)]),
          buildItem("Commercial footprint and end markets", "Context", ctx.peerSummary)
        ]),
        buildSection("business-model", "Business Model", "Revenue predictability", [
          buildItem("Branded, generic, OTC, or services mix", "Context", [
            displayMeta?.category ? `Pharma segment: ${displayMeta.category}` : null,
            `Revenue: ${formatMoney(profile?.totalRevenue)}`,
            `Revenue growth: ${formatPercent(profile?.revenueGrowth)}`,
            `Earnings growth: ${formatPercent(profile?.earningsGrowth)}`
          ]),
          buildItem("Revenue quality and concentration", "Quantitative", ctx.earningsSummary)
        ]),
        buildSection("rnd", "R&D and Pipeline", "Future growth engine", [
          buildItem("Pipeline and catalyst readout", "Context", ctx.catalystBullets, "Clinical-stage and launch-timing details are not available in structured form."),
          buildItem("Leadership and technical stewardship", "Context", ctx.leadershipSummary)
        ]),
        buildSection("manufacturing", "Manufacturing and Supply", "Making and shipping product", [
          buildItem("Manufacturing footprint", "Quantitative", ctx.operationsBullets),
          buildItem("Supply reliability and fulfillment", "Context", [...ctx.efficiencyBullets, ...ctx.customerBullets, ...ctx.inputBullets])
        ]),
        buildSection("financials", "Financial Profile", "Core numbers", [
          buildItem("Profitability and cash flow", "Quantitative", [...ctx.profitabilityBullets, ...ctx.cashflowBullets]),
          buildItem("Balance sheet and capital support", "Quantitative", ctx.balanceSheetBullets)
        ])
      ],
      deep: [
        buildSection("revenue-quality", "Revenue Quality and Product Concentration", "Durability of earnings", [
          buildItem("Concentration and pricing durability", "Risk", [...ctx.financialGrowthBullets, ...ctx.earningsSummary]),
          buildItem("Commercial resilience", "Context", ctx.peerSummary)
        ]),
        buildSection("competitive-position", "Competitive Position", "Moat and therapeutic standing", [
          buildItem("Category edge and market position", "Context", [
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null,
            profile?.industry ? `Industry group: ${profile.industry}` : null,
            ...ctx.peerSummary.slice(0, 4)
          ])
        ]),
        buildSection("regulatory", "Regulatory, Safety, and Compliance", "Approval and quality risk", [
          buildItem("Safety and regulatory exposure", "Risk", [
            profile?.country ? `Primary country disclosure: ${profile.country}` : null,
            "Detailed patent cliffs, inspection outcomes, and reimbursement data are not available in structured form."
          ])
        ]),
        buildSection("management", "Management and Governance", "Capital stewards", [
          buildItem("Leadership and governance quality", "Context", ctx.leadershipSummary),
          buildItem("Governance watchpoints", "Risk", ctx.governanceBullets)
        ]),
        buildSection("investor-takeaways", "Investor Takeaways Summary", "What drives the thesis", [
          buildItem("Catalysts and key risks", "Context", [...ctx.catalystBullets, ...ctx.riskBullets])
        ])
      ]
    },
    transportation: {
      ...genericFramework,
      key: "transportation",
      label: "Transportation",
      subtitle: "Transportation company investor framework",
      baseLegend: "Fast-scan transportation context focused on service mix, network quality, fleet utilization, and customer visibility.",
      deepLegend: "Serious-analysis transportation lens focused on network economics, asset intensity, utilization, and operating risk.",
      base: [
        buildSection("snapshot", "Company Snapshot", "Scale and footprint", [
          buildItem("Identity and transport niche", "Context", ctx.snapshotBullets, profile?.summary),
          buildItem("Business tags and service mix", "Context", ctx.businessBullets)
        ]),
        buildSection("services", "Services and Network", "What it moves and where", [
          buildItem("Service lines and route footprint", "Context", [...ctx.businessBullets, ...ctx.peerSummary.slice(0, 4)]),
          buildItem("Fleet, infrastructure, and capacity", "Quantitative", ctx.operationsBullets)
        ]),
        buildSection("business-model", "Business Model", "Revenue visibility", [
          buildItem("Contracted versus spot economics", "Context", [
            displayMeta?.category ? `Transport mode: ${displayMeta.category}` : null,
            `Revenue: ${formatMoney(profile?.totalRevenue)}`,
            `Operating cash flow: ${formatMoney(profile?.operatingCashflow)}`,
            `Free cash flow: ${formatMoney(profile?.freeCashflow)}`
          ]),
          buildItem("Customers and revenue quality", "Quantitative", [...ctx.customerBullets, ...ctx.financialGrowthBullets])
        ]),
        buildSection("operations", "Operations and Service Quality", "Execution on the network", [
          buildItem("Utilization and efficiency", "Quantitative", [...ctx.operationsBullets, ...ctx.efficiencyBullets]),
          buildItem("Fulfillment and customer experience", "Context", ctx.customerBullets)
        ]),
        buildSection("financials", "Financial Profile", "Core numbers", [
          buildItem("Margins and cash generation", "Quantitative", [...ctx.profitabilityBullets, ...ctx.cashflowBullets]),
          buildItem("Asset intensity and leverage", "Quantitative", ctx.balanceSheetBullets)
        ])
      ],
      deep: [
        buildSection("capital-allocation", "Capital Allocation and Asset Intensity", "Fleet and reinvestment", [
          buildItem("Balance sheet and reinvestment posture", "Quantitative", [...ctx.balanceSheetBullets, ...ctx.valuationBullets])
        ]),
        buildSection("competitive-position", "Competitive Position", "Network moat", [
          buildItem("Customer stickiness and network density", "Context", [
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null,
            ...ctx.peerSummary
          ])
        ]),
        buildSection("risks", "Risks", "Cyclicality and execution", [
          buildItem("Demand, pricing, and execution risks", "Risk", [...ctx.returnsBullets, ...ctx.riskBullets])
        ]),
        buildSection("regulatory", "Regulatory, Safety, and Sustainability", "Compliance layer", [
          buildItem("Geography and safety watchpoints", "Risk", [
            profile?.country ? `Primary country disclosure: ${profile.country}` : null,
            "Detailed safety incident, fuel-cost, and emissions disclosures are not available in structured form."
          ])
        ]),
        buildSection("investor-takeaways", "Investor Takeaways Summary", "What matters most", [
          buildItem("Catalysts and risks", "Context", [...ctx.catalystBullets, ...ctx.riskBullets])
        ])
      ]
    },
    space: {
      ...genericFramework,
      key: "space",
      label: "Space",
      subtitle: "Space company investor framework",
      baseLegend: "Fast-scan space-company context focused on mission role, customer mix, technical capabilities, and contract visibility.",
      deepLegend: "Serious-analysis space lens focused on technical moat, execution risk, capital needs, and strategic positioning.",
      base: [
        buildSection("snapshot", "Company Snapshot", "Space value-chain role", [
          buildItem("Identity and mission focus", "Context", ctx.snapshotBullets, profile?.summary),
          buildItem("Sub-sector tags and customer mix", "Context", ctx.businessBullets)
        ]),
        buildSection("mission-portfolio", "Products, Services, and Missions", "What it delivers", [
          buildItem("Product families and mission portfolio", "Context", [...ctx.businessBullets, ...ctx.peerSummary.slice(0, 4)]),
          buildItem("Customers and revenue quality", "Context", ctx.peerSummary)
        ]),
        buildSection("business-model", "Business Model", "Revenue cadence", [
          buildItem("Government, commercial, and recurring mix", "Context", [
            displayMeta?.category ? `Space segment: ${displayMeta.category}` : null,
            `Revenue: ${formatMoney(profile?.totalRevenue)}`,
            `Revenue growth: ${formatPercent(profile?.revenueGrowth)}`,
            profile?.earnings?.nextEarnings ? `Next update: ${formatDate(profile.earnings.nextEarnings)}` : null
          ]),
          buildItem("Contract visibility", "Quantitative", ctx.earningsSummary)
        ]),
        buildSection("technical-capabilities", "Technical Capabilities and Assets", "Engineering base", [
          buildItem("Assets, platforms, and operating footprint", "Quantitative", ctx.operationsBullets),
          buildItem("Execution and reliability signals", "Quantitative", ctx.efficiencyBullets)
        ]),
        buildSection("financials", "Financial Profile", "Core numbers", [
          buildItem("Growth, margins, and cash generation", "Quantitative", [...ctx.financialGrowthBullets, ...ctx.profitabilityBullets, ...ctx.cashflowBullets]),
          buildItem("Capital intensity and balance sheet", "Quantitative", ctx.balanceSheetBullets)
        ])
      ],
      deep: [
        buildSection("program-spend", "Capital Intensity and Program Spend", "Hardware and mission economics", [
          buildItem("Balance sheet capacity and asset spend", "Quantitative", [...ctx.balanceSheetBullets, ...ctx.valuationBullets])
        ]),
        buildSection("competitive-position", "Competitive Position", "Technical moat", [
          buildItem("Peer map and differentiation", "Context", [
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null,
            ...ctx.peerSummary
          ])
        ]),
        buildSection("policy", "Regulatory, Policy, and Security Exposure", "Jurisdiction and mission risk", [
          buildItem("Policy and compliance watchpoints", "Risk", [
            profile?.country ? `Primary country disclosure: ${profile.country}` : null,
            profile?.exchange ? `Exchange: ${profile.exchange}` : null,
            "Detailed launch licensing, export control, and spectrum-regulation disclosures are not available in structured form."
          ])
        ]),
        buildSection("risks", "Risks", "Execution and concentration", [
          buildItem("Key risk factors", "Risk", [...ctx.riskBullets, ...ctx.returnsBullets])
        ]),
        buildSection("investor-takeaways", "Investor Takeaways Summary", "What matters most", [
          buildItem("Catalysts and thesis markers", "Context", [...ctx.catalystBullets, ...ctx.riskBullets])
        ])
      ]
    },
    robotics: {
      ...genericFramework,
      key: "robotics",
      label: "Robotics",
      subtitle: "Robotics company investor framework",
      baseLegend: "Core robotics metrics across industrial, collaborative, service, and autonomous systems. Start here before deeper analysis.",
      deepLegend: "Structural differentiators, hardware-stack risks, software intelligence, and deployment dynamics unique to robotics.",
      base: [
        buildSection("robotics-model", "Business model & product lines", "What they sell & how", [
          buildItem("Revenue model breakdown", "Quantitative", [
            `Revenue: ${formatMoney(profile?.totalRevenue)}`,
            `Revenue growth: ${formatPercent(profile?.revenueGrowth)}`,
            `Gross margin: ${formatPercent(profile?.grossMargins)}`,
            displayMeta?.category ? `Robot taxonomy: ${displayMeta.category}` : null
          ], displayMeta?.role || profile?.summary),
          buildItem("End-market verticals", "Context", ctx.peerSummary, "End-market and customer-vertical detail is not available in structured form."),
          buildItem("Installed base & unit economics", "Quantitative", [
            profile?.employees != null ? `Employees: ${formatNumber(profile.employees)}` : null,
            `Free cash flow: ${formatMoney(profile?.freeCashflow)}`,
            `Operating cash flow: ${formatMoney(profile?.operatingCashflow)}`
          ])
        ]),
        buildSection("robotics-financials", "Financial performance", "Core numbers", [
          buildItem("Margin profile and path to profitability", "Quantitative", [...ctx.profitabilityBullets, ...ctx.cashflowBullets]),
          buildItem("R&D and recurring-quality proxies", "Quantitative", [...ctx.financialGrowthBullets, ...ctx.valuationBullets])
        ]),
        buildSection("robotics-technical", "Technical performance metrics", "Does the product actually work", [
          buildItem("Uptime, throughput, and efficiency", "Quantitative", [...ctx.operationsBullets, ...ctx.efficiencyBullets]),
          buildItem("Customer payback and deployment fit", "Context", ctx.customerBullets)
        ]),
        buildSection("robotics-moat", "Market position & moat", "Durability of advantage", [
          buildItem("Competitive landscape", "Context", ctx.peerSummary),
          buildItem("Ecosystem lock-in and safety credentials", "Context", [
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null,
            "Certification and systems-integration depth are not available in structured form from the current snapshot."
          ])
        ]),
        buildSection("robotics-governance", "Management & governance", "Leadership quality", [
          buildItem("Founding and leadership background", "Context", ctx.leadershipSummary),
          buildItem("Investor backing and capital structure proxies", "Quantitative", [...ctx.balanceSheetBullets, ...ctx.governanceBullets])
        ])
      ],
      deep: [
        buildSection("robotics-bom", "Hardware stack & BOM analysis", "What's inside & who owns it", [
          buildItem("Bill of materials concentration", "Risk", ctx.inputBullets),
          buildItem("Manufacturing & assembly strategy", "Context", ctx.operationsBullets)
        ]),
        buildSection("robotics-ai", "AI & software intelligence layer", "The brain inside the machine", [
          buildItem("Perception, autonomy, and proprietary data", "Strength", [
            displayMeta?.role || "Specific autonomy-stack detail is not available in structured form.",
            displayMeta?.edge || "Differentiated data or inference advantages were not captured in the catalog entry."
          ]),
          buildItem("Edge vs cloud economics", "Quantitative", [...ctx.cashflowBullets, ...ctx.returnsBullets])
        ]),
        buildSection("robotics-gtm", "Go-to-market & deployment model", "Sales motion & scaling", [
          buildItem("Sales motion and channel strategy", "Context", ctx.peerSummary),
          buildItem("Deployment complexity and land-and-expand signals", "Risk", [...ctx.customerBullets, ...ctx.efficiencyBullets])
        ]),
        buildSection("robotics-safety", "Safety, liability & regulatory risk", "Human-machine risk layer", [
          buildItem("Safety and regulatory exposure", "Risk", [
            profile?.country ? `Primary country disclosure: ${profile.country}` : null,
            "Detailed incident, insurance, and robotics-specific regulatory disclosures are not available in structured form."
          ])
        ]),
        buildSection("robotics-trends", "Long-cycle structural trends", "What's driving the 10-year thesis", [
          buildItem("Automation, reshoring, and secular demand", "Context", [...ctx.catalystBullets, ...ctx.riskBullets])
        ])
      ]
    },
    ai: {
      ...genericFramework,
      key: "ai",
      label: "Artificial Intelligence",
      subtitle: "AI company investor framework",
      baseLegend: "Universal AI metrics across model providers, AI SaaS, infrastructure, and applied-AI companies. Start here before deeper analysis.",
      deepLegend: "A deeper AI lens focused on model economics, inference costs, retention, data flywheels, and platform durability.",
      base: [
        buildSection("ai-model", "Business model & product architecture", "What they sell & how", [
          buildItem("AI company taxonomy", "Context", [
            displayMeta?.category ? `AI segment: ${displayMeta.category}` : null,
            displayMeta?.role ? `Role: ${displayMeta.role}` : null,
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null
          ], profile?.summary),
          buildItem("Revenue model breakdown", "Quantitative", [...ctx.financialGrowthBullets, ...ctx.cashflowBullets]),
          buildItem("Customer segments & use cases", "Context", ctx.peerSummary)
        ]),
        buildSection("ai-financials", "Financial performance", "Unit economics & growth", [
          buildItem("ARR, growth, and scale proxies", "Quantitative", [...ctx.financialGrowthBullets, ...ctx.valuationBullets]),
          buildItem("Gross margin and cost of inference proxies", "Quantitative", [...ctx.profitabilityBullets, ...ctx.balanceSheetBullets]),
          buildItem("Customer retention and expansion proxies", "Context", ctx.earningsSummary)
        ]),
        buildSection("ai-product", "Product performance & adoption", "Does usage compound", [
          buildItem("Adoption and product fit", "Context", ctx.customerBullets),
          buildItem("Operating reliability and throughput", "Quantitative", [...ctx.efficiencyBullets, ...ctx.operationsBullets])
        ]),
        buildSection("ai-moat", "Market position & moat", "Durability of advantage", [
          buildItem("Platform versus point-solution strength", "Context", [
            displayMeta?.edge ? `Catalog edge: ${displayMeta.edge}` : null,
            ...ctx.peerSummary
          ]),
          buildItem("Data flywheel and ecosystem lock-in", "Strength", [
            displayMeta?.role || "Specific model or workflow architecture details are not available in structured form.",
            "Developer ecosystem, API stickiness, and proprietary-data detail are not available in structured form from the current snapshot."
          ])
        ]),
        buildSection("ai-governance", "Management & governance", "Leadership quality", [
          buildItem("Leadership background", "Context", ctx.leadershipSummary),
          buildItem("Capital structure and governance", "Quantitative", [...ctx.governanceBullets, ...ctx.balanceSheetBullets])
        ])
      ],
      deep: [
        buildSection("ai-stack", "Model, data & infrastructure stack", "What powers the product", [
          buildItem("Model economics and data advantages", "Context", [
            displayMeta?.role || "Specific model-stack detail is not available in structured form.",
            displayMeta?.edge || "A differentiated data or infrastructure edge was not captured in the catalog entry."
          ]),
          buildItem("GPU, inference, and compute sensitivity", "Risk", [...ctx.cashflowBullets, ...ctx.balanceSheetBullets])
        ]),
        buildSection("ai-gtm", "Go-to-market & retention engine", "Sales motion & expansion", [
          buildItem("Customer mix and sales motion", "Context", ctx.peerSummary),
          buildItem("Retention and expansion signals", "Quantitative", [...ctx.earningsSummary, ...ctx.financialGrowthBullets])
        ]),
        buildSection("ai-regulation", "Safety, policy & model risk", "Regulatory exposure", [
          buildItem("AI governance and policy watchpoints", "Risk", [
            profile?.country ? `Primary country disclosure: ${profile.country}` : null,
            "Detailed model-risk, copyright, and AI-regulation disclosures are not available in structured form."
          ])
        ]),
        buildSection("ai-trends", "Long-cycle structural trends", "What's driving the thesis", [
          buildItem("Secular AI tailwinds and key risks", "Context", [...ctx.catalystBullets, ...ctx.riskBullets])
        ])
      ]
    }
  };

  return frameworks[frameworkKey] || genericFramework;
}

export function CompanyProfilePage({ symbol, asset, onBack }) {
  const normalizedSymbol = String(symbol || asset?.symbol || "").trim().toUpperCase();
  const preferredTheme = String(asset?.theme || "").trim();
  const preferredCategory = String(asset?.category || "").trim();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("base");
  const [openSections, setOpenSections] = useState(() => new Set());

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
      const cachedPayload = cached?.payload && typeof cached.payload === "object" ? cached.payload : null;

      if (cachedPayload) {
        setProfile(cachedPayload);
        if (cacheFresh && !cachedPayload?.stale && !cachedPayload?.unavailable) {
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
        if (cachedPayload?.companyProfileHash) params.set("snapshotHash", cachedPayload.companyProfileHash);
        const res = await fetch(`${BACKEND_URL}/company-profile?${params.toString()}`, { signal: controller.signal });
        const data = await res.json();
        if (controller.signal.aborted || cancelled) return;
        if (!res.ok || data?.error) {
          throw new Error(data?.error || `HTTP ${res.status}`);
        }
        if (data?.unchanged && cachedPayload) {
          const refreshedSnapshot = {
            ...cachedPayload,
            stale: false,
            unavailable: false,
            stale_reason: null,
            cache_updated_at: null,
            stale_age_seconds: null,
            snapshotCheckedAt: data?.snapshotCheckedAt || new Date().toISOString(),
            companyProfileHash: data?.companyProfileHash || cachedPayload.companyProfileHash
          };
          setProfile(refreshedSnapshot);
          writeResilientCache("company-profile", cacheParams, refreshedSnapshot);
        } else {
          setProfile(data);
          writeResilientCache("company-profile", cacheParams, data);
        }
      } catch (err) {
        if (controller.signal.aborted || cancelled) return;
        console.error("Failed to fetch company profile:", err);
        if (!cachedPayload) {
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

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    document.documentElement.classList.add("page-dark-theme");
    document.body.classList.add("page-dark-theme");
    return () => {
      document.documentElement.classList.remove("page-dark-theme");
      document.body.classList.remove("page-dark-theme");
    };
  }, []);

  const displayMeta = useMemo(() => ({
    theme: asset?.theme || profile?.catalog?.theme || null,
    category: asset?.category || profile?.catalog?.category || null,
    role: asset?.role || profile?.catalog?.role || null,
    edge: asset?.edge || profile?.catalog?.edge || null
  }), [asset, profile]);

  const companyName = asset?.name || profile?.name || normalizedSymbol;
  const primaryTag = displayMeta?.theme || displayMeta?.category || profile?.industry || "";
  const framework = useMemo(() => buildFrameworkSections(profile || {}, displayMeta), [profile, displayMeta]);
  const visibleSections = activeTab === "deep" ? framework.deep : framework.base;
  const earningsHistory = Array.isArray(profile?.earningsHistory) ? profile.earningsHistory : [];

  useEffect(() => {
    setOpenSections(new Set((framework.base || []).slice(0, 3).map((section) => section.key)));
  }, [framework]);

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
    <div className="page-shell page-shell-dark company-page">
      <div className="company-page-header">
        <button className="company-page-back" onClick={onBack} type="button">
          Back
        </button>
        <div className="company-page-title-wrap">
          <div className="company-page-kicker">{framework.subtitle}</div>
          <h1>{companyName}</h1>
          <div className="company-page-subtitle">
            {primaryTag ? <span>{primaryTag}</span> : null}
          </div>
          <p>
            {profile?.summary || "Public company profile information will appear here once the stock snapshot loads."}
          </p>
          {profile?.stale && profile?.statusMessage ? (
            <p className="company-page-fallback-note">{getSnapshotFallbackMessage(profile, profile.statusMessage)}</p>
          ) : null}
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
            {framework.baseTabLabel}
          </button>
          <button
            type="button"
            className={`company-page-tab ${activeTab === "deep" ? "active-deep" : ""}`}
            onClick={() => setActiveTab("deep")}
          >
            {framework.deepTabLabel}
          </button>
        </div>

        <div className="company-page-legend">
          {activeTab === "base" ? framework.baseLegend : framework.deepLegend}
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
