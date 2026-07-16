// Derive the launch summary from the user's onboarding answers + plan.
// Pure mapping — no business logic, no persistence. Used by both the
// personalization and workspace-ready stages so they stay consistent.
const MARKET_LABELS = {
  us_equities: "US Equities",
  equities: "Equities",
  crypto: "Crypto",
  macro: "Macro",
  options: "Options",
  bonds: "Bonds",
  commodities: "Commodities",
  fx: "FX",
};

const STYLE_LABELS = {
  growth: "Growth",
  value: "Value",
  macro: "Macro",
  trading: "Trading",
  dividends: "Income",
};

const MODULE_LABELS = {
  research: "Company Research",
  portfolio: "Portfolio",
  watchlists: "Watchlists",
  journal: "Journal",
  options: "Options Lab",
  collaboration: "Collaboration",
};

function asArray(v) {
  if (Array.isArray(v)) return v;
  return v == null || v === "" ? [] : [v];
}

function marketLabels(markets = []) {
  return asArray(markets).map((m) => MARKET_LABELS[m] || m).filter(Boolean);
}

export function deriveLaunchSummary(answers = {}, plan) {
  const markets = marketLabels(answers.markets);

  // Modules are derived from selections so returning users see what they chose.
  const modules = ["research", "portfolio", "watchlists", "journal"];
  if (markets.includes("Options") || asArray(answers.markets).includes("options")) modules.push("options");
  if (plan === "desk") modules.push("collaboration");

  const styles = asArray(answers.researchStyle).map((s) => STYLE_LABELS[s] || s).filter(Boolean);

  const portfolioMethod = answers.portfolio?.method;
  let portfolio = "Not imported";
  if (portfolioMethod === "sample") portfolio = "Sample portfolio";
  else if (portfolioMethod === "manual") portfolio = "Manual entry";
  else if (portfolioMethod === "broker") portfolio = "Brokerage (read-only SnapTrade link)";

  const watchlistCount = Array.isArray(answers.watchlists) ? answers.watchlists.length : 0;

  const preferences = [
    ["Timezone", answers.timezone || "Auto"],
    ["Currency", answers.currency || "USD"],
    ["Theme", "Dark"],
  ];

  return {
    name: answers.name,
    plan,
    markets,
    modules: modules.map((m) => MODULE_LABELS[m] || m),
    researchStyles: styles,
    portfolio,
    watchlistCount,
    preferences,
  };
}

export default deriveLaunchSummary;
