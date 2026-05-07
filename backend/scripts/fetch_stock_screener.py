import requests
from bs4 import BeautifulSoup
import json
import sys
import random

def fetch_screener():
    url = "https://finviz.com/screener.ashx?v=111&s=ta_topgainers"
    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ]
    headers = {"User-Agent": random.choice(user_agents)}
    
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code != 200:
            return {"error": f"Status {response.status_code}"}
        
        soup = BeautifulSoup(response.text, 'html.parser')
        table = soup.find("table", class_="screener_table")
        if not table:
            return {"error": "Table not found"}
        
        rows = []
        for tr in table.find_all("tr")[1:]: # Skip header
            cols = tr.find_all("td")
            if len(cols) >= 10:
                rows.append({
                    "ticker": cols[1].get_text(strip=True),
                    "company": cols[2].get_text(strip=True),
                    "sector": cols[3].get_text(strip=True),
                    "industry": cols[4].get_text(strip=True),
                    "country": cols[5].get_text(strip=True),
                    "market_cap": cols[6].get_text(strip=True),
                    "pe": cols[7].get_text(strip=True),
                    "price": cols[8].get_text(strip=True),
                    "change": cols[9].get_text(strip=True),
                    "volume": cols[10].get_text(strip=True)
                })
        return rows
    except Exception as e:
        return {"error": str(e)}

if __name__ == "__main__":
    data = fetch_screener()
    print(json.dumps(data))
