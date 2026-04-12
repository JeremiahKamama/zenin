import csv
import json
from pathlib import Path

csv_path = Path('/Users/jeremiahkamama/Desktop/watchlist test.csv')
rows = []
with csv_path.open(newline='', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    for r in reader:
        ticker = (r.get('Ticker') or '').strip()
        if not ticker:
            continue
        rows.append({
            'symbol': ticker,
            'name': (r.get('Company') or '').strip() or ticker,
            'theme': (r.get('Theme') or '').strip() or None,
            'category': (r.get('Category') or '').strip() or None,
            'exchange': (r.get('Exchange') or '').strip() or None,
        })

existing = {
    'bonds': [
        {'symbol': 'UST10Y', 'name': 'US 10-Year Treasury', 'market': 'Treasury'},
        {'symbol': 'UST30Y', 'name': 'US 30-Year Treasury', 'market': 'Treasury'},
        {'symbol': 'UST5Y', 'name': 'US 5-Year Treasury', 'market': 'Treasury'},
        {'symbol': 'TLT', 'name': 'iShares 20+ Year Treasury ETF', 'market': 'ETF'},
        {'symbol': 'IEI', 'name': 'iShares 3-7 Year Treasury ETF', 'market': 'ETF'},
        {'symbol': 'BIV', 'name': 'Vanguard Total Bond Market ETF', 'market': 'ETF'},
        {'symbol': 'SCHZ', 'name': 'Schwab U.S. Aggregate Bond ETF', 'market': 'ETF'},
        {'symbol': 'LQD', 'name': 'iShares iBoxx $ Investment Grade Corporate Bond ETF', 'market': 'ETF'},
        {'symbol': 'VCIT', 'name': 'Vanguard Intermediate-Term Corporate Bond ETF', 'market': 'ETF'},
        {'symbol': 'BND', 'name': 'Vanguard Total Bond Market ETF', 'market': 'ETF'},
    ],
    'crypto': [
        {'symbol': 'BTC', 'name': 'Bitcoin', 'market': 'Spot'},
        {'symbol': 'ETH', 'name': 'Ethereum', 'market': 'Spot'},
        {'symbol': 'USDT', 'name': 'Tether', 'market': 'Stablecoin'},
        {'symbol': 'USDC', 'name': 'USD Coin', 'market': 'Stablecoin'},
        {'symbol': 'BNB', 'name': 'BNB', 'market': 'Exchange Token'},
        {'symbol': 'XRP', 'name': 'XRP', 'market': 'Spot'},
        {'symbol': 'ADA', 'name': 'Cardano', 'market': 'Spot'},
        {'symbol': 'SOL', 'name': 'Solana', 'market': 'Spot'},
        {'symbol': 'DOGE', 'name': 'Dogecoin', 'market': 'Spot'},
        {'symbol': 'DOT', 'name': 'Polkadot', 'market': 'Spot'},
    ],
    'stocks': [
        {'symbol': 'AAPL', 'name': 'Apple Inc.', 'market': 'NASDAQ'},
        {'symbol': 'MSFT', 'name': 'Microsoft Corp.', 'market': 'NASDAQ'},
        {'symbol': 'NVDA', 'name': 'NVIDIA Corp.', 'market': 'NASDAQ'},
        {'symbol': 'AMZN', 'name': 'Amazon.com Inc.', 'market': 'NASDAQ'},
        {'symbol': 'GOOGL', 'name': 'Alphabet Inc.', 'market': 'NASDAQ'},
        {'symbol': 'TSLA', 'name': 'Tesla Inc.', 'market': 'NASDAQ'},
        {'symbol': 'BRK.B', 'name': 'Berkshire Hathaway Inc.', 'market': 'NYSE'},
        {'symbol': 'JPM', 'name': 'JPMorgan Chase & Co.', 'market': 'NYSE'},
        {'symbol': 'META', 'name': 'Meta Platforms Inc.', 'market': 'NASDAQ'},
        {'symbol': 'JNJ', 'name': 'Johnson & Johnson', 'market': 'NYSE'},
    ],
    'metals': [
        {'symbol': 'XAU', 'name': 'Gold', 'market': 'Spot'},
        {'symbol': 'XAG', 'name': 'Silver', 'market': 'Spot'},
        {'symbol': 'XPT', 'name': 'Platinum', 'market': 'Spot'},
        {'symbol': 'XPD', 'name': 'Palladium', 'market': 'Spot'},
        {'symbol': 'COPPER', 'name': 'Copper', 'market': 'Spot'},
        {'symbol': 'ALUM', 'name': 'Aluminum', 'market': 'Spot'},
        {'symbol': 'NICKEL', 'name': 'Nickel', 'market': 'Spot'},
        {'symbol': 'ZINC', 'name': 'Zinc', 'market': 'Spot'},
        {'symbol': 'LEAD', 'name': 'Lead', 'market': 'Spot'},
        {'symbol': 'LITH', 'name': 'Lithium', 'market': 'Spot'},
    ],
    'commodities': [
        {'symbol': 'WTI', 'name': 'WTI Crude Oil', 'market': 'Futures'},
        {'symbol': 'BRENT', 'name': 'Brent Crude Oil', 'market': 'Futures'},
        {'symbol': 'NG', 'name': 'Natural Gas', 'market': 'Futures'},
        {'symbol': 'CORN', 'name': 'Corn', 'market': 'Futures'},
        {'symbol': 'SOYB', 'name': 'Soybeans', 'market': 'Futures'},
        {'symbol': 'WHEAT', 'name': 'Wheat', 'market': 'Futures'},
        {'symbol': 'COFFEE', 'name': 'Coffee', 'market': 'Futures'},
        {'symbol': 'COTTON', 'name': 'Cotton', 'market': 'Futures'},
        {'symbol': 'COCOA', 'name': 'Cocoa', 'market': 'Futures'},
        {'symbol': 'SUGAR', 'name': 'Sugar', 'market': 'Futures'},
    ],
}

# Add all CSV rows to stocks
for r in rows:
    asset = {
        'symbol': r['symbol'],
        'name': r['name'],
        'market': r['exchange'] or r['theme'] or 'Stock',
        'theme': r['theme'],
        'exchange': r['exchange'],
        'category': r['category'],
    }
    existing['stocks'].append(asset)

lines = ['const watchlistData = {']
for key, assets in existing.items():
    lines.append(f'  {json.dumps(key)}: [')
    for a in assets:
        lines.append('    ' + json.dumps(a) + ',')
    lines.append('  ],')
lines.append('};')
lines.append('')
lines.append('module.exports = { watchlistData };')

output_path = Path('backend/data.js')
output_path.write_text('\n'.join(lines), encoding='utf-8')
print('wrote', output_path, 'with all CSV assets added to stocks')