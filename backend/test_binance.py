import subprocess
import requests

def test_binance():
    url = "https://api.binance.com/api/v3/exchangeInfo"
    response = requests.get(url, timeout=5, headers={'User-Agent': 'Mozilla/5.0'})
    print("Status code:", response.status_code)
    data = response.json()
    for s in data.get('symbols', []):
        if 'PEPE' in s.get('baseAsset', ''):
            print(s)
test_binance()
