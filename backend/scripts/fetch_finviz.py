#!/usr/bin/env python3
import sys
import json
import re
import requests

def fetch_finviz_data(symbol: str) -> dict:
    url = f"https://finviz.com/quote.ashx?t={symbol.upper()}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    }
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return {"error": f"Finviz returned status {response.status_code}"}
        html = response.text
    except Exception as e:
        return {"error": str(e)}

    data = {
        "ratings": [],
        "insider": [],
        "news": []
    }

    # 1. Analyst Ratings
    # Look for table.fullview-ratings-outer
    # Each item usually in <tr> with td fields
    ratings_match = re.search(r'<table class="fullview-ratings-outer".*?>(.*?)</table>', html, re.S)
    if ratings_match:
        rows = re.findall(r'<tr.*?>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?</tr>', ratings_match.group(1), re.S)
        for r in rows:
            data["ratings"].append({
                "date": re.sub(r'<.*?>', '', r[0]).strip(),
                "action": re.sub(r'<.*?>', '', r[1]).strip(),
                "analyst": re.sub(r'<.*?>', '', r[2]).strip(),
                "rating": re.sub(r'<.*?>', '', r[3]).strip(),
                "price_target": re.sub(r'<.*?>', '', r[4]).strip(),
            })

    # 2. Insider Trading
    # Look for the table with "Insider Trading" context. It has class "body-table"
    # Finviz has multiple "body-table" but the insider one is usually the last one
    # We look for the table containing "SEC Form 4"
    insider_tables = re.findall(r'<table.*?class="body-table".*?>(.*?)</table>', html, re.S)
    for it in insider_tables:
        if "SEC Form 4" in it:
            rows = re.findall(r'<tr.*?>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?<td.*?>(.*?)</td>.*?</tr>', it, re.S)
            for r in rows:
                if "Relationship" in r[1]: continue # skip header if found
                data["insider"].append({
                    "owner": re.sub(r'<.*?>', '', r[0]).strip(),
                    "relationship": re.sub(r'<.*?>', '', r[1]).strip(),
                    "date": re.sub(r'<.*?>', '', r[2]).strip(),
                    "transaction": re.sub(r'<.*?>', '', r[3]).strip(),
                    "cost": re.sub(r'<.*?>', '', r[4]).strip(),
                    "shares": re.sub(r'<.*?>', '', r[5]).strip(),
                    "value": re.sub(r'<.*?>', '', r[6]).strip(),
                    "total_shares": re.sub(r'<.*?>', '', r[7]).strip(),
                    "sec_form_4": re.sub(r'<.*?>', '', r[8]).strip(),
                })

    # 3. Main Summary Table (Market Cap, P/E, Earnings, Target Price)
    # The table has class "snapshot-table2"
    data["summary"] = {}
    summary_match = re.search(r'<table class="snapshot-table2".*?>(.*?)</table>', html, re.S)
    if summary_match:
        # Find all label-value pairs: <td class="snapshot-td2-cp">Label</td><td class="snapshot-td2">Value</td>
        pairs = re.findall(r'<td.*?class="snapshot-td2-cp".*?>(.*?)</td>.*?<td.*?class="snapshot-td2".*?>(.*?)</td>', summary_match.group(1), re.S)
        for label_raw, value_raw in pairs:
            label = re.sub(r'<.*?>', '', label_raw).strip()
            value = re.sub(r'<.*?>', '', value_raw).strip()
            
            if label:
                data["summary"][label] = value
                
            key_lower = label.lower()
            if key_lower == "earnings":
                data["summary"]["earnings"] = value
            elif key_lower == "target price":
                data["summary"]["target_price"] = value
            elif key_lower == "market cap":
                data["summary"]["market_cap"] = value
            elif key_lower == "p/e":
                data["summary"]["pe"] = value

    # 4. News
    # table.fullview-news-outer
    news_match = re.search(r'<table class="fullview-news-outer".*?>(.*?)</table>', html, re.S)
    if news_match:
        # Rows contain <td>date</td><td><a>headline</a><span>(source)</span></td>
        news_rows = re.findall(r'<tr.*?>.*?<td.*?>(.*?)</td>.*?<td.*?>.*?<a.*?>(.*?)</a>.*?<span.*?>(.*?)</span>.*?</td>.*?</tr>', news_match.group(1), re.S)
        for nr in news_rows:
            data["news"].append({
                "timestamp": re.sub(r'<.*?>', '', nr[0]).strip(),
                "headline": re.sub(r'<.*?>', '', nr[1]).strip(),
                "source": re.sub(r'<.*?>', '', nr[2]).strip(),
            })

    return data

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No symbol provided"}))
        sys.exit(1)
    
    ticker = sys.argv[1]
    result = fetch_finviz_data(ticker)
    print(json.dumps(result))
