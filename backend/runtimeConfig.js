const PUBLIC_RUNTIME_CONFIG = {
  auth: {
    passkeyProviders: [
      'Platform Authenticator',
      'iCloud Keychain',
      'Google Password Manager',
      '1Password',
      'Bitwarden'
    ],
    enableAppleOAuth: false
  },
  subscription: {
    validPlans: ['starter', 'pro', 'desk'],
    validBillingCycles: ['monthly', 'yearly'],
    yearlyDiscountRate: 0.2,
    monthlyPrices: {
      starter: 0,
      pro: 29,
      desk: 99
    }
  }
};

const APP_RUNTIME_CONFIG = {
  subscription: {
    validPlans: ['starter', 'pro', 'desk'],
    validBillingCycles: ['monthly', 'yearly'],
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
      Home: 'starter',
      Portfolio: 'starter',
      Watchlist: 'starter',
      Analytics: 'pro',
      Journal: 'pro',
      Options: 'desk',
      Predictions: 'desk',
      'Tax Estimator': 'starter',
      Metrics: 'pro'
    }
  },
  watchlist: {
    fallbackCategories: ['stocks', 'crypto', 'indicators', 'commodities'],
    fallbackAssetsByCategory: {
      stocks: [
        { symbol: 'AAPL', name: 'Apple Inc.', type: 'stock', marketType: 'equity', category: 'stocks', theme: 'Mega Cap Tech' },
        { symbol: 'MSFT', name: 'Microsoft Corporation', type: 'stock', marketType: 'equity', category: 'stocks', theme: 'Mega Cap Tech' },
        { symbol: 'NVDA', name: 'NVIDIA Corporation', type: 'stock', marketType: 'equity', category: 'stocks', theme: 'AI Infrastructure' },
        { symbol: 'HIMS', name: 'Hims & Hers Health', type: 'stock', marketType: 'equity', category: 'stocks', theme: 'Digital Health' }
      ],
      crypto: [
        { symbol: 'BTC', name: 'Bitcoin', type: 'crypto', marketType: 'spot', category: 'crypto' },
        { symbol: 'ETH', name: 'Ethereum', type: 'crypto', marketType: 'spot', category: 'crypto' },
        { symbol: 'SOL', name: 'Solana', type: 'crypto', marketType: 'spot', category: 'crypto' }
      ],
      indicators: [
        { symbol: 'USA', name: 'United States', type: 'indicator', marketType: 'macro', category: 'indicators', country: 'USA' },
        { symbol: 'DEU', name: 'Germany', type: 'indicator', marketType: 'macro', category: 'indicators', country: 'DEU' },
        { symbol: 'JPN', name: 'Japan', type: 'indicator', marketType: 'macro', category: 'indicators', country: 'JPN' }
      ],
      commodities: [
        { symbol: 'WTI', name: 'WTI Crude Oil', type: 'commodity', marketType: 'futures', category: 'commodities' },
        { symbol: 'BRENT', name: 'Brent Crude Oil', type: 'commodity', marketType: 'futures', category: 'commodities' },
        { symbol: 'NG', name: 'Natural Gas', type: 'commodity', marketType: 'futures', category: 'commodities' }
      ]
    }
  },
  auth: {
    authenticatorOptions: [
      'Google Authenticator',
      'Authy',
      'Microsoft Authenticator',
      '1Password',
      'Bitwarden'
    ],
    passkeyOptions: [
      'iCloud Keychain',
      'Google Password Manager',
      '1Password',
      'Dashlane',
      'Bitwarden'
    ]
  },
  connections: {
    venues: {
      cex: ['Binance', 'Bybit', 'Kraken', 'OKX', 'Coinbase Advanced'],
      dex: ['Hyperliquid', 'dYdX', 'Aevo', 'Lyra', 'Derive'],
      brokers: ['Interactive Brokers', 'Alpaca', 'Tradier', 'Schwab', 'Robinhood'],
      prediction: ['Polymarket', 'Kalshi']
    }
  },
  analytics: {
    macroCategoryOptions: [
      { key: 'growth', label: 'Growth' },
      { key: 'inflation', label: 'Inflation' },
      { key: 'labor', label: 'Labor' },
      { key: 'rates', label: 'Rates' },
      { key: 'external', label: 'External' },
      { key: 'fiscal', label: 'Fiscal' },
      { key: 'credit', label: 'Credit' },
      { key: 'sentiment', label: 'Sentiment' }
    ],
    macroViewOptions: [
      { key: 'chart', label: 'Chart' },
      { key: 'compare', label: 'Compare' },
      { key: 'map', label: 'Map' },
      { key: 'calendar', label: 'Calendar' },
      { key: 'ranking', label: 'Ranking' },
      { key: 'forecast', label: 'Forecast' }
    ],
    fallbackMacroGeos: [
      { type: 'Country', name: 'United States', code: 'USA', regionCode: 'NAM', members: [], parent: 'Global' },
      { type: 'Country', name: 'Germany', code: 'DEU', regionCode: 'EUR', members: [], parent: 'Europe' },
      { type: 'Country', name: 'Japan', code: 'JPN', regionCode: 'ASI', members: [], parent: 'Asia' },
      { type: 'Country', name: 'Kenya', code: 'KEN', regionCode: 'AFR', members: [], parent: 'Africa' },
      { type: 'Region', name: 'North America', code: 'NAM', members: ['USA', 'CAN', 'MEX'], parent: 'Global' },
      { type: 'Region', name: 'Europe', code: 'EUR', members: ['DEU', 'FRA', 'ITA'], parent: 'Global' },
      { type: 'Region', name: 'Asia', code: 'ASI', members: ['JPN', 'CHN', 'IND'], parent: 'Global' },
      { type: 'Global', name: 'Global Aggregate', code: 'GLB', members: [], parent: null }
    ],
    fallbackMacroIndicators: [
      { code: 'GDP_GROWTH_YOY', name: 'GDP Growth YoY', category: 'growth', unit: '%' },
      { code: 'CPI_YOY', name: 'CPI Inflation YoY', category: 'inflation', unit: '%' },
      { code: 'UNEMP_RATE', name: 'Unemployment Rate', category: 'labor', unit: '%' },
      { code: 'POLICY_RATE', name: 'Policy Rate', category: 'rates', unit: '%' },
      { code: 'PMI_MANUFACTURING', name: 'Manufacturing PMI', category: 'sentiment', unit: 'idx' }
    ],
    allowedMacroIndicatorKeys: [
      'gdp_growth_rate',
      'interest_rate',
      'inflation_rate',
      'unemployment_rate',
      'consumer_confidence',
      'balance_of_trade',
      'cpi',
      'core_inflation_rate'
    ]
  },
  options: {
    supportedAssets: ['BTC', 'ETH', 'SOL', 'HYPE'],
    rfqAssets: ['HYPE'],
    calculatorStrategies: [
      { name: 'Long Call', legs: [{ type: 'call', direction: 'long', qty: 1 }] },
      { name: 'Short Call', legs: [{ type: 'call', direction: 'short', qty: 1 }] },
      { name: 'Long Put', legs: [{ type: 'put', direction: 'long', qty: 1 }] },
      { name: 'Short Put', legs: [{ type: 'put', direction: 'short', qty: 1 }] },
      { name: 'Call Spread', legs: [{ type: 'call', direction: 'long', qty: 1 }, { type: 'call', direction: 'short', qty: 1 }] },
      { name: 'Put Spread', legs: [{ type: 'put', direction: 'long', qty: 1 }, { type: 'put', direction: 'short', qty: 1 }] },
      { name: 'Credit Call Spread', legs: [{ type: 'call', direction: 'short', qty: 1 }, { type: 'call', direction: 'long', qty: 1 }] },
      { name: 'Credit Put Spread', legs: [{ type: 'put', direction: 'short', qty: 1 }, { type: 'put', direction: 'long', qty: 1 }] },
      { name: 'Long Straddle', legs: [{ type: 'call', direction: 'long', qty: 1 }, { type: 'put', direction: 'long', qty: 1 }] },
      { name: 'Short Straddle', legs: [{ type: 'call', direction: 'short', qty: 1 }, { type: 'put', direction: 'short', qty: 1 }] },
      { name: 'Long Strangle', legs: [{ type: 'call', direction: 'long', qty: 1 }, { type: 'put', direction: 'long', qty: 1 }] },
      { name: 'Short Strangle', legs: [{ type: 'call', direction: 'short', qty: 1 }, { type: 'put', direction: 'short', qty: 1 }] },
      { name: 'Iron Condor', legs: [{ type: 'put', direction: 'long', qty: 1 }, { type: 'put', direction: 'short', qty: 1 }, { type: 'call', direction: 'short', qty: 1 }, { type: 'call', direction: 'long', qty: 1 }] },
      { name: 'Iron Butterfly', legs: [{ type: 'put', direction: 'long', qty: 1 }, { type: 'put', direction: 'short', qty: 1 }, { type: 'call', direction: 'short', qty: 1 }, { type: 'call', direction: 'long', qty: 1 }] },
      { name: 'Long Calendar', legs: [{ type: 'call', direction: 'short', qty: 1 }, { type: 'call', direction: 'long', qty: 1 }] },
      { name: 'Short Calendar', legs: [{ type: 'call', direction: 'long', qty: 1 }, { type: 'call', direction: 'short', qty: 1 }] },
      { name: 'Ratio Call Spread', legs: [{ type: 'call', direction: 'long', qty: 1 }, { type: 'call', direction: 'short', qty: 2 }] },
      { name: 'Ratio Put Spread', legs: [{ type: 'put', direction: 'long', qty: 1 }, { type: 'put', direction: 'short', qty: 2 }] }
    ],
    emptyLeg: { strike: '', expiry: '', type: 'call', direction: 'long', qty: 1, premium: '', iv: '' },
    simulator: {
      views: [
        { id: 'bullish', label: 'Asset will rise', desc: 'Directional upside view', type: 'bullish' },
        { id: 'bearish', label: 'Asset will fall', desc: 'Directional downside view', type: 'bearish' },
        { id: 'protect', label: 'Protect a position', desc: 'Hedge an existing long or short', type: 'protect' },
        { id: 'rangebound', label: 'Price stays in range', desc: 'Sideways / consolidation view', type: 'rangebound' },
        { id: 'breakout', label: 'Big move coming', desc: 'Direction unknown - vol play', type: 'breakout' }
      ],
      timeHorizons: [
        { id: 'short', label: 'Short-term', sub: '< 1 week', days: 5 },
        { id: 'medium', label: 'Near-term', sub: '1-4 weeks', days: 21 },
        { id: 'long', label: 'Medium-term', sub: '1-3 months', days: 75 },
        { id: 'leaps', label: 'Long-term', sub: '3-12 months', days: 270 }
      ],
      tierMeta: {
        high: { label: 'High probability', sub: '65-85% win rate', color: '#22c55e', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.28)' },
        medium: { label: 'Moderate probability', sub: '40-65% win rate', color: '#f59e0b', bg: 'rgba(245,158,11,0.10)', border: 'rgba(245,158,11,0.28)' },
        speculative: { label: 'Speculative', sub: '20-40% win rate', color: '#38bdf8', bg: 'rgba(56,189,248,0.10)', border: 'rgba(56,189,248,0.28)' }
      },
      strategyLibrary: {
        bullish: [
          { name: 'Covered Call', tier: 'high', horizons: ['medium', 'long', 'leaps'], payoffLabel: 'Income + capped upside', summary: 'Hold spot and sell OTM calls to earn yield.', legs: 'Long 1x spot + Short 1x OTM call', greeks: { delta: 0.65, gamma: -0.001, theta: 0.12, vega: -0.05 } },
          { name: 'Bull Put Spread', tier: 'high', horizons: ['short', 'medium', 'long'], payoffLabel: 'Limited risk income', summary: 'Sell OTM put, buy further OTM put for protection.', legs: 'Short 1x higher-strike put + Long 1x lower-strike put', greeks: { delta: 0.35, gamma: -0.004, theta: 0.08, vega: -0.04 } },
          { name: 'Bull Call Spread', tier: 'medium', horizons: ['short', 'medium', 'long'], payoffLabel: 'Defined-risk upside', summary: 'Buy lower-strike call, sell higher-strike call.', legs: 'Long 1x lower-strike call + Short 1x higher-strike call', greeks: { delta: 0.42, gamma: 0.002, theta: -0.05, vega: 0.08 } },
          { name: 'Long Call Butterfly', tier: 'medium', horizons: ['medium', 'long'], payoffLabel: 'Neutral-Bullish pin', summary: 'Long 1x lower call, Short 2x ATM call, Long 1x higher call.', legs: 'Long 1x Call(A) + Short 2x Call(B) + Long 1x Call(C)', greeks: { delta: 0.05, gamma: -0.012, theta: 0.15, vega: -0.10 } },
          { name: 'Long Call', tier: 'speculative', horizons: ['short', 'medium', 'long', 'leaps'], payoffLabel: 'Leveraged upside', summary: 'Pure upside convexity, loss capped at premium.', legs: 'Long 1x ATM/OTM call', greeks: { delta: 0.55, gamma: 0.015, theta: -0.18, vega: 0.22 } }
        ],
        bearish: [
          { name: 'Bear Call Spread', tier: 'high', horizons: ['short', 'medium', 'long'], payoffLabel: 'Limited risk income', summary: 'Sell OTM call, buy further OTM call for protection.', legs: 'Short 1x lower-strike call + Long 1x higher-strike call', greeks: { delta: -0.32, gamma: -0.003, theta: 0.10, vega: -0.06 } },
          { name: 'Bear Put Spread', tier: 'medium', horizons: ['short', 'medium', 'long'], payoffLabel: 'Defined-risk downside', summary: 'Buy higher-strike put, sell lower-strike put.', legs: 'Long 1x higher-strike put + Short 1x lower-strike put', greeks: { delta: -0.45, gamma: 0.004, theta: -0.06, vega: 0.09 } },
          { name: 'Long Put Butterfly', tier: 'medium', horizons: ['medium', 'long'], payoffLabel: 'Bearish pin', summary: 'Long 1x higher put, Short 2x middle put, Long 1x lower put.', legs: 'Long 1x Put(A) + Short 2x Put(B) + Long 1x Put(C)', greeks: { delta: -0.08, gamma: -0.011, theta: 0.13, vega: -0.09 } },
          { name: 'Long Put', tier: 'speculative', horizons: ['short', 'medium', 'long', 'leaps'], payoffLabel: 'Leveraged downside', summary: 'Pure downside convexity, loss capped at premium.', legs: 'Long 1x ATM/OTM put', greeks: { delta: -0.52, gamma: 0.014, theta: -0.17, vega: 0.20 } }
        ],
        protect: [
          { name: 'Protective Put', tier: 'high', horizons: ['short', 'medium', 'long'], payoffLabel: 'Floor under long spot', summary: 'Own spot and buy put protection.', legs: 'Long 1x spot + Long 1x put', greeks: { delta: 0.70, gamma: 0.002, theta: -0.12, vega: 0.10 } },
          { name: 'Collar', tier: 'high', horizons: ['medium', 'long'], payoffLabel: 'Capped upside + downside floor', summary: 'Own spot, buy put, sell call to finance hedge.', legs: 'Long spot + Long put + Short call', greeks: { delta: 0.45, gamma: 0.000, theta: 0.03, vega: 0.02 } },
          { name: 'Put Spread Collar', tier: 'medium', horizons: ['medium', 'long'], payoffLabel: 'Cheaper defined hedge', summary: 'Buy put spread and sell call against spot.', legs: 'Long spot + Long put + Short lower put + Short call', greeks: { delta: 0.40, gamma: -0.002, theta: 0.05, vega: -0.01 } }
        ],
        rangebound: [
          { name: 'Iron Condor', tier: 'high', horizons: ['short', 'medium'], payoffLabel: 'Collect premium in a range', summary: 'Sell OTM put spread and OTM call spread.', legs: 'Long put wing + Short put + Short call + Long call wing', greeks: { delta: 0.00, gamma: -0.010, theta: 0.18, vega: -0.12 } },
          { name: 'Short Strangle', tier: 'medium', horizons: ['short', 'medium'], payoffLabel: 'Wide premium harvest', summary: 'Sell OTM call and OTM put with undefined risk.', legs: 'Short 1x OTM call + Short 1x OTM put', greeks: { delta: 0.00, gamma: -0.014, theta: 0.22, vega: -0.15 } },
          { name: 'Iron Butterfly', tier: 'medium', horizons: ['short', 'medium'], payoffLabel: 'Tighter range pin', summary: 'Short ATM straddle with OTM wings.', legs: 'Long put wing + Short ATM put + Short ATM call + Long call wing', greeks: { delta: 0.00, gamma: -0.018, theta: 0.25, vega: -0.17 } }
        ],
        breakout: [
          { name: 'Long Straddle', tier: 'high', horizons: ['short', 'medium'], payoffLabel: 'Convex long vol', summary: 'Buy call and put at the same strike to express a big move.', legs: 'Long 1x ATM call + Long 1x ATM put', greeks: { delta: 0.00, gamma: 0.020, theta: -0.25, vega: 0.30 } },
          { name: 'Long Strangle', tier: 'medium', horizons: ['short', 'medium'], payoffLabel: 'Cheaper long vol', summary: 'Buy OTM call and OTM put for a large move.', legs: 'Long 1x OTM call + Long 1x OTM put', greeks: { delta: 0.00, gamma: 0.014, theta: -0.18, vega: 0.24 } },
          { name: 'Call Calendar', tier: 'medium', horizons: ['medium', 'long'], payoffLabel: 'Event vol expression', summary: 'Sell near-term call, buy longer-dated call at same strike.', legs: 'Short near call + Long far call', greeks: { delta: 0.12, gamma: 0.002, theta: 0.04, vega: 0.18 } }
        ]
      }
    }
  },
  marketHours: {
    US: { open: 9.5, close: 16.0, tz: 'America/New_York' },
    HK: { open: 9.5, close: 16.0, lunch: [12.0, 13.0], tz: 'Asia/Hong_Kong' },
    JP: { open: 9.0, close: 15.0, lunch: [11.5, 12.5], tz: 'Asia/Tokyo' },
    UK: { open: 8.0, close: 16.5, tz: 'Europe/London' },
    DE: { open: 9.0, close: 17.5, tz: 'Europe/Berlin' },
    FR: { open: 9.0, close: 17.5, tz: 'Europe/Paris' },
    CN: { open: 9.5, close: 15.0, lunch: [11.5, 13.0], tz: 'Asia/Shanghai' },
    AU: { open: 10.0, close: 16.0, tz: 'Australia/Sydney' },
    CA: { open: 9.5, close: 16.0, tz: 'America/Toronto' },
    IN: { open: 9.25, close: 15.5, tz: 'Asia/Kolkata' }
  },
  ui: {
    moversHorizons: {
      daily: { label: 'Daily', interval: '1D' },
      weekly: { label: 'Weekly', interval: '1W' },
      quarterly: { label: 'Quarterly', interval: '3M' },
      ytd: { label: 'YTD', interval: 'YTD' },
      yearly: { label: 'Yearly', interval: '1Y' }
    },
    homeDisplayIntervals: ['1D', '1W', '1M', '3M', '1Y', 'ALL'],
    assetModalIntervals: ['4H', '1D', '1W', '3M', '1Y', 'YTD', 'MAX'],
    portfolioIntervals: ['1D', '1W', '1M', '3M', '1Y', 'YTD', 'ALL'],
    indicatorMetricHorizons: [
      { key: '1Y', label: '1Y', years: 1 },
      { key: '3Y', label: '3Y', years: 3 },
      { key: '5Y', label: '5Y', years: 5 },
      { key: '10Y', label: '10Y', years: 10 },
      { key: 'MAX', label: 'MAX', years: null }
    ],
    g7Currencies: ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF']
  },
  currency: {
    symbols: {
      USD: '$',
      EUR: 'EUR ',
      GBP: 'GBP ',
      JPY: 'JPY ',
      CAD: 'CAD ',
      AUD: 'AUD ',
      CHF: 'CHF ',
      CNY: 'CNY ',
      HKD: 'HKD ',
      KRW: 'KRW ',
      TWD: 'TWD ',
      AED: 'AED ',
      INR: 'INR ',
      MXN: 'MXN ',
      BRL: 'BRL ',
      SGD: 'SGD ',
      NZD: 'NZD ',
      BTC: 'BTC ',
      ETH: 'ETH ',
      SOL: 'SOL ',
      HYPE: 'HYPE '
    },
    forexQuoteCurrency: {
      EURUSD: 'USD',
      'EUR/USD': 'USD',
      GBPUSD: 'USD',
      'GBP/USD': 'USD',
      AUDUSD: 'USD',
      'AUD/USD': 'USD',
      NZDUSD: 'USD',
      'NZD/USD': 'USD',
      USDJPY: 'JPY',
      'USD/JPY': 'JPY',
      USDCAD: 'CAD',
      'USD/CAD': 'CAD',
      USDCHF: 'CHF',
      'USD/CHF': 'CHF',
      EURGBP: 'GBP',
      'EUR/GBP': 'GBP',
      EURJPY: 'JPY',
      'EUR/JPY': 'JPY',
      GBPJPY: 'JPY',
      'GBP/JPY': 'JPY',
      'JPY=X': 'JPY',
      'CAD=X': 'CAD',
      'CHF=X': 'CHF',
      'EURUSD=X': 'USD',
      'GBPUSD=X': 'USD',
      'AUDUSD=X': 'USD',
      'NZDUSD=X': 'USD',
      'EURGBP=X': 'GBP',
      'EURJPY=X': 'JPY',
      'GBPJPY=X': 'JPY'
    },
    defaultFxRates: {
      USD: 1.0,
      EUR: 1.09,
      GBP: 1.27,
      JPY: 0.0066,
      CAD: 0.74,
      AUD: 0.65,
      CHF: 1.13,
      CNY: 0.14,
      BTC: 65000,
      ETH: 3500,
      SOL: 140
    }
  },
  tax: {
    rules: {
      USA: { name: 'United States', region: 'Americas', currency: 'USD', cgRate: 0.20, stRate: 0.37, logic: 'LTCG: 20%, STCG: 37%' },
      Brazil: { name: 'Brazil', region: 'Americas', currency: 'BRL', cgRate: 0.15, stRate: 0.15, logic: 'Flat: 15-22.5%' },
      Canada: { name: 'Canada', region: 'Americas', currency: 'CAD', cgRate: 0.2656, stRate: 0.2656, logic: '50% inclusion, top effective ~26.56%' },
      UK: { name: 'United Kingdom', region: 'Europe', currency: 'GBP', cgRate: 0.24, stRate: 0.24, logic: 'CGT Higher Rate: 24%' },
      Germany: { name: 'Germany', region: 'Europe', currency: 'EUR', cgRate: 0.26375, stRate: 0.26375, logic: 'Abgeltungsteuer: 26.375%' },
      France: { name: 'France', region: 'Europe', currency: 'EUR', cgRate: 0.30, stRate: 0.30, logic: 'Flat Rate PFU: 30%' },
      Spain: { name: 'Spain', region: 'Europe', currency: 'EUR', cgRate: 0.26, stRate: 0.26, logic: 'Savings Tax: 19-26%' },
      Italy: { name: 'Italy', region: 'Europe', currency: 'EUR', cgRate: 0.26, stRate: 0.26, logic: 'Imposta Sostitutiva: 26%' },
      Netherlands: { name: 'Netherlands', region: 'Europe', currency: 'EUR', cgRate: 0.32, stRate: 0.32, logic: 'Box 3 Deemed Return ~32%' },
      Portugal: { name: 'Portugal', region: 'Europe', currency: 'EUR', cgRate: 0.28, stRate: 0.28, logic: 'Flat Rate: 28%' },
      Switzerland: { name: 'Switzerland', region: 'Europe', currency: 'CHF', cgRate: 0.0, stRate: 0.0, logic: 'Capital Gains: 0% (private investors)' },
      UAE: { name: 'United Arab Emirates', region: 'Middle East', currency: 'AED', cgRate: 0.0, stRate: 0.0, logic: 'Personal CGT: 0%' },
      SaudiArabia: { name: 'Saudi Arabia', region: 'Middle East', currency: 'SAR', cgRate: 0.0, stRate: 0.0, logic: 'Personal CGT: 0%' },
      Qatar: { name: 'Qatar', region: 'Middle East', currency: 'QAR', cgRate: 0.0, stRate: 0.0, logic: 'Personal CGT: 0%' },
      Bahrain: { name: 'Bahrain', region: 'Middle East', currency: 'BHD', cgRate: 0.0, stRate: 0.0, logic: 'Personal CGT: 0%' },
      Oman: { name: 'Oman', region: 'Middle East', currency: 'OMR', cgRate: 0.0, stRate: 0.0, logic: 'Personal CGT: 0%' },
      Singapore: { name: 'Singapore', region: 'South East Asia', currency: 'SGD', cgRate: 0.0, stRate: 0.0, logic: 'No CGT for individuals' },
      Malaysia: { name: 'Malaysia', region: 'South East Asia', currency: 'MYR', cgRate: 0.30, stRate: 0.30, logic: 'RPGT: 30% for disposal within 5 yrs' },
      Indonesia: { name: 'Indonesia', region: 'South East Asia', currency: 'IDR', cgRate: 0.10, stRate: 0.10, logic: 'Final Tax on listings: 0.1%; general: 10%' },
      Thailand: { name: 'Thailand', region: 'South East Asia', currency: 'THB', cgRate: 0.15, stRate: 0.15, logic: 'Withholding Tax: ~15%' },
      Vietnam: { name: 'Vietnam', region: 'South East Asia', currency: 'VND', cgRate: 0.20, stRate: 0.20, logic: 'Securities Transfer Tax: 0.1%; CIT: 20%' },
      Philippines: { name: 'Philippines', region: 'South East Asia', currency: 'PHP', cgRate: 0.15, stRate: 0.15, logic: 'Final Tax: 15% on net gains' },
      India: { name: 'India', region: 'Asia', currency: 'INR', cgRate: 0.125, stRate: 0.20, logic: 'LTCG: 12.5%, STCG: 20%' },
      China: { name: 'China', region: 'Asia', currency: 'CNY', cgRate: 0.20, stRate: 0.20, logic: 'Flat: 20% on income' },
      Japan: { name: 'Japan', region: 'Asia', currency: 'JPY', cgRate: 0.20315, stRate: 0.20315, logic: 'Flat: 20.315%' },
      SouthKorea: { name: 'South Korea', region: 'Asia', currency: 'KRW', cgRate: 0.22, stRate: 0.22, logic: 'Flat: 22% for large traders' },
      HongKong: { name: 'Hong Kong', region: 'Asia', currency: 'HKD', cgRate: 0.0, stRate: 0.0, logic: 'No CGT' },
      SouthAfrica: { name: 'South Africa', region: 'Africa', currency: 'ZAR', cgRate: 0.18, stRate: 0.18, logic: 'Effective ~18% (40% inclusion x 45%)' },
      Nigeria: { name: 'Nigeria', region: 'Africa', currency: 'NGN', cgRate: 0.10, stRate: 0.10, logic: 'CGT: 10%' },
      Egypt: { name: 'Egypt', region: 'Africa', currency: 'EGP', cgRate: 0.10, stRate: 0.10, logic: 'Exchange transaction tax; ~10% effective' },
      Ethiopia: { name: 'Ethiopia', region: 'Africa', currency: 'ETB', cgRate: 0.30, stRate: 0.30, logic: 'Business income tax up to 30%' },
      Kenya: { name: 'Kenya', region: 'Africa', currency: 'KES', cgRate: 0.15, stRate: 0.15, logic: 'CGT: 15%' },
      Morocco: { name: 'Morocco', region: 'Africa', currency: 'MAD', cgRate: 0.15, stRate: 0.15, logic: 'Fixed tax: 15%' },
      Angola: { name: 'Angola', region: 'Africa', currency: 'AOA', cgRate: 0.15, stRate: 0.15, logic: 'Capital income tax: 15%' },
      Ghana: { name: 'Ghana', region: 'Africa', currency: 'GHS', cgRate: 0.15, stRate: 0.15, logic: 'Securities gains: 15%' },
      Tanzania: { name: 'Tanzania', region: 'Africa', currency: 'TZS', cgRate: 0.10, stRate: 0.10, logic: 'CGT: 10% (resident individuals)' },
      Cote: { name: "Cote d'Ivoire", region: 'Africa', currency: 'XOF', cgRate: 0.25, stRate: 0.25, logic: 'Corporate-aligned CGT: 25%' }
    },
    regions: ['Americas', 'Europe', 'Middle East', 'South East Asia', 'Asia', 'Africa'],
    lastUpdated: 'April 21, 2026',
    sources: [
      { label: 'OECD tax database', href: 'https://www.oecd.org/tax/tax-policy/tax-database/' },
      { label: 'KPMG tax rates online', href: 'https://kpmg.com/xx/en/home/services/tax/tax-tools-and-resources/tax-rates-online.html' },
      { label: 'PwC worldwide tax summaries', href: 'https://taxsummaries.pwc.com/' }
    ],
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

function cloneConfig(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildPublicRuntimeConfig() {
  return cloneConfig(PUBLIC_RUNTIME_CONFIG);
}

function buildAppRuntimeConfig() {
  return cloneConfig(APP_RUNTIME_CONFIG);
}

module.exports = {
  buildPublicRuntimeConfig,
  buildAppRuntimeConfig
};
