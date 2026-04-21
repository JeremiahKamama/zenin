#!/usr/bin/env python3
import json
import re
import sys
from datetime import date, datetime

import requests


MONTHS = {
    "jan": 1,
    "feb": 2,
    "mar": 3,
    "apr": 4,
    "may": 5,
    "jun": 6,
    "jul": 7,
    "aug": 8,
    "sep": 9,
    "oct": 10,
    "nov": 11,
    "dec": 12,
}


def fetch_finviz_html(symbol: str):
    url = f"https://finviz.com/quote.ashx?t={symbol.upper()}"
    headers = {"User-Agent": "Mozilla/5.0"}
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return None
        return response.text
    except Exception:
        return None


def extract_earnings_text(html: str):
    if not html:
        return None

    table_match = re.search(r'<table class="snapshot-table2".*?>(.*?)</table>', html, re.S)
    if not table_match:
        return None

    pairs = re.findall(
        r'<td.*?class="snapshot-td2-cp".*?>(.*?)</td>.*?<td.*?class="snapshot-td2".*?>(.*?)</td>',
        table_match.group(1),
        re.S,
    )
    for label_raw, value_raw in pairs:
        label = re.sub(r"<.*?>", "", label_raw).strip().lower()
        if label != "earnings":
            continue
        value = re.sub(r"<.*?>", "", value_raw).strip()
        return value if value and value != "-" else None
    return None


def parse_earnings_date_to_iso(earnings_text: str):
    if not earnings_text:
        return None

    lower = earnings_text.strip().lower()
    if lower in {"-", "n/a", "na", "none"}:
        return None

    # Typical Finviz format: "Apr 24 AMC" / "May 2 BMO"
    match = re.search(r"\b([a-z]{3})\s+(\d{1,2})\b", lower)
    if not match:
        return None

    month = MONTHS.get(match.group(1))
    day = int(match.group(2))
    if not month:
        return None

    today = date.today()
    candidates = []
    for year in (today.year, today.year + 1):
        try:
            candidates.append(date(year, month, day))
        except ValueError:
            continue

    if not candidates:
        return None

    future = [d for d in candidates if d >= today]
    chosen = min(future) if future else max(candidates)
    return chosen.isoformat()


def fetch_symbol_earnings(symbol: str):
    safe = str(symbol or "").strip().upper()
    if not safe:
        return None

    html = fetch_finviz_html(safe)
    earnings_text = extract_earnings_text(html)
    next_earnings = parse_earnings_date_to_iso(earnings_text)

    return {
        "symbol": safe,
        "nextEarnings": next_earnings,
        "earningsText": earnings_text,
        "source": "Finviz",
    }


def main():
    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}
        symbols = payload.get("symbols")
        if not isinstance(symbols, list):
            print(json.dumps({"items": []}))
            return

        items = []
        for symbol in symbols:
            item = fetch_symbol_earnings(symbol)
            if item:
                items.append(item)

        print(json.dumps({"items": items}))
    except Exception as error:
        print(json.dumps({"items": [], "error": str(error)}))


if __name__ == "__main__":
    main()
