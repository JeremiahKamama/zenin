#!/usr/bin/env python3
import json
import math
import sys
from datetime import date, datetime

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


def _safe_number(value):
    try:
        if value is None:
            return None
        numeric = float(value)
        if math.isnan(numeric) or math.isinf(numeric):
            return None
        if numeric.is_integer():
            return int(numeric)
        return numeric
    except Exception:
        return None


def _clean_text(value):
    text = str(value or "").strip()
    return text or None


def _normalize_json(value):
    if value is None:
        return None

    if isinstance(value, dict):
        return {str(key): _normalize_json(val) for key, val in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_normalize_json(item) for item in value]

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, (str, bool, int)):
        return value

    if isinstance(value, float):
        return _safe_number(value)

    normalized_num = _safe_number(value)
    if normalized_num is not None:
        return normalized_num

    if hasattr(value, "item"):
        try:
            return _normalize_json(value.item())
        except Exception:
            pass

    return _clean_text(value)


def _extract_recent_earnings(ticker):
    rows = []
    try:
        earnings_dates = ticker.earnings_dates
        if earnings_dates is None or getattr(earnings_dates, "empty", False):
            return rows

        frame = earnings_dates.copy()
        try:
            frame = frame.sort_index(ascending=False)
        except Exception:
            pass

        for idx, row in frame.head(8).iterrows():
            rows.append({
                "date": _normalize_date_str(idx),
                "epsEstimate": _safe_number(row.get("EPS Estimate")),
                "reportedEps": _safe_number(row.get("Reported EPS")),
                "surprisePct": _safe_number(row.get("Surprise(%)")),
            })
    except Exception:
        return []
    return rows


def _extract_leadership(info):
    officers = info.get("companyOfficers") or []
    leadership = []
    for officer in officers[:10]:
        if not isinstance(officer, dict):
            continue
        leadership.append({
            "name": _clean_text(officer.get("name")),
            "title": _clean_text(officer.get("title")),
            "age": _safe_number(officer.get("age")),
            "yearBorn": _safe_number(officer.get("yearBorn")),
            "totalPay": _safe_number(officer.get("totalPay")),
        })
    return leadership


def fetch_company_profile(symbol):
    ticker = yf.Ticker(symbol)
    info = ticker.info or {}
    calendar = ticker.calendar

    calendar_dict = {}
    try:
        if hasattr(calendar, "to_dict"):
            calendar_dict = calendar.to_dict() or {}
        elif isinstance(calendar, dict):
            calendar_dict = calendar
    except Exception:
        calendar_dict = {}

    eps_consensus = calendar_dict.get("Earnings Average") or calendar_dict.get("EPS Estimate")
    revenue_consensus = calendar_dict.get("Revenue Average") or calendar_dict.get("Revenue Estimate")
    if isinstance(eps_consensus, list):
        eps_consensus = eps_consensus[0] if eps_consensus else None
    if isinstance(revenue_consensus, list):
        revenue_consensus = revenue_consensus[0] if revenue_consensus else None

    payload = {
        "symbol": str(symbol or "").upper(),
        "name": info.get("longName") or info.get("shortName") or str(symbol or "").upper(),
        "shortName": info.get("shortName"),
        "website": info.get("website"),
        "phone": info.get("phone"),
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "currency": info.get("currency"),
        "sector": info.get("sectorDisp") or info.get("sector"),
        "industry": info.get("industryDisp") or info.get("industry"),
        "country": info.get("country"),
        "state": info.get("state"),
        "city": info.get("city"),
        "zip": info.get("zip"),
        "address1": info.get("address1"),
        "summary": info.get("longBusinessSummary") or info.get("businessSummary"),
        "employees": info.get("fullTimeEmployees"),
        "marketCap": info.get("marketCap"),
        "enterpriseValue": info.get("enterpriseValue"),
        "currentPrice": info.get("currentPrice") or info.get("regularMarketPrice"),
        "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
        "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
        "beta": info.get("beta"),
        "trailingPE": info.get("trailingPE"),
        "forwardPE": info.get("forwardPE"),
        "priceToBook": info.get("priceToBook"),
        "enterpriseToRevenue": info.get("enterpriseToRevenue"),
        "enterpriseToEbitda": info.get("enterpriseToEbitda"),
        "dividendYield": info.get("dividendYield"),
        "totalRevenue": info.get("totalRevenue"),
        "revenueGrowth": info.get("revenueGrowth"),
        "earningsGrowth": info.get("earningsGrowth"),
        "grossMargins": info.get("grossMargins"),
        "operatingMargins": info.get("operatingMargins"),
        "ebitdaMargins": info.get("ebitdaMargins"),
        "profitMargins": info.get("profitMargins"),
        "freeCashflow": info.get("freeCashflow"),
        "operatingCashflow": info.get("operatingCashflow"),
        "returnOnAssets": info.get("returnOnAssets"),
        "returnOnEquity": info.get("returnOnEquity"),
        "totalCash": info.get("totalCash"),
        "totalDebt": info.get("totalDebt"),
        "debtToEquity": info.get("debtToEquity"),
        "currentRatio": info.get("currentRatio"),
        "quickRatio": info.get("quickRatio"),
        "targetMeanPrice": info.get("targetMeanPrice"),
        "targetHighPrice": info.get("targetHighPrice"),
        "targetLowPrice": info.get("targetLowPrice"),
        "analystRating": info.get("recommendationKey"),
        "analystCount": info.get("numberOfAnalystOpinions"),
        "earnings": {
            "nextEarnings": _extract_next_earnings(calendar),
            "eps": {
                "consensus": eps_consensus or info.get("forwardEps"),
                "previous": info.get("trailingEps"),
            },
            "revenue": {
                "consensus": revenue_consensus,
                "previous": info.get("totalRevenue"),
            },
        },
        "earningsHistory": _extract_recent_earnings(ticker),
        "leadership": _extract_leadership(info),
        "risk": {
            "overallRisk": info.get("overallRisk"),
            "auditRisk": info.get("auditRisk"),
            "boardRisk": info.get("boardRisk"),
            "compensationRisk": info.get("compensationRisk"),
            "shareHolderRightsRisk": info.get("shareHolderRightsRisk"),
        },
    }

    return _normalize_json(payload)


if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        data = json.loads(raw or "{}")
        symbol = str(data.get("symbol") or "").strip()
        if not symbol:
            print(json.dumps({"error": "No symbol provided"}))
            sys.exit(0)
        print(json.dumps(fetch_company_profile(symbol)))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
