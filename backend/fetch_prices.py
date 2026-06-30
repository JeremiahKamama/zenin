import sys
import json
import os
import yfinance as yf
import requests

# Add scripts directory to path for market_status import
sys.path.append(os.path.join(os.path.dirname(__file__), "scripts"))
try:
    from market_status import is_market_open
except ImportError:
    # Fallback if scripts folder structure is different
    def is_market_open(symbol, asset_type):
        return {"isOpen": True, "status": "open"}

# ---------------------------------------------------------------------------
# Symbol -> Yahoo Finance ticker mapping
# ---------------------------------------------------------------------------
EXPLICIT_MAP = {
    "EURUSD": "EURUSD=X",
    "USDJPY": "JPY=X",
    "GBPUSD": "GBPUSD=X",
    "USDCAD": "CAD=X",
    "USDCHF": "CHF=X",
    "AUDUSD": "AUDUSD=X",
    "NZDUSD": "NZDUSD=X",
    "EURGBP": "EURGBP=X",
    "EURJPY": "EURJPY=X",
    "GBPJPY": "GBPJPY=X",
    "EUR/USD": "EURUSD=X",
    "USD/JPY": "JPY=X",
    "GBP/USD": "GBPUSD=X",
    "USD/CAD": "CAD=X",
    "USD/CHF": "CHF=X",
    "AUD/USD": "AUDUSD=X",
    "NZD/USD": "NZDUSD=X",
    "EUR/GBP": "EURGBP=X",
    "EUR/JPY": "EURJPY=X",
    "GBP/JPY": "GBPJPY=X",
    "VIX": "^VIX",
    "MOVE": "^MOVE",
    "US10Y": "^TNX",
    "UST10Y": "^TNX",
    "UST30Y": "^TYX",
    "UST5Y":  "^FVX",
    "XAU":    "GC=F",
    "WTI":    "CL=F",
    "DXY":    "DX-Y.NYB",
    "SLX.AXS":          "SLX.AX",
    "034020.KS":        "034020.KS",
    "000660.KS":        "000660.KS",
    "373220":           "373220.KS",
    "CATL":             "300750.SZ",
    "1211":             "1211.HK",
    "3816.HK":          "3816.HK",
    "0981.HK":          "0981.HK",
    "2513.HK":          "2513.HK",
    "300308.SZ":        "300308.SZ",
    "8058.T":           "8058.T",
    "5210.T":           "5210.T",
    "6239.TW":          "6239.TW",
    "2337.TW":          "2337.TW",
    "SMTOY":            "SMTOY",
    "KYOCY":            "KYOCY",
    "6965":             "6965.T",
    "4062":             "4062.T",
    "6146":             "6146.T",
    "6754":             "6754.T",
    "9432":             "9432.T",
    "AW1(ASX)":         "AW1.AX",
    "Salik":            "SALIK.AE",
    "SALIK":            "SALIK.AE",
    "LYSDY":            "LYSDY",
    "ILU":              "ILU.AX",
    "ARU":              "ARU.AX",
    "SYR":              "SYR.AX",
    "NEO":              "NEO.TO",
    "ENR":              "ENR.DE",
    # Commodities
    "CL":     "CL=F",
    "NG":     "NG=F",
    "RB":     "RB=F",
    "GC":     "GC=F",
    "SI":     "SI=F",
    "HG":     "HG=F",
    "ZC":     "ZC=F",
    "ZW":     "ZW=F",
    "ZS":     "ZS=F",
    "KC":     "KC=F",
    "CC":     "CC=F",
    "SB":     "SB=F",
    "CT":     "CT=F",
    "LE=F":   "LE=F",
    "GF=F":   "GF=F",
    "HE=F":   "HE=F",
    "DC=F":   "DC=F",
    "ALI=F":  "ALI=F",
    "ZNC=F":  "ZNC=F",
    "LED=F":  "LED=F",
    "TIO=F":  "TIO=F",
    "JJN":    "JJN",
    "ZO=F":   "ZO=F",
    "ZR=F":   "ZR=F",
    "ZL=F":   "ZL=F",
    "ZM=F":   "ZM=F",
    "OJ=F":   "OJ=F",
    "LBR=F":  "LBR=F",
}

def normalise(symbol: str) -> str:
    if symbol in EXPLICIT_MAP:
        return EXPLICIT_MAP[symbol]
    if "." in symbol:
        return symbol
    if symbol.isdigit():
        return f"{int(symbol):04d}.HK"
    return symbol

FOREX_QUOTE_CURRENCY = {
    "EURUSD": "USD",
    "EUR/USD": "USD",
    "GBPUSD": "USD",
    "GBP/USD": "USD",
    "AUDUSD": "USD",
    "AUD/USD": "USD",
    "NZDUSD": "USD",
    "NZD/USD": "USD",
    "USDJPY": "JPY",
    "USD/JPY": "JPY",
    "USDCAD": "CAD",
    "USD/CAD": "CAD",
    "USDCHF": "CHF",
    "USD/CHF": "CHF",
    "EURGBP": "GBP",
    "EUR/GBP": "GBP",
    "EURJPY": "JPY",
    "EUR/JPY": "JPY",
    "GBPJPY": "JPY",
    "GBP/JPY": "JPY",
    "JPY=X": "JPY",
    "CAD=X": "CAD",
    "CHF=X": "CHF",
    "EURUSD=X": "USD",
    "GBPUSD=X": "USD",
    "AUDUSD=X": "USD",
    "NZDUSD=X": "USD",
    "EURGBP=X": "GBP",
    "EURJPY=X": "JPY",
    "GBPJPY=X": "JPY",
}


def infer_currency(symbol: str, original_symbol: str = "") -> str:
    original = str(original_symbol or "").upper()
    s = str(symbol or "").upper()

    if original in FOREX_QUOTE_CURRENCY:
        return FOREX_QUOTE_CURRENCY[original]
    if s in FOREX_QUOTE_CURRENCY:
        return FOREX_QUOTE_CURRENCY[s]

    if "/" in original:
        parts = original.split("/")
        if len(parts) == 2 and len(parts[1]) == 3:
            return parts[1]

    if len(original) == 6 and original.isalpha():
        return original[3:]

    if s.endswith(".T"): return "JPY"
    if s.endswith(".L"): return "GBP"
    if any(s.endswith(ext) for ext in [".DE", ".F", ".PA", ".MI", ".VI", ".AS", ".BR", ".LI", ".MC"]): return "EUR"
    if any(s.endswith(ext) for ext in [".TO", ".V"]): return "CAD"
    if s.endswith(".AX"): return "AUD"
    if s.endswith(".HK"): return "HKD"
    if any(s.endswith(ext) for ext in [".KS", ".KQ"]): return "KRW"
    if any(s.endswith(ext) for ext in [".SZ", ".SS"]): return "CNY"
    if s.endswith(".TW"): return "TWD"
    if any(s.endswith(ext) for ext in [".BO", ".NS"]): return "INR"
    if s.endswith(".SW"): return "CHF"
    if s.endswith(".MX"): return "MXN"
    if s.endswith(".SA"): return "BRL"
    if s.endswith(".AE"): return "AED"
    return "USD"

def _extract_close(data, yf_symbol: str):
    if data is None or data.empty:
        return None
    cols = data.columns
    if hasattr(cols, "levels") and len(cols.levels) == 2:
        if ("Close", yf_symbol) in cols:
            return data[("Close", yf_symbol)].dropna()
        close_level = [c for c in cols if c[0] == "Close"]
        if close_level:
            s = data[close_level[0]].dropna()
            return s if not s.empty else None
    if "Close" in cols:
        s = data["Close"]
        if hasattr(s, "columns"):
            if yf_symbol in s.columns:
                return s[yf_symbol].dropna()
            return None
        return s.dropna()
    return None

def _price_and_change(series):
    if series is None or len(series) == 0:
        return None, None
    price = float(series.iloc[-1])
    change_pct = None
    if len(series) >= 2:
        prev = float(series.iloc[-2])
        if prev:
            change_pct = round(((price - prev) / prev) * 100, 4)
    return round(price, 8), change_pct

def _price_and_change_from_chart(meta, closes):
    normalized_closes = [float(value) for value in (closes or []) if value is not None]
    price = meta.get("regularMarketPrice")
    price = float(price) if price is not None else None

    if price is None and normalized_closes:
        price = normalized_closes[-1]
    if price is None:
        return None, None

    prev = meta.get("previousClose")
    if prev is None:
        prev = meta.get("chartPreviousClose")
    if prev is None and len(normalized_closes) >= 2:
        prev = normalized_closes[-2]

    change_pct = None
    if prev not in (None, 0):
        prev = float(prev)
        if prev:
            change_pct = round(((price - prev) / prev) * 100, 4)

    return round(price, 8), change_pct

def _fetch_from_yahoo_chart(yf_symbol: str):
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
        "Accept": "application/json,text/plain,*/*"
    }
    urls = [
        f"https://query1.finance.yahoo.com/v8/finance/chart/{yf_symbol}?interval=1d&range=5d&includePrePost=false",
        f"https://query2.finance.yahoo.com/v8/finance/chart/{yf_symbol}?interval=1d&range=5d&includePrePost=false",
    ]

    for url in urls:
        try:
            response = requests.get(url, headers=headers, timeout=8)
            if not response.ok:
                continue
            payload = response.json()
            results = (((payload or {}).get("chart") or {}).get("result")) or []
            if not results:
                continue
            result = results[0] or {}
            meta = result.get("meta") or {}
            quote_rows = (((result.get("indicators") or {}).get("quote")) or [{}])
            closes = (quote_rows[0] or {}).get("close") or []
            price, change_pct = _price_and_change_from_chart(meta, closes)
            if price is not None:
                return price, change_pct
        except Exception:
            continue

    return None, None

def _fetch_single(yf_symbol: str):
    try:
        hist = yf.Ticker(yf_symbol).history(period="5d")
        if not hist.empty:
            price, change_pct = _price_and_change(hist["Close"].dropna())
            if price is not None:
                return price, change_pct
    except Exception:
        pass
    price, change_pct = _fetch_from_yahoo_chart(yf_symbol)
    if price is not None:
        return price, change_pct
    try:
        info = yf.Ticker(yf_symbol).info
        price = info.get("regularMarketPrice") or info.get("currentPrice") or info.get("previousClose")
        prev = info.get("previousClose") or info.get("regularMarketPreviousClose")
        if price is not None:
            price = float(price)
            change_pct = None
            if prev and float(prev):
                change_pct = round(((price - float(prev)) / float(prev)) * 100, 4)
            return price, change_pct
    except Exception:
        pass
    return None, None

def fetch_prices(requests: list) -> dict:
    if not requests:
        return {}

    # Map inputs
    results = {}
    yf_to_reqs = {}
    
    for req in requests:
        orig = req["symbol"]
        atype = req.get("type", "stock")
        yf_sym = normalise(orig)
        
        # Check market status first
        status_info = is_market_open(yf_sym, atype)
        
        if yf_sym not in yf_to_reqs:
            yf_to_reqs[yf_sym] = []
        yf_to_reqs[yf_sym].append({
            "orig": orig, 
            "isOpen": status_info["isOpen"], 
            "status": status_info["status"]
        })

    yf_symbols = list(yf_to_reqs.keys())
    batch_size = 50
    batches = [yf_symbols[i:i + batch_size] for i in range(0, len(yf_symbols), batch_size)]

    for batch in batches:
        try:
            data = yf.download(batch, period="5d", auto_adjust=True, progress=False)
        except Exception:
            data = None

        for yf_sym in batch:
            price, change_pct = None, None
            if data is not None and not data.empty:
                series = _extract_close(data, yf_sym)
                price, change_pct = _price_and_change(series)

            if price is None:
                price, change_pct = _fetch_single(yf_sym)

            for item in yf_to_reqs[yf_sym]:
                results[item["orig"]] = {
                    "price": price,
                    "priceChangePercent": change_pct,
                    "isMarketOpen": item["isOpen"],
                    "marketStatus": item["status"],
                    "currency": infer_currency(yf_sym, item["orig"])
                }

    return results

if __name__ == "__main__":
    raw = sys.stdin.read().strip()
    try:
        # Expecting list of {symbol, type}
        data_in = json.loads(raw)
        if not isinstance(data_in, list):
            data_in = []
        # Compatibility with old array of strings
        if data_in and isinstance(data_in[0], str):
            data_in = [{"symbol": s, "type": "stock"} for s in data_in]
            
        prices = fetch_prices(data_in)
        print(json.dumps(prices))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
