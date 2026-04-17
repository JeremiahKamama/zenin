#!/usr/bin/env python3
import sys
import json
from datetime import datetime, date
import yfinance as yf

def _normalize_date_str(value):
    if value is None:
        return None

    if isinstance(value, (list, tuple)):
        for item in value:
            parsed = _normalize_date_str(item)
            if parsed:
                return parsed
        return None

    try:
        if hasattr(value, "to_pydatetime"):
            value = value.to_pydatetime()
    except Exception:
        pass

    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = str(value).strip()
    if not text or text.lower() in {"nan", "none"}:
        return None

    # Common yfinance formats: "2026-05-01 00:00:00", "2026-05-01"
    if len(text) >= 10:
        candidate = text[:10].replace("/", "-")
        try:
            datetime.fromisoformat(candidate)
            return candidate
        except Exception:
            pass

    return None

def _extract_next_earnings(calendar):
    candidates = []
    try:
        if isinstance(calendar, dict):
            earnings_date = calendar.get("Earnings Date")
            if isinstance(earnings_date, dict):
                candidates.extend(list(earnings_date.values()))
            else:
                candidates.append(earnings_date)
        elif hasattr(calendar, "to_dict"):
            cal_dict = calendar.to_dict()
            if isinstance(cal_dict, dict):
                earnings_date = cal_dict.get("Earnings Date")
                if isinstance(earnings_date, dict):
                    candidates.extend(list(earnings_date.values()))
                else:
                    candidates.append(earnings_date)
    except Exception:
        pass

    today = date.today()
    parsed_dates = []
    for raw in candidates:
        normalized = _normalize_date_str(raw)
        if not normalized:
            continue
        try:
            parsed = datetime.fromisoformat(normalized).date()
            if parsed >= today:
                parsed_dates.append(parsed)
        except Exception:
            continue

    if not parsed_dates:
        return None
    return min(parsed_dates).isoformat()

def fetch_earnings(symbol: str) -> dict:
    try:
        ticker = yf.Ticker(symbol)
        info = ticker.info

        # Market cap
        market_cap = info.get("marketCap")

        # EPS
        eps_current = info.get("trailingEps")
        eps_forward = info.get("forwardEps")

        # Revenue
        revenue_current = info.get("totalRevenue")
        revenue_forward = info.get("revenueEstimate") or info.get("revenuePerShare")

        # Try earnings calendar for consensus
        calendar = ticker.calendar
        eps_consensus = None
        revenue_consensus = None

        if calendar is not None:
            try:
                if hasattr(calendar, 'to_dict'):
                    cal_dict = calendar.to_dict()
                elif isinstance(calendar, dict):
                    cal_dict = calendar
                else:
                    cal_dict = {}

                eps_consensus = cal_dict.get("Earnings Average") or cal_dict.get("EPS Estimate")
                revenue_consensus = cal_dict.get("Revenue Average") or cal_dict.get("Revenue Estimate")

                # Handle list values
                if isinstance(eps_consensus, list):
                    eps_consensus = eps_consensus[0] if eps_consensus else None
                if isinstance(revenue_consensus, list):
                    revenue_consensus = revenue_consensus[0] if revenue_consensus else None
            except Exception:
                pass

        # Next upcoming earnings date (future-only)
        next_earnings = _extract_next_earnings(calendar)

        # Analyst recommendations summary
        recommend = info.get("recommendationKey", "")
        target_price = info.get("targetMeanPrice")
        analyst_count = info.get("numberOfAnalystOpinions")

        valuation = {
            "trailingPe": info.get("trailingPE"),
            "forwardPe": info.get("forwardPE"),
            "priceToSales": info.get("priceToSalesTrailing12Months"),
            "enterpriseToEbitda": info.get("enterpriseToEbitda")
        }

        profile = {
            "beta": info.get("beta"),
            "dividendYield": info.get("dividendYield"),
            "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
            "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
            "averageVolume": info.get("averageVolume")
        }

        return {
            "marketCap": market_cap,
            "eps": {
                "consensus": eps_consensus or eps_forward,
                "previous": eps_current,
            },
            "revenue": {
                "consensus": revenue_consensus,
                "previous": revenue_current,
            },
            "nextEarnings": next_earnings,
            "analystRating": recommend,
            "targetPrice": target_price,
            "analystCount": analyst_count,
            "valuation": valuation,
            "profile": profile,
        }

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        data = json.loads(raw)
        symbols = data.get("symbols")
        if isinstance(symbols, list):
            items = []
            for sym in symbols:
                safe_sym = str(sym or "").strip()
                if not safe_sym:
                    continue
                result = fetch_earnings(safe_sym)
                items.append({
                    "symbol": safe_sym,
                    "nextEarnings": result.get("nextEarnings"),
                    "error": result.get("error")
                })
            print(json.dumps({"items": items}))
            sys.exit(0)

        symbol = data.get("symbol", "")
        if not symbol:
            print(json.dumps({"error": "No symbol provided"}))
            sys.exit(0)
        result = fetch_earnings(symbol)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
