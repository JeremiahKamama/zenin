#!/usr/bin/env python3
import json
import html as html_lib
import re
import sys
from datetime import date, datetime

import requests

from posthog_client import posthog_client


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


def clean_html_text(raw: str):
    text = re.sub(r"<[^>]+>", " ", raw or "")
    return re.sub(r"\s+", " ", html_lib.unescape(text)).strip()


def fetch_finviz_html(symbol: str):
    url = f"https://finviz.com/quote.ashx?t={symbol.upper()}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finviz.com/",
    }
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

    table_match = re.search(r'<table[^>]*class="[^"]*\bsnapshot-table2\b[^"]*"[^>]*>(.*?)</table>', html, re.S)
    if not table_match:
        return None

    table_html = table_match.group(1)
    label_value_pairs = re.findall(
        r'<td[^>]*class="[^"]*\bsnapshot-td2\b[^"]*"[^>]*>(.*?)</td>\s*'
        r'<td[^>]*class="[^"]*\bsnapshot-td2\b[^"]*"[^>]*>(.*?)</td>',
        table_html,
        re.S,
    )
    for label_raw, value_raw in label_value_pairs:
        label = clean_html_text(label_raw).lower()
        if label != "earnings":
            continue
        value = clean_html_text(value_raw)
        return value if value and value != "-" else None

    # Legacy Finviz markup used snapshot-td2-cp for label cells.
    pairs = re.findall(
        r'<td.*?class="snapshot-td2-cp".*?>(.*?)</td>.*?<td.*?class="snapshot-td2".*?>(.*?)</td>',
        table_html,
        re.S,
    )
    for label_raw, value_raw in pairs:
        label = clean_html_text(label_raw).lower()
        if label != "earnings":
            continue
        value = clean_html_text(value_raw)
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

        if posthog_client:
            posthog_client.capture(
                event="earnings_calendar_loaded",
                properties={
                    "requested_symbol_count": len(symbols),
                    "resolved_earnings_count": sum(1 for item in items if item["nextEarnings"]),
                },
            )
        print(json.dumps({"items": items}))
    except Exception as error:
        print(json.dumps({"items": [], "error": str(error)}))


if __name__ == "__main__":
    main()
