// Onboarding domain types (spec v1).
// JSX implementation; mirrors the schema-driven engine contract.

export const ONBOARDING_PLANS = ["starter", "pro", "desk"];

export const ONBOARDING_STEPS = {
  WELCOME: "welcome",
  ACCOUNT_PROFILE: "account_profile",
  INVESTOR_TYPE: "investor_type",
  MARKETS: "markets",
  PORTFOLIO: "portfolio",
  NOTIFICATIONS: "notifications",
  RESEARCH_PREFERENCES: "research_preferences",
  ORGANIZATION: "organization",
  TEAM_SETUP: "team_setup",
  PROVISIONING: "provisioning",
  COMPLETION: "completion",
};

export const INVESTOR_TYPES = [
  "individual_investor",
  "long_term_investor",
  "active_trader",
  "research_analyst",
  "financial_advisor",
  "family_office",
  "investment_team",
];

// Keys persisted into the workspace configuration object (answers map).
export const ONBOARDING_FIELDS = {
  name: "name",
  timezone: "timezone",
  country: "country",
  currency: "currency",
  persona: "persona",
  markets: "markets",
  portfolio: "portfolio",
  notifications: "notifications",
  researchStyle: "researchStyle",
  horizon: "horizon",
  layout: "layout",
  watchlistImport: "watchlistImport",
  workspaceName: "workspaceName",
  organization: "organization",
  logo: "logo",
  industry: "industry",
  team: "team",
  permissions: "permissions",
  defaults: "defaults",
};

// Where each plan lands when onboarding completes.
export const PLAN_COMPLETION_ROUTE = {
  starter: "/app/dashboard",
  pro: "/app/research",
  desk: "/app/desk",
};
