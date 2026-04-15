const Database = require('better-sqlite3');
const path = require('path');
const QTY_EPSILON = 1e-8;

// Create/open database
const dbPath = path.join(__dirname, 'portfolio.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
function initializeDatabase() {
  // Portfolio holdings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS portfolio_holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      type TEXT NOT NULL,
      marketType TEXT NOT NULL,
      orderType TEXT NOT NULL,
      date_added TEXT NOT NULL,
      UNIQUE(symbol, marketType)
    );
  `);

  // Watchlist assets table
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlist_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      marketType TEXT,
      date_added TEXT NOT NULL,
      UNIQUE(symbol, marketType)
    );
  `);
// Add after the watchlist_assets table creation
db.exec(`
  CREATE TABLE IF NOT EXISTS user_balance (
    id INTEGER PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 10000
  );
`);
db.prepare(`INSERT OR IGNORE INTO user_balance (id, balance) VALUES (1, 10000)`).run();
  // Saved options calculations
  db.exec(`
    CREATE TABLE IF NOT EXISTS options_calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      symbol TEXT NOT NULL,
      strategy TEXT NOT NULL,
      net_pnl REAL NOT NULL,
      delta REAL NOT NULL,
      gamma REAL NOT NULL,
      theta REAL NOT NULL,
      vega REAL NOT NULL,
      max_profit REAL,
      max_loss REAL,
      breakevens TEXT,
      legs_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  // Trade executions table (journal persistence)
  db.exec(`
    CREATE TABLE IF NOT EXISTS trade_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT UNIQUE,
      date TEXT NOT NULL,
      executed_at TEXT,
      asset TEXT NOT NULL,
      name TEXT,
      type TEXT NOT NULL,
      side TEXT NOT NULL,
      marketType TEXT NOT NULL,
      status TEXT NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      notional REAL NOT NULL,
      balance_after REAL,
      portfolio_value_after REAL,
      account_equity_after REAL,
      position_after REAL
    );
  `);

  console.log('Database initialized at:', dbPath);

  // Seed watchlist if empty
  const watchlistCount = db.prepare('SELECT COUNT(*) AS count FROM watchlist_assets').get().count;
  if (watchlistCount === 0) {
    console.log('Seeding watchlist_assets from data.js...');
    const { watchlistData } = require('./data');
    const stmt = db.prepare(`
      INSERT INTO watchlist_assets (symbol, name, type, marketType, date_added)
      VALUES (?, ?, ?, ?, ?)
    `);
    const date_added = new Date().toISOString();

    db.transaction(() => {
      for (const [category, assets] of Object.entries(watchlistData)) {
        for (const asset of assets) {
          try {
            // Include category into type if it's not defined, or preserve theme
            const type = asset.type || asset.theme || category;
            const marketType = asset.marketType || 'spot';
            stmt.run(asset.symbol, asset.name, type, marketType, date_added);
          } catch (err) {
            // ignore unique constraints
          }
        }
      }
    })();
    console.log('Seeding complete.');
  }
}

// Portfolio operations
const portfolio = {
  // Get all portfolio holdings
  getAll: () => {
    db.prepare('DELETE FROM portfolio_holdings WHERE ABS(quantity) <= ?').run(QTY_EPSILON);
    return db.prepare('SELECT * FROM portfolio_holdings WHERE quantity > ? ORDER BY date_added DESC').all(QTY_EPSILON);
  },

  // Add or update a holding.
  // quantity should always be POSITIVE; orderType ("buy"/"sell") determines direction.
  add: (holding) => {
    const {
      symbol, name, price, quantity, type, marketType, orderType, date_added
    } = holding;

    const absQty = Math.abs(quantity);
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanType = String(type || "").trim().toLowerCase();
    const cleanMarketType = String(
      marketType || (cleanType === "crypto" ? "spot" : "equity")
    ).trim().toLowerCase();
    const cleanOrderType = String(orderType || "buy").trim().toLowerCase() === "sell" ? "sell" : "buy";
    const cleanDate = date_added || new Date().toISOString();
    const isSell = cleanOrderType === "sell";

    const existing = db.prepare(
      'SELECT * FROM portfolio_holdings WHERE symbol = ? AND marketType = ?'
    ).get(cleanSymbol, cleanMarketType);

    if (existing) {
      const newQuantity = isSell
        ? existing.quantity - absQty   // sell: reduce
        : existing.quantity + absQty;  // buy:  accumulate

      if (newQuantity <= QTY_EPSILON) {
        // Position fully closed — remove the row
        db.prepare('DELETE FROM portfolio_holdings WHERE id = ?').run(existing.id);
        return { id: existing.id, symbol: cleanSymbol, marketType: cleanMarketType, quantity: 0, closed: true };
      }

      db.prepare(`
        UPDATE portfolio_holdings SET quantity = ?, price = ?, orderType = ?, date_added = ? WHERE id = ?
      `).run(newQuantity, price, cleanOrderType, cleanDate, existing.id);

      return {
        id: existing.id,
        ...holding,
        symbol: cleanSymbol,
        type: cleanType,
        marketType: cleanMarketType,
        orderType: cleanOrderType,
        date_added: cleanDate,
        quantity: newQuantity
      };

    } else {
      // No existing position
      if (isSell) {
        // Can't sell something you don't own
        throw new Error(`No existing position for ${cleanSymbol} (${cleanMarketType}) to sell`);
      }

      const info = db.prepare(`
        INSERT INTO portfolio_holdings (symbol, name, price, quantity, type, marketType, orderType, date_added)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(cleanSymbol, name, price, absQty, cleanType, cleanMarketType, cleanOrderType, cleanDate);

      return {
        id: info.lastInsertRowid,
        ...holding,
        symbol: cleanSymbol,
        type: cleanType,
        marketType: cleanMarketType,
        orderType: cleanOrderType,
        date_added: cleanDate,
        quantity: absQty
      };
    }
  },

  // Update a holding
  update: (id, holding) => {
    const { price, quantity } = holding;
    const stmt = db.prepare(`
      UPDATE portfolio_holdings SET price = ?, quantity = ? WHERE id = ?
    `);
    stmt.run(price, quantity, id);
    return { id, ...holding };
  },

  // Delete a holding
  delete: (id) => {
    const stmt = db.prepare('DELETE FROM portfolio_holdings WHERE id = ?');
    stmt.run(id);
    return { success: true, id };
  },

  // Find by symbol and marketType
  findBySymbol: (symbol, marketType) => {
    const cleanSymbol = String(symbol || "").trim().toUpperCase();
    const cleanMarketType = String(marketType || "").trim().toLowerCase();
    return db.prepare(
      'SELECT * FROM portfolio_holdings WHERE symbol = ? AND marketType = ?'
    ).all(cleanSymbol, cleanMarketType);
  }
};

const tradeExecutions = {
  getAll: (limit = 1000) => {
    const safeLimit = Math.max(1, Math.min(5000, Number(limit) || 1000));
    return db.prepare(`
      SELECT *
      FROM trade_executions
      ORDER BY datetime(COALESCE(executed_at, date)) DESC, id DESC
      LIMIT ?
    `).all(safeLimit);
  },

  add: (trade) => {
    const normalized = {
      client_id: trade.clientId || null,
      date: trade.date || new Date().toISOString().split("T")[0],
      executed_at: trade.executedAt || null,
      asset: String(trade.asset || "UNKNOWN").trim().toUpperCase(),
      name: String(trade.name || trade.asset || "UNKNOWN"),
      type: String(trade.type || "BUY").toUpperCase() === "SELL" ? "SELL" : "BUY",
      side: String(trade.side || "buy").toLowerCase() === "sell" ? "sell" : "buy",
      marketType: String(trade.marketType || "spot").trim().toLowerCase(),
      status: String(trade.status || "Filled"),
      quantity: Math.abs(Number(trade.quantity) || 0),
      price: Number(trade.price) || 0,
      notional: Math.abs(Number(trade.notional) || 0),
      balance_after: Number.isFinite(Number(trade.balanceAfter)) ? Number(trade.balanceAfter) : null,
      portfolio_value_after: Number.isFinite(Number(trade.portfolioValueAfter)) ? Number(trade.portfolioValueAfter) : null,
      account_equity_after: Number.isFinite(Number(trade.accountEquityAfter)) ? Number(trade.accountEquityAfter) : null,
      position_after: Number.isFinite(Number(trade.positionAfter)) ? Number(trade.positionAfter) : null
    };

    const stmt = db.prepare(`
      INSERT INTO trade_executions (
        client_id, date, executed_at, asset, name, type, side, marketType, status,
        quantity, price, notional, balance_after, portfolio_value_after, account_equity_after, position_after
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    try {
      const info = stmt.run(
        normalized.client_id,
        normalized.date,
        normalized.executed_at,
        normalized.asset,
        normalized.name,
        normalized.type,
        normalized.side,
        normalized.marketType,
        normalized.status,
        normalized.quantity,
        normalized.price,
        normalized.notional,
        normalized.balance_after,
        normalized.portfolio_value_after,
        normalized.account_equity_after,
        normalized.position_after
      );
      return { id: info.lastInsertRowid, ...normalized };
    } catch (error) {
      if (String(error.message || "").includes("UNIQUE constraint failed: trade_executions.client_id") && normalized.client_id) {
        return db.prepare('SELECT * FROM trade_executions WHERE client_id = ?').get(normalized.client_id);
      }
      throw error;
    }
  }
};

// Watchlist operations
const watchlist = {
  // Get all watchlist assets
  getAll: () => {
    return db.prepare('SELECT * FROM watchlist_assets ORDER BY date_added DESC').all();
  },

  // Add to watchlist
  add: (asset) => {
    const { symbol, name, type, marketType, date_added } = asset;
    const stmt = db.prepare(`
      INSERT INTO watchlist_assets (symbol, name, type, marketType, date_added)
      VALUES (?, ?, ?, ?, ?)
    `);
    try {
      const info = stmt.run(symbol, name, type, marketType, date_added);
      return { id: info.lastInsertRowid, ...asset };
    } catch (error) {
      // If insert fails due to UNIQUE constraint, return existing
      const existing = db.prepare(
        'SELECT * FROM watchlist_assets WHERE symbol = ? AND marketType = ?'
      ).get(symbol, marketType);
      return existing;
    }
  },

  // Remove from watchlist
  delete: (symbol, marketType) => {
    const stmt = db.prepare(
      'DELETE FROM watchlist_assets WHERE symbol = ? AND marketType = ?'
    );
    stmt.run(symbol, marketType);
    return { success: true, symbol, marketType };
  },

  // Check if asset is in watchlist
  exists: (symbol, marketType) => {
    const result = db.prepare(
      'SELECT id FROM watchlist_assets WHERE symbol = ? AND marketType = ?'
    ).get(symbol, marketType);
    return !!result;
  }
};

const optionsCalculations = {
  add: (payload) => {
    const {
      symbol,
      strategy = "Custom",
      netPnl = 0,
      delta = 0,
      gamma = 0,
      theta = 0,
      vega = 0,
      maxProfit = null,
      maxLoss = null,
      breakevens = [],
      legs = [],
      createdAt = new Date().toISOString()
    } = payload;

    const stmt = db.prepare(`
      INSERT INTO options_calculations (
        symbol, strategy, net_pnl, delta, gamma, theta, vega, max_profit, max_loss, breakevens, legs_json, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const info = stmt.run(
      symbol,
      strategy,
      Number(netPnl) || 0,
      Number(delta) || 0,
      Number(gamma) || 0,
      Number(theta) || 0,
      Number(vega) || 0,
      Number.isFinite(Number(maxProfit)) ? Number(maxProfit) : null,
      Number.isFinite(Number(maxLoss)) ? Number(maxLoss) : null,
      JSON.stringify(Array.isArray(breakevens) ? breakevens : []),
      JSON.stringify(Array.isArray(legs) ? legs : []),
      createdAt
    );

    return { id: info.lastInsertRowid, ...payload, createdAt };
  },

  getRecent: (limit = 20, symbol = null) => {
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 20));
    if (symbol) {
      return db.prepare(`
        SELECT * FROM options_calculations
        WHERE symbol = ?
        ORDER BY datetime(created_at) DESC, id DESC
        LIMIT ?
      `).all(symbol, safeLimit);
    }
    return db.prepare(`
      SELECT * FROM options_calculations
      ORDER BY datetime(created_at) DESC, id DESC
      LIMIT ?
    `).all(safeLimit);
  }
};

// Clear all data (for testing)
function clearAllData() {
  db.exec('DELETE FROM portfolio_holdings');
  db.exec('DELETE FROM watchlist_assets');
  db.exec('DELETE FROM trade_executions');
}

module.exports = {
  db,
  initializeDatabase,
  portfolio,
  watchlist,
  optionsCalculations,
  tradeExecutions,
  clearAllData
};
