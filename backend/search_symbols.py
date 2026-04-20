#!/usr/bin/env python3
"""
search_symbols.py — search for stock symbols and names from live APIs.

Fetches from Yahoo Finance and Binance APIs, with fallback to local databases.
"""

import sys
import json
import subprocess
import time

# Hardcoded fallback database
FALLBACK_STOCKS = {
    'AAPL': 'Apple Inc',
    'MSFT': 'Microsoft Corporation',
    'GOOGL': 'Alphabet Inc',
    'AMZN': 'Amazon.com Inc',
    'TSLA': 'Tesla Inc',
    'NVDA': 'NVIDIA Corporation',
    'META': 'Meta Platforms Inc',
    'NFLX': 'Netflix Inc',
    'GOOG': 'Alphabet Inc',
    'JPM': 'JPMorgan Chase',
    'V': 'Visa Inc',
    'WMT': 'Walmart Inc',
    'JNJ': 'Johnson & Johnson',
    'PG': 'Procter & Gamble',
    'BAC': 'Bank of America',
    'XOM': 'Exxon Mobil',
    'INTC': 'Intel Corporation',
    'AMD': 'Advanced Micro Devices',
    'CRM': 'Salesforce',
    'ADBE': 'Adobe Inc',
    'CSCO': 'Cisco Systems',
    'ORCL': 'Oracle Corporation',
    'IBM': 'IBM',
    'SQ': 'Square Inc',
    'PYPL': 'PayPal',
}

FALLBACK_CRYPTO = {
    'BTC': 'Bitcoin',
    'ETH': 'Ethereum',
    'BNB': 'Binance Coin',
    'XRP': 'XRP',
    'ADA': 'Cardano',
    'SOL': 'Solana',
    'DOGE': 'Dogecoin',
    'DOT': 'Polkadot',
    'BCH': 'Bitcoin Cash',
    'LTC': 'Litecoin',
    'SHIB': 'Shiba Inu',
    'LINK': 'Chainlink',
    'UNI': 'Uniswap',
    'MATIC': 'Polygon',
    'AVAX': 'Avalanche',
    'FARTCOIN': 'Fartcoin',
    'XLM': 'Stellar',
    'TRX': 'TRON',
    'TON': 'Toncoin',
    'ATOM': 'Cosmos',
    'KAS': 'Kaspa',
    'NEAR': 'NEAR Protocol',
    'ICP': 'Internet Computer',
    'APT': 'Aptos',
    'ALGO': 'Algorand',
}


def search_binance_crypto(query: str) -> list:
    """Search CoinGecko for crypto assets."""
    results = []
    try:
        import requests
        query_lower = query.lower()
        url = f"https://api.coingecko.com/api/v3/search?query={query_lower}"
        response = requests.get(url, timeout=10)
        if not response.ok:
            return results

        data = response.json()
        coins = data.get("coins", [])

        for coin in coins[:5]:
            symbol = coin.get("symbol", "").upper()
            name = coin.get("name", "")
            if symbol and name:
                results.append({
                    "symbol": symbol,
                    "name": name,
                    "type": "crypto",
                    "exchange": "CoinGecko",
                })
    except Exception as e:
        pass

    return results


def get_exchange_priority(exchange: str) -> int:
    """Return priority score for an exchange. Higher is better."""
    exchange = str(exchange or "").upper()
    if any(e in exchange for e in ["NASDAQ", "NYSE", "AMEX", "BATS", "ARCA", "NMS", "NGS", "NCM"]):
        return 100
    if "HKSE" in exchange or "HKG" in exchange or ".HK" in exchange:
        return 50
    if "TSE" in exchange or ".T" in exchange:
        return 40
    if "LSE" in exchange or ".L" in exchange:
        return 30
    return 10


def search_yahoo_stocks(query: str) -> list:
    """Search Yahoo Finance for stocks."""
    results = []
    
    # First try: exact symbol match in fallback
    query_lower = query.lower()
    for symbol, name in FALLBACK_STOCKS.items():
        if query_lower == symbol.lower():
            results.append({
                'symbol': symbol,
                'name': name,
                'type': 'stock',
                'exchange': 'NASDAQ/NYSE',
                '_priority': 1000
            })
            return results
    
    # Second try: use yfinance to validate and get info on potential matches
    try:
        import yfinance as yf
        
        # Try direct ticker lookup
        ticker = yf.Ticker(query.upper())
        info = ticker.info
        
        if info and 'symbol' in info and info.get('symbol'):
            exchange = info.get('exchange', 'NASDAQ/NYSE')
            results.append({
                'symbol': info['symbol'],
                'name': info.get('longName', info.get('shortName', query.upper())),
                'type': 'stock',
                'exchange': exchange,
                '_priority': get_exchange_priority(exchange) + 200 # Boost direct matches
            })
    except Exception:
        pass
    
    # Third try: use Yahoo's internal search endpoint via a request if yfinance info was insufficient
    try:
        import requests
        url = f"https://query2.finance.yahoo.com/v1/finance/search?q={query}&quotesCount=10&newsCount=0"
        headers = {"User-Agent": "Mozilla/5.0"}
        resp = requests.get(url, headers=headers, timeout=5)
        if resp.ok:
            data = resp.json()
            for quote in data.get("quotes", []):
                symbol = quote.get("symbol")
                if not symbol: continue
                
                exchange = quote.get("exchange", "")
                results.append({
                    "symbol": symbol,
                    "name": quote.get("longname") or quote.get("shortname") or symbol,
                    "type": "stock",
                    "exchange": exchange,
                    "_priority": get_exchange_priority(exchange)
                })
    except Exception:
        pass

    # Dedupe and sort by priority
    deduped = []
    seen = set()
    
    # Also add fallback substring matches
    for symbol, name in FALLBACK_STOCKS.items():
        if query_lower in symbol.lower() or query_lower in name.lower():
            results.append({
                'symbol': symbol,
                'name': name,
                'type': 'stock',
                'exchange': 'NASDAQ/NYSE',
                '_priority': 500 # Fallback locals are usually high interest
            })

    for r in sorted(results, key=lambda x: x.get('_priority', 0), reverse=True):
        if r['symbol'] not in seen:
            seen.add(r['symbol'])
            # Clean up internal priority before returning
            final_r = {k: v for k, v in r.items() if k != '_priority'}
            deduped.append(final_r)
            
    return deduped[:10]


def search_symbols(query: str, search_type: str = "tradfi") -> list:
    """Search for symbols from Yahoo Finance or Binance APIs based on type."""
    if not query or len(query.strip()) < 1:
        return []
    
    results = []
    seen_symbols = set()
    query_lower = query.lower()
    
    try:
        if search_type == "tradfi":
            return search_yahoo_stocks(query)
            
        elif search_type == "crypto":
            # Check fallback first for exact/substring matches
            for symbol, name in FALLBACK_CRYPTO.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'crypto',
                        'exchange': 'Binance',
                        '_priority': 1000 if query_lower == symbol.lower() else 500
                    })
                    seen_symbols.add((symbol, 'crypto'))
            
            # Then try Binance/CoinGecko API for additional results
            crypto_results = search_binance_crypto(query)
            for result in crypto_results:
                key = (result['symbol'], result['type'])
                if key not in seen_symbols:
                    result['_priority'] = 100
                    results.append(result)
                    seen_symbols.add(key)
                    
            return [ {k:v for k,v in r.items() if k != '_priority'} 
                     for r in sorted(results, key=lambda x: x.get('_priority', 0), reverse=True) ][:10]

        else:
            # Both types
            stocks = search_yahoo_stocks(query)
            # Add crypto too
            cryptos = []
            for symbol, name in FALLBACK_CRYPTO.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    cryptos.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'crypto',
                        'exchange': 'Binance',
                        '_priority': 1000 if query_lower == symbol.lower() else 500
                    })
            
            combined = stocks + cryptos
            return [ {k:v for k,v in r.items() if k != '_priority'} 
                     for r in sorted(combined, key=lambda x: x.get('_priority', 0), reverse=True) ][:15]
    
    except Exception as e:
        return []


if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        try:
            input_data = json.loads(raw)
            query = input_data.get("query", "")
            search_type = input_data.get("type", "tradfi")
        except (json.JSONDecodeError, TypeError):
            query = raw
            search_type = "tradfi"
        
        results = search_symbols(query, search_type)
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps([]))

