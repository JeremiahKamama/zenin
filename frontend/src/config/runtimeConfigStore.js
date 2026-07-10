const defaultPublicConfig = {
  auth: {
    passkeyProviders: [
      "Platform Authenticator",
      "iCloud Keychain",
      "Google Password Manager",
      "1Password",
      "Bitwarden"
    ],
    enableAppleOAuth: false
  },
  subscription: {
    validPlans: ["starter", "pro", "desk"],
    validBillingCycles: ["monthly", "yearly"],
    yearlyDiscountRate: 0.2,
    monthlyPrices: {
      starter: 0,
      pro: 29,
      desk: 99
    }
  }
};

const defaultAppConfig = {
  subscription: {
    validPlans: ["starter", "pro", "desk"],
    validBillingCycles: ["monthly", "yearly"],
    yearlyDiscountRate: 0.2,
    monthlyPrices: {
      starter: 0,
      pro: 29,
      desk: 99
    },
    planRank: {
      starter: 0,
      pro: 1,
      desk: 2
    },
    sectionMinPlan: {
      Home: "starter",
      Portfolio: "starter",
      Watchlist: "starter",
      Analytics: "pro",
      Journal: "pro",
      Options: "desk",
      Predictions: "desk",
      "Tax Estimator": "starter",
      Metrics: "pro"
    }
  },
  watchlist: {
    fallbackCategories: ["stocks", "crypto", "indicators", "commodities"],
    fallbackAssetsByCategory: {
      stocks: [],
      crypto: [],
      indicators: [],
      commodities: []
    }
  },
  auth: {
    authenticatorOptions: [
      "Google Authenticator",
      "Authy",
      "Microsoft Authenticator",
      "1Password",
      "Bitwarden"
    ],
    passkeyOptions: [
      "iCloud Keychain",
      "Google Password Manager",
      "1Password",
      "Dashlane",
      "Bitwarden"
    ]
  },
  connections: {
    venues: {
      cex: ["Binance", "Bybit", "Kraken", "OKX", "Coinbase Advanced"],
      dex: ["Hyperliquid", "dYdX", "Aevo", "Lyra", "Derive"],
      brokers: ["Interactive Brokers", "Alpaca", "Tradier", "Schwab", "Robinhood"],
      prediction: ["Polymarket", "Kalshi"]
    }
  },
  analytics: {
    macroCategoryOptions: [
      { key: "growth", label: "Growth" },
      { key: "inflation", label: "Inflation" },
      { key: "labor", label: "Labor" },
      { key: "rates", label: "Rates" },
      { key: "external", label: "External" },
      { key: "fiscal", label: "Fiscal" },
      { key: "credit", label: "Credit" },
      { key: "sentiment", label: "Sentiment" }
    ],
    macroViewOptions: [
      { key: "chart", label: "Chart" },
      { key: "compare", label: "Compare" },
      { key: "map", label: "Map" },
      { key: "calendar", label: "Calendar" },
      { key: "ranking", label: "Ranking" },
      { key: "forecast", label: "Forecast" }
    ],
    fallbackMacroGeos: [],
    fallbackMacroIndicators: [],
    allowedMacroIndicatorKeys: [
      "gdp_growth_rate",
      "interest_rate",
      "inflation_rate",
      "unemployment_rate",
      "consumer_confidence",
      "balance_of_trade",
      "cpi",
      "core_inflation_rate"
    ]
  },
  options: {
    supportedAssets: ["BTC", "ETH", "SOL", "HYPE"],
    rfqAssets: ["HYPE"],
    calculatorStrategies: [],
    emptyLeg: { strike: "", expiry: "", type: "call", direction: "long", qty: 1, premium: "", iv: "" },
    simulator: {
      views: [],
      timeHorizons: [],
      tierMeta: {},
      strategyLibrary: {}
    }
  },
  marketHours: {
    US: { open: 9.5, close: 16.0, tz: "America/New_York" },
    HK: { open: 9.5, close: 16.0, lunch: [12.0, 13.0], tz: "Asia/Hong_Kong" },
    JP: { open: 9.0, close: 15.0, lunch: [11.5, 12.5], tz: "Asia/Tokyo" },
    UK: { open: 8.0, close: 16.5, tz: "Europe/London" },
    DE: { open: 9.0, close: 17.5, tz: "Europe/Berlin" },
    FR: { open: 9.0, close: 17.5, tz: "Europe/Paris" },
    CN: { open: 9.5, close: 15.0, lunch: [11.5, 13.0], tz: "Asia/Shanghai" },
    AU: { open: 10.0, close: 16.0, tz: "Australia/Sydney" },
    CA: { open: 9.5, close: 16.0, tz: "America/Toronto" },
    IN: { open: 9.25, close: 15.5, tz: "Asia/Kolkata" }
  },
  ui: {
    moversHorizons: {
      daily: { label: "Daily", interval: "1D" },
      weekly: { label: "Weekly", interval: "1W" },
      quarterly: { label: "Quarterly", interval: "3M" },
      ytd: { label: "YTD", interval: "YTD" },
      yearly: { label: "Yearly", interval: "1Y" }
    },
    homeDisplayIntervals: ["1D", "1W", "1M", "3M", "1Y", "ALL"],
    assetModalIntervals: ["4H", "1D", "1W", "3M", "1Y", "YTD", "MAX"],
    portfolioIntervals: ["1D", "1W", "1M", "3M", "1Y", "YTD", "ALL"],
    indicatorMetricHorizons: [
      { key: "1Y", label: "1Y", years: 1 },
      { key: "3Y", label: "3Y", years: 3 },
      { key: "5Y", label: "5Y", years: 5 },
      { key: "10Y", label: "10Y", years: 10 },
      { key: "MAX", label: "MAX", years: null }
    ],
    g7Currencies: ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"]
  },
  currency: {
    symbols: {
      USD: "$",
      EUR: "EUR ",
      GBP: "GBP ",
      JPY: "JPY ",
      CAD: "CAD ",
      AUD: "AUD ",
      CHF: "CHF ",
      CNY: "CNY ",
      HKD: "HKD ",
      KRW: "KRW ",
      TWD: "TWD ",
      AED: "AED ",
      INR: "INR ",
      MXN: "MXN ",
      BRL: "BRL ",
      SGD: "SGD ",
      NZD: "NZD ",
      BTC: "BTC ",
      ETH: "ETH ",
      SOL: "SOL ",
      HYPE: "HYPE "
    },
    forexQuoteCurrency: {
      EURUSD: "USD",
      "EUR/USD": "USD",
      GBPUSD: "USD",
      "GBP/USD": "USD",
      AUDUSD: "USD",
      "AUD/USD": "USD",
      NZDUSD: "USD",
      "NZD/USD": "USD",
      USDJPY: "JPY",
      "USD/JPY": "JPY",
      USDCAD: "CAD",
      "USD/CAD": "CAD",
      USDCHF: "CHF",
      "USD/CHF": "CHF",
      EURGBP: "GBP",
      "EUR/GBP": "GBP",
      EURJPY: "JPY",
      "EUR/JPY": "JPY",
      GBPJPY: "JPY",
      "GBP/JPY": "JPY",
      "JPY=X": "JPY",
      "CAD=X": "CAD",
      "CHF=X": "CHF",
      "EURUSD=X": "USD",
      "GBPUSD=X": "USD",
      "AUDUSD=X": "USD",
      "NZDUSD=X": "USD",
      "EURGBP=X": "GBP",
      "EURJPY=X": "JPY",
      "GBPJPY=X": "JPY"
    },
    defaultFxRates: {
      USD: 1
    }
  },
  tax: {
    rules: {
      USA: { name: "United States", region: "Americas", currency: "USD" },
      Canada: { name: "Canada", region: "Americas", currency: "CAD" },
      Brazil: { name: "Brazil", region: "Americas", currency: "BRL" },
      UK: { name: "United Kingdom", region: "Europe", currency: "GBP" },
      Germany: { name: "Germany", region: "Europe", currency: "EUR" },
      France: { name: "France", region: "Europe", currency: "EUR" },
      Spain: { name: "Spain", region: "Europe", currency: "EUR" },
      UAE: { name: "United Arab Emirates", region: "Middle East", currency: "AED" },
      Kenya: { name: "Kenya", region: "Africa", currency: "KES" },
      SouthAfrica: { name: "South Africa", region: "Africa", currency: "ZAR" },
      Singapore: { name: "Singapore", region: "South East Asia", currency: "SGD" },
      India: { name: "India", region: "Asia", currency: "INR" }
    },
    regions: ["Americas", "Europe", "Middle East", "South East Asia", "Asia", "Africa"],
    lastUpdated: "2024/25",
    sources: [],
    defaultIncomeBreakdown: {
      salary: 0,
      dividends: 0,
      interest: 0,
      stakingRewards: 0,
      airdrops: 0,
      otherOrdinaryIncome: 0
    }
  }
};

let currentPublicConfig = JSON.parse(JSON.stringify(defaultPublicConfig));
let currentAppConfig = JSON.parse(JSON.stringify(defaultAppConfig));

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getDefaultPublicRuntimeConfig() {
  return clone(defaultPublicConfig);
}

export function getDefaultAppRuntimeConfig() {
  return clone(defaultAppConfig);
}

export function getPublicRuntimeConfig() {
  return currentPublicConfig;
}

export function getAppRuntimeConfig() {
  return currentAppConfig;
}

export function setRuntimeConfigs({ publicConfig, appConfig } = {}) {
  if (publicConfig && typeof publicConfig === "object") {
    currentPublicConfig = clone(publicConfig);
  }
  if (appConfig && typeof appConfig === "object") {
    currentAppConfig = clone(appConfig);
  }
}
