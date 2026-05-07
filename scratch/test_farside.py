import requests
from bs4 import BeautifulSoup

def test_fetch():
    url = 'https://farside.co.uk/bitcoin-etf-flow/'
    headers = {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    response = requests.get(url, headers=headers)
    print(f"Status: {response.status_code}")
    print(response.text[:1000])

if __name__ == "__main__":
    test_fetch()
