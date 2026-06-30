/**
 * Market Intelligence Database Schema
 * ===================================
 *
 * Creates all database tables for the market intelligence domain.
 * Called during app startup alongside the existing initializeDatabase().
 *
 * Table prefixes: market_ to avoid collisions with existing tables.
 *
 * @module market-intel/infrastructure/database
 */

"use strict";

/**
 * Initialize market intelligence tables in the database.
 * Idempotent — uses IF NOT EXISTS for all CREATE TABLE statements.
 *
 * @param {import("pg").Pool} db
 * @returns {Promise<void>}
 */
async function initializeMarketIntelTables(db) {
  if (!db || typeof db.query !== "function") {
    throw new TypeError("A pg.Pool instance is required.");
  }

  // Company profiles (cached from providers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_companies (
      id              SERIAL PRIMARY KEY,
      symbol          VARCHAR(20) NOT NULL,
      name            VARCHAR(500),
      exchange        VARCHAR(50),
      currency        VARCHAR(10),
      sector          VARCHAR(200),
      industry        VARCHAR(200),
      description     TEXT,
      ceo             VARCHAR(500),
      website         VARCHAR(1000),
      logo_url        VARCHAR(2000),
      country         VARCHAR(100),
      market_cap      DOUBLE PRECISION,
      shares_outstanding DOUBLE PRECISION,
      employees       INTEGER,
      phone           VARCHAR(50),
      address         VARCHAR(500),
      city            VARCHAR(200),
      state           VARCHAR(100),
      zip_code        VARCHAR(20),
      isin            VARCHAR(20),
      cik             VARCHAR(20),
      ipo_date        DATE,
      last_updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(symbol)
    );
  `);

  // Latest quotes (cached from providers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_quotes (
      id              SERIAL PRIMARY KEY,
      symbol          VARCHAR(20) NOT NULL,
      price           DOUBLE PRECISION,
      change          DOUBLE PRECISION,
      change_percent  DOUBLE PRECISION,
      open            DOUBLE PRECISION,
      high            DOUBLE PRECISION,
      low             DOUBLE PRECISION,
      previous_close  DOUBLE PRECISION,
      volume          BIGINT,
      avg_volume      BIGINT,
      market_cap      DOUBLE PRECISION,
      pe_ratio        DOUBLE PRECISION,
      eps             DOUBLE PRECISION,
      high_52_week    DOUBLE PRECISION,
      low_52_week     DOUBLE PRECISION,
      bid             DOUBLE PRECISION,
      ask             DOUBLE PRECISION,
      quote_timestamp TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(symbol)
    );
  `);

  // Market events (normalized, provider-independent)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_events (
      id              VARCHAR(50) PRIMARY KEY,
      event_type      VARCHAR(50) NOT NULL,
      symbol          VARCHAR(20),
      payload         JSONB DEFAULT '{}',
      source          VARCHAR(50),
      origin          VARCHAR(20) DEFAULT 'system',
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_market_events_type ON market_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_market_events_symbol ON market_events(symbol);
    CREATE INDEX IF NOT EXISTS idx_market_events_created ON market_events(created_at);
  `);

  // Portfolio signals (per-user alerts from market events)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_portfolio_signals (
      id              VARCHAR(50) PRIMARY KEY,
      user_id         VARCHAR(100) NOT NULL,
      workspace_id    VARCHAR(100),
      event_id        VARCHAR(50),
      event_type      VARCHAR(50),
      symbol          VARCHAR(20),
      payload         JSONB DEFAULT '{}',
      severity        VARCHAR(20) DEFAULT 'info',
      acknowledged    BOOLEAN DEFAULT false,
      acknowledged_at TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_portfolio_signals_user ON market_portfolio_signals(user_id);
    CREATE INDEX IF NOT EXISTS idx_portfolio_signals_created ON market_portfolio_signals(created_at);
    CREATE INDEX IF NOT EXISTS idx_portfolio_signals_acked ON market_portfolio_signals(acknowledged);
  `);

  // Alert rules (user-defined notification triggers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_alert_rules (
      id              SERIAL PRIMARY KEY,
      user_id         VARCHAR(100) NOT NULL,
      workspace_id    VARCHAR(100),
      name            VARCHAR(200) NOT NULL,
      event_type      VARCHAR(50),
      symbol          VARCHAR(20),
      conditions      JSONB DEFAULT '{}',
      channels        JSONB DEFAULT '["inApp","push"]',
      enabled         BOOLEAN DEFAULT true,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_alert_rules_user ON market_alert_rules(user_id);
    CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON market_alert_rules(enabled);
  `);

  // Notifications (delivered to users)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_notifications (
      id              VARCHAR(50) PRIMARY KEY,
      user_id         VARCHAR(100) NOT NULL,
      workspace_id    VARCHAR(100),
      title           VARCHAR(500) NOT NULL,
      body            TEXT,
      category        VARCHAR(50) DEFAULT 'general',
      action_url      VARCHAR(2000),
      channels        JSONB DEFAULT '["inApp"]',
      status          VARCHAR(20) DEFAULT 'pending',
      delivered_at    TIMESTAMPTZ,
      read_at         TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON market_notifications(user_id);
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON market_notifications(created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_status ON market_notifications(status);
  `);

  // Watchlists
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_watchlists (
      id              SERIAL PRIMARY KEY,
      user_id         VARCHAR(100) NOT NULL,
      workspace_id    VARCHAR(100),
      name            VARCHAR(500) NOT NULL,
      description     TEXT,
      created_at      TIMESTAMPTZ DEFAULT NOW(),
      updated_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_watchlists_user ON market_watchlists(user_id);
    CREATE INDEX IF NOT EXISTS idx_watchlists_workspace ON market_watchlists(workspace_id);
  `);

  // Watchlist items
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_watchlist_items (
      id              SERIAL PRIMARY KEY,
      watchlist_id    INTEGER NOT NULL REFERENCES market_watchlists(id) ON DELETE CASCADE,
      symbol          VARCHAR(20) NOT NULL,
      name            VARCHAR(500),
      note            TEXT,
      target_price    DOUBLE PRECISION,
      added_at        TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(watchlist_id, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_items_wl ON market_watchlist_items(watchlist_id);
  `);

  // Dividend events (cached from providers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_dividend_events (
      id              SERIAL PRIMARY KEY,
      symbol          VARCHAR(20) NOT NULL,
      name            VARCHAR(500),
      dividend        DOUBLE PRECISION,
      declaration_date DATE,
      record_date     DATE,
      payable_date    DATE,
      ex_dividend_date DATE,
      frequency       VARCHAR(20),
      yield           DOUBLE PRECISION,
      annual_dividend DOUBLE PRECISION,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_dividend_events_symbol ON market_dividend_events(symbol);
  `);

  // Earnings events (cached from providers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_earnings_events (
      id              SERIAL PRIMARY KEY,
      symbol          VARCHAR(20) NOT NULL,
      date            DATE NOT NULL,
      period          VARCHAR(20),
      estimated_eps   DOUBLE PRECISION,
      actual_eps      DOUBLE PRECISION,
      surprise_eps    DOUBLE PRECISION,
      surprise_eps_pct DOUBLE PRECISION,
      estimated_revenue DOUBLE PRECISION,
      actual_revenue  DOUBLE PRECISION,
      time_of_day     VARCHAR(10),
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_earnings_events_symbol ON market_earnings_events(symbol);
    CREATE INDEX IF NOT EXISTS idx_earnings_events_date ON market_earnings_events(date);
  `);

  // Insider trades (cached from providers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_insider_trades (
      id              VARCHAR(100) PRIMARY KEY,
      symbol          VARCHAR(20) NOT NULL,
      insider_name    VARCHAR(500),
      title           VARCHAR(500),
      transaction_type VARCHAR(10),
      shares          DOUBLE PRECISION,
      price_per_share DOUBLE PRECISION,
      total_value     DOUBLE PRECISION,
      filing_date     DATE,
      transaction_date DATE,
      ownership_type  VARCHAR(100),
      sec_form        VARCHAR(10),
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_insider_trades_symbol ON market_insider_trades(symbol);
    CREATE INDEX IF NOT EXISTS idx_insider_trades_date ON market_insider_trades(transaction_date);
  `);

  // News articles (cached from providers)
  await db.query(`
    CREATE TABLE IF NOT EXISTS market_news_articles (
      id              VARCHAR(200) PRIMARY KEY,
      title           VARCHAR(1000) NOT NULL,
      summary         TEXT,
      content         TEXT,
      url             VARCHAR(2000),
      source          VARCHAR(500),
      image_url       VARCHAR(2000),
      category        VARCHAR(50) DEFAULT 'general',
      symbols         JSONB DEFAULT '[]',
      sentiment       VARCHAR(20),
      published_at    TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_news_articles_published ON market_news_articles(published_at);
    CREATE INDEX IF NOT EXISTS idx_news_articles_category ON market_news_articles(category);
  `);

  console.log("[market-intel] Database tables initialized.");
}

module.exports = {
  initializeMarketIntelTables
};
