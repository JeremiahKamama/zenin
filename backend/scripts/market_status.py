#!/usr/bin/env python3
import datetime
import pytz

# Major Holidays for 2024-2025 (Simplified listing for critical markets)
# format: { "YYYY-MM-DD": ["MarketCode", ...] }
HOLIDAYS = {
    "2024-01-01": ["US", "UK", "HK", "JP", "KR", "AU"],
    "2024-01-02": ["JP"],
    "2024-01-15": ["US"],
    "2024-02-12": ["JP", "KR"],
    "2024-02-19": ["US"],
    "2024-03-29": ["US", "UK", "HK", "AU"],
    "2024-04-01": ["UK", "HK", "AU"],
    "2024-05-27": ["US", "UK"],
    "2024-06-19": ["US"],
    "2024-07-04": ["US"],
    "2024-09-02": ["US"],
    "2024-11-28": ["US"],
    "2024-12-25": ["US", "UK", "HK", "AU"],
    "2024-12-26": ["UK", "HK", "AU"],
    # 2025
    "2025-01-01": ["US", "UK", "HK", "JP", "KR", "AU"],
    "2025-01-20": ["US"],
    "2025-02-17": ["US"],
    "2025-04-18": ["US", "UK", "HK", "AU"],
    "2025-04-21": ["UK", "HK", "AU"],
    "2025-05-26": ["US", "UK"],
    "2025-06-19": ["US"],
    "2025-07-04": ["US"],
    "2025-09-01": ["US"],
    "2025-10-13": ["JP"],
    "2025-11-27": ["US"],
    "2025-12-25": ["US", "UK", "HK", "AU"],
}

MARKET_TIMEZONES = {
    "US": "America/New_York",
    "UK": "Europe/London",
    "HK": "Asia/Hong_Kong",
    "JP": "Asia/Tokyo",
    "KR": "Asia/Seoul",
    "AU": "Australia/Sydney",
}

def get_market_code(symbol: str) -> str:
    """Guess market code from symbol suffix."""
    if symbol.endswith(".HK"): return "HK"
    if symbol.endswith(".T"): return "JP"
    if symbol.endswith(".KS") or symbol.endswith(".KQ"): return "KR"
    if symbol.endswith(".AX"): return "AU"
    if symbol.endswith(".L"): return "UK"
    # Default to US for everything else (yfinance default)
    return "US"

def is_market_open(symbol: str, asset_type: str = "stock") -> dict:
    """
    Returns a dict with market status info.
    Crypto is always open.
    """
    if asset_type.lower() == "crypto":
        return {"isOpen": True, "status": "open", "reason": "Crypto 24/7"}

    market_code = get_market_code(symbol)
    tz_name = MARKET_TIMEZONES.get(market_code, "UTC")
    tz = pytz.timezone(tz_name)
    now = datetime.datetime.now(tz)
    
    date_str = now.strftime("%Y-%m-%d")
    day_of_week = now.weekday() # 0=Mon, 6=Sun

    # 1. Weekend Check
    if day_of_week >= 5:
        return {"isOpen": False, "status": "closed", "reason": "Weekend"}

    # 2. Holiday Check
    market_holidays = HOLIDAYS.get(date_str, [])
    if market_code in market_holidays:
        return {"isOpen": False, "status": "closed", "reason": f"Market Holiday ({market_code})"}

    # 3. Hours Check (Simplified 9:30 AM - 4:00 PM)
    # Most markets operate roughly in this window (adjusted for TZ)
    current_time = now.time()
    open_time = datetime.time(9, 30)
    close_time = datetime.time(16, 0)

    if current_time < open_time:
        return {"isOpen": False, "status": "closed", "reason": "Before Market Open"}
    if current_time > close_time:
        return {"isOpen": False, "status": "closed", "reason": "After Market Close"}

    return {"isOpen": True, "status": "open", "reason": f"Market Trading ({market_code})"}

if __name__ == "__main__":
    # Quick test
    import sys
    import json
    if len(sys.argv) > 1:
        print(json.dumps(is_market_open(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "stock")))
