#!/usr/bin/env python3
import sys
import json
import yfinance as yf


def _build_attempts(period="1mo", interval="1d"):
    attempts = [(period, interval)]

    if interval in {"5m", "15m"}:
        attempts.extend([
            ("5d", "30m"),
            ("1mo", "60m"),
            ("3mo", "1d"),
        ])
    elif interval in {"30m", "60m", "1h"}:
        attempts.extend([
            ("1mo", "60m"),
            ("3mo", "1d"),
        ])
    elif interval == "1d":
        attempts.extend([
            ("6mo", "1d"),
            ("1y", "1d"),
        ])

    deduped = []
    seen = set()
    for attempt_period, attempt_interval in attempts:
        key = (attempt_period, attempt_interval)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(key)
    return deduped


def _format_history_rows(hist):
    rows = []
    for index, row in hist.iterrows():
        try:
            open_price = round(float(row["Open"]), 4)
            high_price = round(float(row["High"]), 4)
            low_price = round(float(row["Low"]), 4)
            close_price = round(float(row["Close"]), 4)
            volume = round(float(row.get("Volume", 0.0)), 2)
        except Exception:
            continue

        rows.append({
            "time": index.strftime("%Y-%m-%d %H:%M"),
            "open": open_price,
            "high": high_price,
            "low": low_price,
            "close": close_price,
            "volume": volume,
            "price": close_price
        })
    return rows


def fetch_history(symbol, period="1mo", interval="1d"):
    ticker = yf.Ticker(symbol)
    attempts = _build_attempts(period, interval)
    errors = []

    for attempt_period, attempt_interval in attempts:
        try:
            hist = ticker.history(
                period=attempt_period,
                interval=attempt_interval,
                auto_adjust=False,
                prepost=False
            )
        except Exception as exc:
            errors.append(f"{attempt_period}:{attempt_interval}:{exc}")
            continue

        if hist is None or hist.empty:
            errors.append(f"{attempt_period}:{attempt_interval}:empty")
            continue

        rows = _format_history_rows(hist)
        if rows:
            return {
                "history": rows,
                "source": "yahoo",
                "error": None,
                "meta": {
                    "requested": {"period": period, "interval": interval},
                    "used": {"period": attempt_period, "interval": attempt_interval},
                    "attempts": [{"period": p, "interval": i} for p, i in attempts]
                }
            }

        errors.append(f"{attempt_period}:{attempt_interval}:unusable_rows")

    return {
        "history": [],
        "source": "yahoo",
        "error": "yahoo_history_unavailable",
        "meta": {
            "requested": {"period": period, "interval": interval},
            "used": None,
            "attempts": [{"period": p, "interval": i} for p, i in attempts],
            "lastError": errors[-1] if errors else None
        }
    }


if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        input_data = json.loads(raw or "{}")

        symbol = str(input_data.get("symbol") or "").strip()
        period = input_data.get("period", "1mo")
        interval = input_data.get("interval", "1d")

        if not symbol:
            print(json.dumps({
                "history": [],
                "source": "yahoo",
                "error": "invalid_symbol",
                "meta": {
                    "requested": {"period": period, "interval": interval},
                    "used": None,
                    "attempts": []
                }
            }))
            sys.exit(0)

        history = fetch_history(symbol, period, interval)
        print(json.dumps(history))
    except Exception as exc:
        print(json.dumps({
            "history": [],
            "source": "yahoo",
            "error": str(exc),
            "meta": {
                "requested": None,
                "used": None,
                "attempts": []
            }
        }))
