import sys
import json
import os
import yfinance as yf

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
    "UST10Y": "^TNX",
    "UST30Y": "^TYX",
    "UST5Y":  "^FVX",
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
    "LYSDY":            "LYSDY",
    "ILU":              "ILU.AX",
    "ARU":              "ARU.AX",
    "SYR":              "SYR.AX",
    "NEO":              "NEO.TO",
    "ENR":              "ENR.DE",
}

def normalise(symbol: str) -> str:
    if symbol in EXPLICIT_MAP:
        return EXPLICIT_MAP[symbol]
    if "." in symbol:
        return symbol
    if symbol.isdigit():
        return f"{int(symbol):04d}.HK"
    return symbol

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

def _fetch_single(yf_symbol: str):
    try:
        hist = yf.Ticker(yf_symbol).history(period="5d")
        if hist.empty:
            return None, None
        return _price_and_change(hist["Close"].dropna())
    except Exception:
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
                    "marketStatus": item["status"]
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
