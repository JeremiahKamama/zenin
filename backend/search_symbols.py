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
            })
            return results
    
    # Second try: use yfinance to validate and get info on potential matches
    try:
        import yfinance as yf
        
        # Try direct ticker lookup
        ticker = yf.Ticker(query.upper())
        info = ticker.info
        
        if info and 'symbol' in info and info.get('symbol'):
            results.append({
                'symbol': info['symbol'],
                'name': info.get('longName', info.get('shortName', query.upper())),
                'type': 'stock',
                'exchange': info.get('exchange', 'NASDAQ/NYSE'),
            })
            return results
    except Exception as e:
        pass
    
    # Third try: substring match in fallback database
    for symbol, name in FALLBACK_STOCKS.items():
        if query_lower in symbol.lower() or query_lower in name.lower():
            results.append({
                'symbol': symbol,
                'name': name,
                'type': 'stock',
                'exchange': 'NASDAQ/NYSE',
            })
    
    return results[:10]


def search_symbols(query: str, search_type: str = "tradfi") -> list:
    """Search for symbols from Yahoo Finance or Binance APIs based on type."""
    if not query or len(query.strip()) < 1:
        return []
    
    results = []
    seen_symbols = set()
    query_lower = query.lower()
    
    try:
        if search_type == "tradfi":
            # Check fallback first for exact/substring matches
            for symbol, name in FALLBACK_STOCKS.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'stock',
                        'exchange': 'NASDAQ/NYSE',
                    })
                    seen_symbols.add((symbol, 'stock'))
            
            # Then try Yahoo Finance API for additional results
            if len(results) < 5:  # Only if we have fewer than 5 results
                stock_results = search_yahoo_stocks(query)
                for result in stock_results:
                    key = (result['symbol'], result['type'])
                    if key not in seen_symbols:
                        results.append(result)
                        seen_symbols.add(key)
        elif search_type == "crypto":
            # Check fallback first for exact/substring matches
            for symbol, name in FALLBACK_CRYPTO.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'crypto',
                        'exchange': 'Binance',
                    })
                    seen_symbols.add((symbol, 'crypto'))
            
            # Then try Binance API for additional results
            if len(results) < 5:  # Only if we have fewer than 5 results
                crypto_results = search_binance_crypto(query)
                for result in crypto_results:
                    key = (result['symbol'], result['type'])
                    if key not in seen_symbols:
                        results.append(result)
                        seen_symbols.add(key)
        else:
            # Both types - check fallbacks first
            for symbol, name in FALLBACK_STOCKS.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'stock',
                        'exchange': 'NASDAQ/NYSE',
                    })
                    seen_symbols.add((symbol, 'stock'))
            
            for symbol, name in FALLBACK_CRYPTO.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'crypto',
                        'exchange': 'Binance',
                    })
                    seen_symbols.add((symbol, 'crypto'))
        
        return results[:10]
    
    except Exception as e:
        # Return fallback results
        query_lower = query.lower()
        results = []
        
        if search_type == "tradfi":
            for symbol, name in FALLBACK_STOCKS.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'stock',
                        'exchange': 'NASDAQ/NYSE',
                    })
        elif search_type == "crypto":
            for symbol, name in FALLBACK_CRYPTO.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'crypto',
                        'exchange': 'Binance',
                    })
        else:
            for symbol, name in FALLBACK_STOCKS.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'stock',
                        'exchange': 'NASDAQ/NYSE',
                    })
            
            for symbol, name in FALLBACK_CRYPTO.items():
                if query_lower in symbol.lower() or query_lower in name.lower():
                    results.append({
                        'symbol': symbol,
                        'name': name,
                        'type': 'crypto',
                        'exchange': 'Binance',
                    })
        
        return results[:10]


if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        # Parse input: could be JSON object {"query": "AAPL", "type": "tradfi"} or plain string
        try:
            input_data = json.loads(raw)
            query = input_data.get("query", "")
            search_type = input_data.get("type", "tradfi")
        except (json.JSONDecodeError, TypeError):
            # Fallback to plain string for backward compatibility
            query = raw
            search_type = "tradfi"
        
        results = search_symbols(query, search_type)
        print(json.dumps(results))
    except Exception as e:
        print(json.dumps([]))
