// TransmissionRegistry — canonical publisher taxonomy, node types, and horizons.
// Single source of truth for WHO publishes signals and WHAT horizons exist.
// Brand v2: monochrome; no decoration.

// Signal publishers by workspace (task Part 1).
export const TRANSMISSION_PUBLISHERS = {
  MACRO: {
    id: "MACRO", label: "Macro", kind: "source",
    signals: ["Inflation", "Rates", "Liquidity", "Employment", "Growth", "PMI", "Dollar", "Credit", "Yield Curve", "Policy", "Volatility"],
  },
  COMMODITY: {
    id: "COMMODITY", label: "Commodity Desk", kind: "source",
    signals: ["Energy", "Industrial Metals", "Precious Metals", "Agriculture", "Weather", "Inventory", "Supply", "Demand", "Curve", "Seasonality"],
  },
  EQUITIES: {
    id: "EQUITIES", label: "Equities", kind: "source",
    signals: ["Sector Rotation", "Momentum", "Breadth", "Valuation", "Leadership", "Earnings", "Volatility"],
  },
  PORTFOLIO: {
    id: "PORTFOLIO", label: "Portfolio", kind: "consumer",
    signals: ["Sector Exposure", "Commodity Exposure", "Country Exposure", "Currency Exposure", "Duration", "Factor Exposure", "Concentration"],
  },
  RESEARCH: {
    id: "RESEARCH", label: "Research Workspace", kind: "destination",
    signals: ["Catalysts", "Risks", "Thesis", "Confidence", "Decision Context"],
  },
  COMPANY: {
    id: "COMPANY", label: "Company Profile", kind: "destination",
    signals: ["Commodity Sensitivity", "Country Sensitivity", "Rate Sensitivity", "Inflation Sensitivity", "FX Sensitivity"],
  },
};

// Node types used in the graph (affects rendering + affected-dimension routing).
export const NODE_TYPES = {
  FACTOR: "factor",       // macro/commodity drivers: Oil, Inflation, Rates
  SECTOR: "sector",       // Technology, Industrials, Energy
  COUNTRY: "country",     // United States, Australia, Germany
  COMMODITY: "commodity", // Copper, WTI, Gold
  COMPANY: "company",     // AAPL, Mining Co
  ASSET: "asset",         // ETFs, single names
  PORTFOLIO: "portfolio", // the user's book
};

// Transmission Horizons — metadata only, never a standalone page.
export const TRANSMISSION_HORIZONS = {
  IMMEDIATE: { id: "IMMEDIATE", label: "Immediate", window: "Hours–Days", order: 0 },
  SHORT_TERM: { id: "SHORT_TERM", label: "Short-Term", window: "Days–Weeks", order: 1 },
  MEDIUM_TERM: { id: "MEDIUM_TERM", label: "Medium-Term", window: "Weeks–Months", order: 2 },
  STRUCTURAL: { id: "STRUCTURAL", label: "Structural", window: "Months–Years", order: 3 },
};

export const HORIZON_ORDER = ["IMMEDIATE", "SHORT_TERM", "MEDIUM_TERM", "STRUCTURAL"];

export function horizonLabel(id) {
  return TRANSMISSION_HORIZONS[id]?.label || id;
}
export function horizonWindow(id) {
  return TRANSMISSION_HORIZONS[id]?.window || "";
}

// Star rating (1-5) from a 0-100 confidence — used in compact chips.
export function confidenceStars(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c)) return 0;
  return Math.max(1, Math.min(5, Math.round(c / 20)));
}

export function publisherLabel(id) {
  return TRANSMISSION_PUBLISHERS[id]?.label || String(id || "Unknown");
}
