#!/usr/bin/env python3
import sys
import json
import yfinance as yf

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

        # Next earnings date
        next_earnings = None
        try:
            if calendar is not None:
                if isinstance(calendar, dict):
                    dates = calendar.get("Earnings Date", [])
                    if isinstance(dates, list) and dates:
                        next_earnings = str(dates[0])
                    elif dates:
                        next_earnings = str(dates)
        except Exception:
            pass

        # Analyst recommendations summary
        recommend = info.get("recommendationKey", "")
        target_price = info.get("targetMeanPrice")
        analyst_count = info.get("numberOfAnalystOpinions")

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
        }

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        data = json.loads(raw)
        symbol = data.get("symbol", "")
        if not symbol:
            print(json.dumps({"error": "No symbol provided"}))
            sys.exit(0)
        result = fetch_earnings(symbol)
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))