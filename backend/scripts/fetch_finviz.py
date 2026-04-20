#!/usr/bin/env python3
import sys
import json
import requests
from bs4 import BeautifulSoup

def fetch_finviz_data(symbol: str) -> dict:
    # Normalize symbol for Finviz (e.g. BRK.B -> BRK-B)
    normalized_symbol = symbol.replace('.', '-').upper()
    url = f"https://finviz.com/quote.ashx?t={normalized_symbol}"
    
    # Standard headers to avoid being blocked
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finviz.com/",
        "Connection": "keep-alive"
    }
    
    data = {
        "ticker": normalized_symbol,
        "summary": {},
        "ratings": [],
        "insider": [],
        "news": [],
        "header_meta": {} # Sector, Industry, Country
    }

    try:
        response = requests.get(url, headers=headers, timeout=15)
        if response.status_code != 200:
            return {"error": f"Failed to fetch data, status code: {response.status_code}"}
        
        soup = BeautifulSoup(response.text, 'html.parser')

        # 1. Header Metadata (Sector, Industry, Country)
        sector_link = soup.find("a", class_="tab-link", href=lambda x: x and "f=sec_" in x)
        industry_link = soup.find("a", class_="tab-link", href=lambda x: x and "f=ind_" in x)
        country_link = soup.find("a", class_="tab-link", href=lambda x: x and "f=geo_" in x)
        
        if sector_link: data["header_meta"]["sector"] = sector_link.get_text(strip=True)
        if industry_link: data["header_meta"]["industry"] = industry_link.get_text(strip=True)
        if country_link: data["header_meta"]["country"] = country_link.get_text(strip=True)

        # 2. Analyst Ratings
        ratings_table = soup.find("table", class_="fullview-ratings-outer")
        if ratings_table:
            for row in ratings_table.find_all("tr"):
                cols = row.find_all("td")
                if len(cols) >= 5:
                    data["ratings"].append({
                        "date": cols[0].get_text(strip=True),
                        "action": cols[1].get_text(strip=True),
                        "analyst": cols[2].get_text(strip=True),
                        "rating": cols[3].get_text(strip=True),
                        "price_target": cols[4].get_text(strip=True),
                    })

        # 3. Insider Trading
        insider_tables = soup.find_all("table", class_="body-table")
        for table in insider_tables:
            # We look for the table containing "SEC Form 4"
            if "SEC Form 4" in table.get_text():
                for row in table.find_all("tr"):
                    cols = row.find_all("td")
                    if len(cols) >= 9:
                        if "Relationship" in cols[1].get_text(): continue
                        data["insider"].append({
                            "owner": cols[0].get_text(strip=True),
                            "relationship": cols[1].get_text(strip=True),
                            "date": cols[2].get_text(strip=True),
                            "transaction": cols[3].get_text(strip=True),
                            "cost": cols[4].get_text(strip=True),
                            "shares": cols[5].get_text(strip=True),
                            "value": cols[6].get_text(strip=True),
                            "total_shares": cols[7].get_text(strip=True),
                            "sec_form_4": cols[8].get_text(strip=True),
                        })
                break

        # 4. Snapshot Table (Summary Metrics)
        snapshot_table = soup.find("table", class_="snapshot-table2")
        if snapshot_table:
            labels = snapshot_table.find_all("td", class_="snapshot-td2-cp")
            values = snapshot_table.find_all("td", class_="snapshot-td2")
            for label_td, value_td in zip(labels, values):
                label = label_td.get_text(strip=True)
                value = value_td.get_text(strip=True)
                if label:
                    data["summary"][label] = value
                    
                    # Normalize some common keys for consistent frontend display
                    key_lower = label.lower()
                    if key_lower == "earnings": data["summary"]["earnings"] = value
                    elif key_lower == "target price": data["summary"]["target_price"] = value
                    elif key_lower == "market cap": data["summary"]["market_cap"] = value
                    elif key_lower == "p/e": data["summary"]["pe"] = value

        # 5. News
        news_table = soup.find("table", class_="fullview-news-outer")
        if news_table:
            for row in news_table.find_all("tr"):
                cols = row.find_all("td")
                if len(cols) >= 2:
                    timestamp = cols[0].get_text(strip=True)
                    link_tag = cols[1].find("a")
                    source_tag = cols[1].find("span")
                    
                    if link_tag:
                        data["news"].append({
                            "timestamp": timestamp,
                            "headline": link_tag.get_text(strip=True),
                            "source": source_tag.get_text(strip=True).strip("() ") if source_tag else "Unknown",
                            "link": link_tag.get("href", "")
                        })

        return data

    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No symbol provided"}))
        sys.exit(1)
    
    ticker = sys.argv[1]
    result = fetch_finviz_data(ticker)
    print(json.dumps(result))
