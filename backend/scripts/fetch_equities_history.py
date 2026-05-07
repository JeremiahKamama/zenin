import yfinance as yf
import pandas as pd
import json
import sys

def get_history(tickers, period="5y"):
    data = {}
    for ticker in tickers:
        try:
            t = yf.Ticker(ticker)
            info = t.info
            hist = t.history(period=period)
            if hist.empty:
                continue
            # Yearly returns
            yearly = hist['Close'].resample('YE').last().pct_change() * 100
            data[ticker] = {
                "yearly": yearly.dropna().to_dict(),
                "daily": hist['Close'].pct_change().dropna().tail(252).tolist(), # Last 1 year of daily returns
                "current": hist['Close'].iloc[-1],
                "fundamentals": {
                    "pe": info.get("trailingPE"),
                    "pb": info.get("priceToBook"),
                    "yield": info.get("dividendYield")
                }
            }
        except Exception as e:
            print(f"Error fetching {ticker}: {e}", file=sys.stderr)
    return data

if __name__ == "__main__":
    tickers = ["SPY", "ACWI", "EEM", "VNQ"]
    history = get_history(tickers)
    print(json.dumps(history))
