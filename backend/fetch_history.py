#!/usr/bin/env python3
import sys
import json
import yfinance as yf
from datetime import datetime, timedelta

def fetch_history(symbol, period="1mo", interval="1d"):
    try:
        ticker = yf.Ticker(symbol)
        hist = ticker.history(period=period, interval=interval)
        
        if hist.empty:
            return []
            
        # Format the data for charting
        results = []
        for index, row in hist.iterrows():
            # index is timestamp
            results.append({
                "time": index.strftime('%Y-%m-%d %H:%M'),
                "open": round(float(row['Open']), 4),
                "high": round(float(row['High']), 4),
                "low": round(float(row['Low']), 4),
                "close": round(float(row['Close']), 4),
                "volume": round(float(row['Volume']), 2),
                "price": round(float(row['Close']), 4) # legacy support
            })
        return results
    except Exception as e:
        return []

if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        input_data = json.loads(raw)
        
        symbol = input_data.get("symbol")
        period = input_data.get("period", "1mo")
        interval = input_data.get("interval", "1d")
        
        if not symbol:
            print(json.dumps([]))
            sys.exit(0)
            
        history = fetch_history(symbol, period, interval)
        print(json.dumps(history))
    except Exception as e:
        print(json.dumps([]))
