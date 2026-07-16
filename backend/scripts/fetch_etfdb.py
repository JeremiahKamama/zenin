#!/usr/bin/env python3
"""Fetch and normalize one public ETFdb ETF page for the Node ETF worker.

This worker only reads /etf/<ticker>/ pages. It emits a deliberately sparse
JSON snapshot: a missing field stays missing rather than being inferred.
"""

import json
import os
import re
import sys
from datetime import datetime, timezone

import requests
from bs4 import BeautifulSoup


def clean(value):
    return " ".join(str(value or "").split()).strip()


def percent(value):
    match = re.search(r"(-?[0-9]+(?:\.[0-9]+)?)\s*%", clean(value))
    return float(match.group(1)) if match else None


def labelled_values(soup):
    values = {}
    for row in soup.select("tr"):
        cells = [clean(cell.get_text(" ", strip=True)) for cell in row.select("th, td")]
        if len(cells) < 2:
            continue
        label = cells[0].lower().rstrip(":")
        value = cells[1]
        if label and value and label not in values:
            values[label] = value
    return values


def first_label(values, *labels):
    for label in labels:
        wanted = label.lower()
        for key, value in values.items():
            if wanted == key or wanted in key:
                return value
    return None


def allocation_table(soup, needles):
    for table in soup.select("table"):
        headers = [clean(header.get_text(" ", strip=True)).lower() for header in table.select("thead th")]
        header_text = " ".join(headers)
        if not headers or not any(needle in header_text for needle in needles):
            continue
        weight_index = next((i for i, header in enumerate(headers) if "%" in header or "weight" in header or "assets" in header), None)
        if weight_index is None:
            continue
        rows = []
        for row in table.select("tbody tr"):
            cells = [clean(cell.get_text(" ", strip=True)) for cell in row.select("th, td")]
            if len(cells) <= weight_index:
                continue
            weight = percent(cells[weight_index])
            if cells[0] and weight is not None:
                rows.append({"name": cells[0], "weight": weight})
        if rows:
            return rows[:50]
    return []


def scrape(symbol):
    url = f"https://etfdb.com/etf/{symbol}/"
    user_agent = os.getenv("ETF_INTELLIGENCE_USER_AGENT", "ZeninETFResearch/1.0 (+https://zenin.capital/contact)")
    response = requests.get(url, headers={"User-Agent": user_agent, "Accept": "text/html,application/xhtml+xml"}, timeout=12)
    if response.status_code != 200:
        return {"available": False, "reason": f"HTTP {response.status_code}"}

    soup = BeautifulSoup(response.text, "html.parser")
    labels = labelled_values(soup)
    description = soup.find("meta", attrs={"name": "description"})
    expense_ratio = percent(first_label(labels, "expense ratio", "annual fee"))
    category = first_label(labels, "etf database category", "category")
    issuer = first_label(labels, "issuer", "brand")
    benchmark = first_label(labels, "index", "benchmark")
    strategy = first_label(labels, "strategy", "methodology")

    profile = {
        "objective": clean(description.get("content")) if description else None,
        "strategy": strategy,
        "benchmark": benchmark,
        "index": benchmark,
        "issuer": issuer,
        "category": category,
        "expenseRatioPct": expense_ratio,
    }
    profile = {key: value for key, value in profile.items() if value not in (None, "")}

    composition = {
        "topHoldings": allocation_table(soup, ["holding"]),
        "sector": allocation_table(soup, ["sector"]),
        "country": allocation_table(soup, ["country"]),
        "asset": allocation_table(soup, ["asset class"]),
    }
    composition = {key: value for key, value in composition.items() if value}
    classification = {key: value for key, value in {
        "assetClass": first_label(labels, "asset class"),
        "category": category,
        "focus": first_label(labels, "focus"),
        "style": first_label(labels, "style"),
        "region": first_label(labels, "region"),
        "strategy": strategy,
    }.items() if value}
    strategy_data = {key: value for key, value in {
        "objective": profile.get("objective"),
        "benchmark": benchmark,
        "underlyingIndex": benchmark,
        "selectionMethodology": strategy,
        "issuer": issuer,
    }.items() if value}

    has_data = bool(profile or composition or classification or strategy_data)
    return {
        "available": has_data,
        "source": "ETFdb",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
        "profile": profile or None,
        "composition": composition or None,
        "classification": classification or None,
        "strategy": strategy_data or None,
        "peers": [],
        "themes": [],
    }


if __name__ == "__main__":
    symbol = clean(sys.argv[1] if len(sys.argv) > 1 else "").upper()
    if not re.fullmatch(r"[A-Z0-9.-]{1,15}", symbol):
        print(json.dumps({"available": False, "reason": "invalid symbol"}))
        sys.exit(0)
    try:
        print(json.dumps(scrape(symbol)))
    except requests.RequestException as error:
        print(json.dumps({"available": False, "reason": str(error)}))
    except Exception:
        print(json.dumps({"available": False, "reason": "worker parse failure"}))
