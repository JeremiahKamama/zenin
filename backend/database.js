const Database = require('better-sqlite3');
const path = require('path');

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
    return db.prepare('SELECT * FROM portfolio_holdings ORDER BY date_added DESC').all();
  },

  // Add or update a holding.
  // quantity should always be POSITIVE; orderType ("buy"/"sell") determines direction.
  add: (holding) => {
    const {
      symbol, name, price, quantity, type, marketType, orderType, date_added
    } = holding;

    const absQty = Math.abs(quantity);
    const isSell = orderType === "sell";

    const existing = db.prepare(
      'SELECT * FROM portfolio_holdings WHERE symbol = ? AND marketType = ?'
    ).get(symbol, marketType);

    if (existing) {
      const newQuantity = isSell
        ? existing.quantity - absQty   // sell: reduce
        : existing.quantity + absQty;  // buy:  accumulate

      if (newQuantity <= 0) {
        // Position fully closed — remove the row
        db.prepare('DELETE FROM portfolio_holdings WHERE id = ?').run(existing.id);
        return { id: existing.id, symbol, marketType, quantity: 0, closed: true };
      }

      db.prepare(`
        UPDATE portfolio_holdings SET quantity = ?, price = ?, orderType = ?, date_added = ? WHERE id = ?
      `).run(newQuantity, price, orderType, date_added, existing.id);

      return { id: existing.id, ...holding, quantity: newQuantity };

    } else {
      // No existing position
      if (isSell) {
        // Can't sell something you don't own
        throw new Error(`No existing position for ${symbol} (${marketType}) to sell`);
      }

      const info = db.prepare(`
        INSERT INTO portfolio_holdings (symbol, name, price, quantity, type, marketType, orderType, date_added)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(symbol, name, price, absQty, type, marketType, orderType, date_added);

      return { id: info.lastInsertRowid, ...holding, quantity: absQty };
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
    return db.prepare(
      'SELECT * FROM portfolio_holdings WHERE symbol = ? AND marketType = ?'
    ).all(symbol, marketType);
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

// Clear all data (for testing)
function clearAllData() {
  db.exec('DELETE FROM portfolio_holdings');
  db.exec('DELETE FROM watchlist_assets');
}

module.exports = {
  db,
  initializeDatabase,
  portfolio,
  watchlist,
  clearAllData
};