# Database Persistence - Verification & Testing Guide

## Quick Start Verification

### 1. Verify Database File Exists
```bash
ls -lh /Users/jeremiahkamama/Desktop/port/backend/portfolio.db
```
Should show a file with size > 0 bytes

### 2. Check Database Schema
```bash
sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db ".schema"
```
Should display both `portfolio_holdings` and `watchlist_assets` tables

### 3. Verify Backend API is Running
```bash
curl http://localhost:4000/api/db/portfolio
```
Should return: `{"holdings":[]}`

### 4. Verify Frontend is Running
```bash
curl -s http://localhost:5177/ | head -5
```
Should return HTML content starting with `<!DOCTYPE`

## Complete End-to-End Test

### Step 1: Add a Portfolio Holding via API
```bash
curl -X POST http://localhost:4000/api/db/portfolio \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TSLA",
    "name": "Tesla Inc.",
    "price": 245.30,
    "quantity": 5,
    "type": "stock",
    "marketType": "nasdaq",
    "orderType": "buy",
    "date_added": "2024-01-20T14:30:00Z"
  }'
```
**Expected Response**: 
```json
{
  "id": 2,
  "symbol": "TSLA",
  ...
}
```

### Step 2: Verify Persistence (Restart Test)
1. Kill backend: `lsof -ti:4000 | xargs kill -9`
2. Restart backend: `cd /Users/jeremiahkamama/Desktop/port/backend && node index.js &`
3. Query holdings:
```bash
curl http://localhost:4000/api/db/portfolio | jq '.holdings | length'
```
**Expected**: Should show `1` or more (not empty!)

### Step 3: Test from Frontend UI
1. Open http://localhost:5177 in browser
2. Navigate to "Portfolio" section
3. Search for an asset (e.g., "Apple" or "BTC")
4. Click the star icon to add to portfolio
5. Enter quantity when prompted
6. **Verify**: Asset appears in portfolio with correct quantity
7. Refresh page (Cmd+R) - **asset should still be there!**

### Step 4: Test Portfolio Operations

#### Update Quantity
```bash
curl -X PUT http://localhost:4000/api/db/portfolio/2 \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "TSLA",
    "name": "Tesla Inc.",
    "price": 250.00,
    "quantity": 10,
    "type": "stock",
    "marketType": "nasdaq",
    "orderType": "buy",
    "date_added": "2024-01-20T14:30:00Z"
  }'
```
Verify the quantity updated to 10

#### Remove Holding
```bash
curl -X DELETE http://localhost:4000/api/db/portfolio/2
```
Verify returned success

#### Confirm Deletion
```bash
curl http://localhost:4000/api/db/portfolio
```
Verify holdings list no longer includes the deleted item

## Frontend-Database Sync Testing

### Test 1: Add via UI, Verify in Database
1. Click star on an asset in watchlist
2. In terminal, run: `curl http://localhost:4000/api/db/portfolio | jq`
3. **Verify**: New asset appears in database response

### Test 2: Add via API, Verify in UI
1. Use curl to POST a new holding (see Step 1 above)
2. Refresh frontend page
3. **Verify**: New holding appears in Portfolio section

### Test 3: Delete via UI, Verify in Database
1. In frontend Portfolio section, click "Remove from Portfolio" on an asset
2. Verify it disappears from UI
3. In terminal, verify it's gone: `curl http://localhost:4000/api/db/portfolio | jq`

### Test 4: Cross-Browser Persistence
1. Add holdings via frontend in Chrome
2. Open portfolio.db file: `sqlite3 portfolio.db "SELECT symbol, quantity FROM portfolio_holdings;"`
3. **Verify**: Holdings are in database
4. Open same URL in Safari/Firefox
5. **Verify**: Holdings appear in new browser (loading from server database)

## API Response Examples

### Successfully Added Holding
```json
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
```

### Get All Holdings
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
    },
    {
      "id": 2,
      "symbol": "BTC",
      "name": "Bitcoin",
      "price": 42000,
      "quantity": 0.5,
      "type": "crypto",
      "marketType": "crypto",
      "orderType": "buy",
      "date_added": "2024-01-20T14:30:00Z"
    }
  ]
}
```

### Error Response (Missing Parameter)
```json
{
  "error": "marketType query parameter required"
}
```

## Database Direct Query Examples

### Count Total Holdings
```bash
sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db \
  "SELECT COUNT(*) FROM portfolio_holdings;"
```

### View All Holdings
```bash
sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db \
  "SELECT symbol, quantity, price FROM portfolio_holdings;"
```

### Find Holdings by Symbol
```bash
sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db \
  "SELECT * FROM portfolio_holdings WHERE symbol='AAPL';"
```

### Calculate Total Portfolio Value
```bash
sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db \
  "SELECT SUM(price * quantity) as total_value FROM portfolio_holdings;"
```

### Export Holdings to CSV
```bash
sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db \
  ".mode csv" \
  "SELECT * FROM portfolio_holdings;" > portfolio_export.csv
```

## Debugging Checklist

### Database Not Persisting
- [ ] Check backend is running: `ps aux | grep "node index.js"`
- [ ] Check database file exists: `ls -l backend/portfolio.db`
- [ ] Check database size > 0: `du -h backend/portfolio.db`
- [ ] Query database directly: `sqlite3 backend/portfolio.db "SELECT COUNT(*) FROM portfolio_holdings;"`

### Frontend Not Showing Holdings
- [ ] Check browser console for errors (DevTools → Console tab)
- [ ] Verify backend is running on port 4000
- [ ] Check API response: `curl http://localhost:4000/api/db/portfolio`
- [ ] Try hard refresh: Cmd+Shift+R (macOS) or Ctrl+Shift+R (Windows)

### API Errors
- [ ] Check backend logs for errors
- [ ] Verify request format matches examples
- [ ] Verify all required fields present in POST/PUT requests
- [ ] Check marketType parameter is provided for symbol queries

### Server Connection Failed
- [ ] Is backend running? Check: `lsof -i :4000`
- [ ] Is frontend running? Check: `lsof -i :5177`
- [ ] Port conflicts? Try: `lsof -i :4000` and `lsof -i :5177`
- [ ] CORS issues? Check browser console for cross-origin errors

## Performance Monitoring

### Database Size
```bash
du -h /Users/jeremiahkamama/Desktop/port/backend/portfolio.db
```
(Should start small, grows as holdings are added)

### Query Speed
```bash
time sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db \
  "SELECT COUNT(*) FROM portfolio_holdings;"
```
(Should complete in < 1ms for typical portfolio sizes)

### Number of Holdings
```bash
sqlite3 /Users/jeremiahkamama/Desktop/port/backend/portfolio.db \
  "SELECT COUNT(*) FROM portfolio_holdings;"
```

## Success Criteria

✅ Database file exists in `backend/` directory  
✅ Both tables created (portfolio_holdings, watchlist_assets)  
✅ API endpoints respond with valid JSON  
✅ Holdings persist after page refresh  
✅ Holdings persist after server restart  
✅ Adding via UI creates database entry  
✅ Adding via API shows in frontend after refresh  
✅ Deletions sync between UI and database  
✅ No JavaScript errors in browser console  
✅ No connection timeout errors  

All criteria met = Database persistence is working correctly! ✨
