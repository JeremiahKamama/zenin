#!/usr/bin/env python3
"""
fetch_prices.py — fetch close price + daily % change via yfinance.

Key fixes for stocks:
  1. Symbol normalisation  – maps your data.js symbols to valid Yahoo Finance
     ticker format before any request is made.
  2. Per-ticker fallback   – if a batch download misses a symbol (common for
     international tickers), we retry it individually with yf.Ticker().
  3. Correct MultiIndex    – handles the (Price, Ticker) MultiIndex introduced
     in yfinance >= 0.2.50.
  4. Accurate % change     – previous-trading-day close vs today's close,
     not open vs close.
"""

import sys
import json
import yfinance as yf

# ---------------------------------------------------------------------------
# Symbol -> Yahoo Finance ticker mapping
# ---------------------------------------------------------------------------
# Yahoo Finance conventions:
#   Tokyo Stock Exchange  : append .T        e.g. 8058.T, 5210.T
#   Taiwan (TWSE)         : append .TW       e.g. 6239.TW, 2337.TW
#   Hong Kong             : pad to 4 digits + .HK  e.g. 1211 -> 1211.HK
#   Korea (KRX)           : .KS (KOSPI) or .KQ (KOSDAQ)
#   Shenzhen              : append .SZ       e.g. 300308.SZ
#   Australian (ASX)      : append .AX       e.g. ILU -> ILU.AX
#   US tickers            : no suffix needed
#
# Symbols that use non-standard formats in data.js are mapped explicitly;
# everything else goes through the automatic rules below.

EXPLICIT_MAP = {
    # data.js symbol    : Yahoo Finance ticker
    # FROM — no entry for treasury symbols
# TO — add these three lines to EXPLICIT_MAP:
    "UST10Y": "^TNX",   # 10-Year Treasury Yield
    "UST30Y": "^TYX",   # 30-Year Treasury Yield
    "UST5Y":  "^FVX",   # 5-Year Treasury Yield
    "SLX.AXS":          "SLX.AX",       # Silex Systems (ASX — .AXS is not valid)
    "034020.KS":        "034020.KS",    # DooSan Enerbility
    "000660.KS":        "000660.KS",    # SK Hynix
    "373220":           "373220.KS",    # LG Energy Solution (missing .KS suffix)
    "CATL":             "300750.SZ",    # Contemporary Amperex (Shenzhen A-share)
    "1211":             "1211.HK",      # BYD (Hong Kong)
    "3816.HK":          "3816.HK",
    "0981.HK":          "0981.HK",
    "2513.HK":          "2513.HK",
    "300308.SZ":        "300308.SZ",
    "8058.T":           "8058.T",
    "5210.T":           "5210.T",
    "6239.TW":          "6239.TW",
    "2337.TW":          "2337.TW",
    "SMTOY":            "SMTOY",        # Sumitomo Electric ADR (OTC)
    "KYOCY":            "KYOCY",        # Kyocera ADR (OTC)
    "6965":             "6965.T",       # Hamamatsu Photonics (Tokyo)
    "4062":             "4062.T",       # Ibiden (Tokyo)
    "6146":             "6146.T",       # DISCO (Tokyo)
    "6754":             "6754.T",       # Anritsu (Tokyo)
    "9432":             "9432.T",       # NTT (Tokyo)
    "AW1(ASX)":         "AW1.AX",       # American West Metals (ASX)
    "Salik":            "SALIK.AE",     # Salik (Abu Dhabi — may be unavailable)
    "LYSDY":            "LYSDY",        # Lynas Rare Earths ADR (OTC)
    "ILU":              "ILU.AX",       # Iluka Resources (ASX)
    "ARU":              "ARU.AX",       # Arafura Rare Earths (ASX)
    "SYR":              "SYR.AX",       # Syrah Resources (ASX)
    "NEO":              "NEO.TO",       # Neo Performance Materials (Toronto)
    "ENR":              "ENR.DE",       # Siemens Energy (Frankfurt)
    "ALOY":             "ALOY",         # REalloys — OTC, may have limited data
    "USAR":             "USAR",         # USA Rare Earth — check OTC availability
}


def normalise(symbol: str) -> str:
    """Return the Yahoo Finance ticker for a data.js symbol string."""
    if symbol in EXPLICIT_MAP:
        return EXPLICIT_MAP[symbol]
    # Already carries an exchange suffix -> trust it
    if "." in symbol:
        return symbol
    # Pure numeric string -> assume Hong Kong, pad to 4 digits
    if symbol.isdigit():
        return f"{int(symbol):04d}.HK"
    # Everything else treated as a US ticker
    return symbol


# ---------------------------------------------------------------------------
# Price extraction helpers
# ---------------------------------------------------------------------------

def _extract_close(data, yf_symbol: str):
    """
    Pull the Close series for yf_symbol from a yf.download() DataFrame.
    Handles both the old (flat) and new (MultiIndex) column layouts.
    """
    if data is None or data.empty:
        return None

    cols = data.columns

    # Modern yfinance (>=0.2.50): MultiIndex columns ('Price', 'Ticker')
    if hasattr(cols, "levels") and len(cols.levels) == 2:
        if ("Close", yf_symbol) in cols:
            return data[("Close", yf_symbol)].dropna()
        # Single-ticker batch: ticker level may be empty string
        close_level = [c for c in cols if c[0] == "Close"]
        if close_level:
            s = data[close_level[0]].dropna()
            return s if not s.empty else None

    # Flat columns (multi_level_index=False or older yfinance)
    if "Close" in cols:
        s = data["Close"]
        if hasattr(s, "columns"):   # DataFrame with multiple tickers
            if yf_symbol in s.columns:
                return s[yf_symbol].dropna()
            return None
        return s.dropna()

    return None


def _price_and_change(series):
    """Return (price, change_pct) from a Close series, or (None, None)."""
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
    """Fallback: fetch one ticker individually via yf.Ticker().history()."""
    try:
        hist = yf.Ticker(yf_symbol).history(period="5d")
        if hist.empty:
            return None, None
        return _price_and_change(hist["Close"].dropna())
    except Exception:
        return None, None


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def fetch_prices(symbols: list) -> dict:
    if not symbols:
        return {}

    # Map every original symbol to its Yahoo Finance equivalent
    sym_map = {s: normalise(s) for s in symbols}
    # Deduplicated list of YF tickers to request
    yf_symbols = list(dict.fromkeys(sym_map.values()))

    results = {}

    # Process in batches of 50 to avoid timeout with large lists
    batch_size = 50
    batches = [yf_symbols[i:i + batch_size] for i in range(0, len(yf_symbols), batch_size)]

    for batch in batches:
        # Batch download — 5 days gives at least 2 trading sessions
        try:
            data = yf.download(
                batch,
                period="5d",
                auto_adjust=True,
                progress=False,
            )
        except Exception:
            data = None

        # Extract each symbol, falling back to individual requests when needed
        for orig, yf_sym in sym_map.items():
            if yf_sym not in batch or orig in results:
                # Already processed in a previous batch, skip
                continue

            price, change_pct = None, None

            if data is not None and not data.empty:
                series = _extract_close(data, yf_sym)
                price, change_pct = _price_and_change(series)

            # Individual retry for anything the batch missed
            if price is None:
                price, change_pct = _fetch_single(yf_sym)

            results[orig] = {
                "price": price,
                "priceChangePercent": change_pct,
            }

    return results


if __name__ == "__main__":
    raw = sys.stdin.read().strip()
    try:
        symbols = json.loads(raw)
        prices = fetch_prices(symbols)
        print(json.dumps(prices))
    except Exception as e:
        print(json.dumps({"error": str(e)}))