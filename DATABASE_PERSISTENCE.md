# Database Persistence Implementation

## Overview
Portfolio holdings and watchlist assets are now persisted in a SQLite database instead of relying solely on browser localStorage. This enables:
- **Cross-device access** - Portfolio data survives browser session
- **Server-side storage** - Holdings persist on the server
- **Scalability** - Foundation for multi-user support
- **Audit trail** - Better tracking with `date_added` and `orderType` fields

## Architecture

### Database Layer
- **SQLite 3** database file: `backend/portfolio.db` (automatically created on first startup)
- **Two main tables**:
  - `portfolio_holdings` - User positions (stocks, crypto, etc.)
  - `watchlist_assets` - Saved watchlist items

### Backend API
Express.js server at `http://localhost:4000` exposes REST endpoints:

#### Portfolio Endpoints
```
GET    /api/db/portfolio              - Retrieve all holdings
POST   /api/db/portfolio              - Add new holding
PUT    /api/db/portfolio/:id          - Update holding (quantity/price)
DELETE /api/db/portfolio/:id          - Remove holding
GET    /api/db/portfolio/symbol/:symbol?marketType=X - Find by symbol
```

#### Watchlist Endpoints
```
GET    /api/db/watchlist              - Retrieve all watchlist assets
POST   /api/db/watchlist              - Add to watchlist
DELETE /api/db/watchlist/:symbol?marketType=X - Remove from watchlist
GET    /api/db/watchlist/check/:symbol?marketType=X - Check if in watchlist
```

### Frontend Integration
React application loads portfolio from backend on startup and syncs all changes:
- `addToPortfolio()` - Posts to `POST /api/db/portfolio`
- `removeFromPortfolio()` - Calls `DELETE /api/db/portfolio/:id`
- `updatePortfolioQuantity()` - Calls `PUT /api/db/portfolio/:id`

## Usage Examples

### Adding a Portfolio Holding
```bash
curl -X POST http://localhost:4000/api/db/portfolio \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "price": 150.25,
    "quantity": 10,
    "type": "stock",
    "marketType": "nasdaq",
    "orderType": "buy",
    "date_added": "2024-01-15T10:00:00Z"
  }'
```

### Retrieving All Holdings
```bash
curl http://localhost:4000/api/db/portfolio
```

Response:
```json
{
  "holdings": [
    {
      "id": 1,
      "symbol": "AAPL",
      "name": "Apple Inc.",
      "price": 150.25,
      "quantity": 10,
      "type": "stock",
      "marketType": "nasdaq",
      "orderType": "buy",
      "date_added": "2024-01-15T10:00:00Z"
    }
  ]
}
```

### Updating a Holding
```bash
curl -X PUT http://localhost:4000/api/db/portfolio/1 \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "AAPL",
    "name": "Apple Inc.",
    "price": 155.00,
    "quantity": 15,
    "type": "stock",
    "marketType": "nasdaq",
    "orderType": "buy",
    "date_added": "2024-01-15T10:00:00Z"
  }'
```

### Removing a Holding
```bash
curl -X DELETE http://localhost:4000/api/db/portfolio/1
```

## Database Schema

### portfolio_holdings
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| symbol | TEXT | Asset symbol (e.g., AAPL, BTC) |
| name | TEXT | Asset name (e.g., Apple Inc.) |
| price | REAL | Current/purchase price |
| quantity | REAL | Number of units held |
| type | TEXT | 'stock' or 'crypto' |
| marketType | TEXT | Market type (nasdaq, crypto, etc.) |
| orderType | TEXT | 'buy' or 'sell' |
| date_added | TEXT | ISO 8601 timestamp |

**Unique Constraint**: `(symbol, marketType, orderType, date_added)` prevents duplicates

### watchlist_assets
| Column | Type | Notes |
|--------|------|-------|
| id | INTEGER PK | Auto-increment |
| symbol | TEXT | Asset symbol |
| name | TEXT | Asset name |
| type | TEXT | Asset type |
| marketType | TEXT | Market type (nullable) |
| date_added | TEXT | ISO 8601 timestamp |

**Unique Constraint**: `(symbol, marketType)` prevents duplicate entries

## Implementation Details

### Frontend State Management
```javascript
// Portfolio now loads from database on mount
useEffect(() => {
  fetch(`${BACKEND_URL}/db/portfolio`)
    .then(res => res.json())
    .then(data => setPortfolio(data.holdings || []))
    .catch(err => console.error('Failed to load portfolio:', err));
}, []);

// All portfolio operations now call backend
const addToPortfolio = async (asset, quantity = 1) => {
  const response = await fetch(`${BACKEND_URL}/db/portfolio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(holding)
  });
  const newHolding = await response.json();
  setPortfolio(prev => [...prev, newHolding]);
};
```

### Backend Database Operations
```javascript
// Database module (database.js)
const portfolio = {
  getAll: () => db.prepare('SELECT * FROM portfolio_holdings ...').all(),
  add: (holding) => { /* INSERT */ },
  update: (id, holding) => { /* UPDATE */ },
  delete: (id) => { /* DELETE */ }
};
```

## Persistence Guarantees

✅ **Holdings persist across server restarts** - SQLite file-based storage  
✅ **Data survives browser refresh** - Fetched from backend on app load  
✅ **No localStorage sync issues** - Single source of truth is database  
✅ **Concurrent operations safe** - Unique constraints prevent duplicates  
✅ **Ready for multi-user** - Server-side storage enables future user accounts  

## Migration Notes

### Existing localStorage Data
- Old localStorage keys: `zenin_portfolio`, `zenin_trades`
- On first run with new code, frontend will load empty portfolio from database
- To migrate existing data: Clear localStorage in DevTools Console or manually load holdings via the API

### Backward Compatibility
- Trades still use localStorage (not migrated to DB yet)
- Can migrate trades to database separately if needed
- Portfolio operations are now fully database-backed

## Future Enhancements

1. **Migrate trades to database** - Add trades table with foreign key to portfolio
2. **User authentication** - Add user_id column to enable multi-user support
3. **Audit logging** - Track all portfolio changes with timestamps
4. **PostgreSQL support** - Replace SQLite with PostgreSQL for production
5. **Indexes** - Add indexes on frequently queried columns (symbol, date_added)
6. **Backup/restore** - Add endpoints for database export/import

## Files Modified/Created

### New Files
- `backend/database.js` - SQLite database module with CRUD operations
- `backend/portfolio.db` - SQLite database file (auto-created)

### Modified Files
- `backend/index.js` - Added 10 new API endpoints for portfolio/watchlist
- `backend/package.json` - Added `better-sqlite3` dependency
- `frontend/src/App.jsx` - Updated portfolio state to use database API

## Testing the Implementation

### 1. Start Backend
```bash
cd backend
npm start
```
Expected output:
```
Database initialized at: /path/to/portfolio.db
Portfolio manager backend listening on http://localhost:4000
```

### 2. Start Frontend
```bash
cd frontend
npm run dev
```
Expected: Frontend runs on `http://localhost:5177`

### 3. Test Portfolio Operations
Via curl or Postman, try:
- POST to `/api/db/portfolio` to add a holding
- GET `/api/db/portfolio` to retrieve all holdings
- PUT to update quantity
- DELETE to remove holdings

All changes should persist across refreshes and server restarts.
