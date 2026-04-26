#!/usr/bin/env python3
import sys
import json
import re
import html as html_lib
import requests
from datetime import datetime, date
import yfinance as yf

def _safe_number(value):
    try:
        if value is None: return None
        import math
        numeric = float(value)
        if math.isnan(numeric) or math.isinf(numeric): return None
        if numeric.is_integer(): return int(numeric)
        return numeric
    except:
        return None

def _get_top_analyst_target(ratings):
    TOP_TIER_AGENCIES = {
        "goldman sachs", "ms", "morgan stanley", "jp morgan", "jpmorgan", "bofA", "bank of america", "citi", "barclays",
        "wells fargo", "rbc", "bmo", "piper sandler", "wedbush", "oppenheimer", "bernstein", "evercore", "mizuho",
        "stifel", "raymond james", "jefferies", "keybanc", "canaccord", "cowen", "wolfe research", "hsbc", "ubs",
        "deutsche bank", "normura", "socgen", "bnp paribas"
    }
    if not ratings or not isinstance(ratings, list): return None, None
    reputable = []
    for r in ratings:
        analyst = str(r.get("analyst") or "").lower()
        if any(tier in analyst for tier in TOP_TIER_AGENCIES):
            reputable.append(r)
    if not reputable: return None, None
    top = reputable[0]
    try:
        val_str = top.get("price_target").replace("$", "").split("→")[-1].strip()
        return _safe_number(val_str), top.get("analyst")
    except:
        return None, None

def _fetch_finviz_raw(symbol):
    url = f"https://finviz.com/quote.ashx?t={symbol.upper()}"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        return resp.text if resp.status_code == 200 else None
    except: return None

def _clean_html_text(raw):
    text = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", html_lib.unescape(text)).strip()

def _extract_snapshot_pairs(table_html):
    pairs = []
    current_pairs = re.findall(
        r'<td[^>]*class="[^"]*\bsnapshot-td2\b[^"]*"[^>]*>(.*?)</td>\s*'
        r'<td[^>]*class="[^"]*\bsnapshot-td2\b[^"]*"[^>]*>(.*?)</td>',
        table_html or "",
        re.S,
    )
    for label_raw, value_raw in current_pairs:
        label = _clean_html_text(label_raw)
        value = _clean_html_text(value_raw)
        if label:
            pairs.append((label, value))

    if pairs:
        return pairs

    legacy_pairs = re.findall(
        r'<td.*?class="snapshot-td2-cp".*?>(.*?)</td>.*?<td.*?class="snapshot-td2".*?>(.*?)</td>',
        table_html or "",
        re.S,
    )
    return [(_clean_html_text(label_raw), _clean_html_text(value_raw)) for label_raw, value_raw in legacy_pairs]

def _parse_finviz_data(html):
    data = {"summary": {}, "ratings": []}
    if not html: return data
    summary_match = re.search(r'<table[^>]*class="[^"]*\bsnapshot-table2\b[^"]*"[^>]*>(.*?)</table>', html, re.S)
    if summary_match:
        for l, v in _extract_snapshot_pairs(summary_match.group(1)):
            if l == "Earnings": data["summary"]["earnings"] = v
            elif l == "Target Price": data["summary"]["target_price"] = v
    ratings_match = re.search(r'<table class="fullview-ratings-outer".*?>(.*?)</table>', html, re.S)
    if ratings_match:
        rows = re.findall(r'<tr.*?>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?</tr>', ratings_match.group(1), re.S)
        for r in rows:
            data["ratings"].append({"analyst": re.sub(r'<.*?>', '', r[2]).strip(), "price_target": re.sub(r'<.*?>', '', r[4]).strip()})
    return data

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
        info = ticker.info or {}

        # 1. Fetch Finviz data for high-accuracy fields
        finviz_raw = _fetch_finviz_raw(symbol)
        finviz_data = _parse_finviz_data(finviz_raw)
        top_target, top_agency = _get_top_analyst_target(finviz_data.get("ratings", []))
        finviz_earnings = finviz_data.get("summary", {}).get("earnings")

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

        # Next upcoming earnings date
        next_earnings = _extract_next_earnings(calendar)
        if finviz_earnings and finviz_earnings != "-":
            next_earnings = finviz_earnings

        # Analyst recommendations summary
        recommend = info.get("recommendationKey", "")
        consensus_target = info.get("targetMeanPrice")
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
            "targetPrice": top_target or consensus_target,
            "topAnalystTarget": top_target,
            "topAnalystAgency": top_agency,
            "consensusTarget": consensus_target,
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
