import json
import math
import random
import re
from typing import Dict, List, Optional

import pandas as pd
import requests
import yfinance as yf
from bs4 import BeautifulSoup


BENCHMARKS = [
    {"key": "sp500", "ticker": "SPY", "name": "S&P 500", "region": "USA", "currency": "USD"},
    {"key": "msciWorld", "ticker": "ACWI", "name": "MSCI World", "region": "Global", "currency": "USD"},
    {"key": "msciEm", "ticker": "EEM", "name": "MSCI EM", "region": "Emerging Markets", "currency": "USD"},
    {"key": "reits", "ticker": "VNQ", "name": "Global REITs", "region": "Global", "currency": "USD"},
    {"key": "us10y", "ticker": "IEF", "name": "US 7-10Y Treasury", "region": "USA", "currency": "USD"},
]

DISPLAY_KEYS = ["sp500", "msciWorld", "msciEm", "reits"]
CORRELATION_KEYS = ["sp500", "msciWorld", "msciEm", "reits", "us10y"]
SCREENER_URL = "https://finviz.com/screener.ashx?v=111&s=ta_topgainers"


def empty_price_series():
    return pd.Series([], index=pd.DatetimeIndex([]), dtype="float64")


def safe_float(value):
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric) or math.isinf(numeric):
        return None
    return numeric


def round_or_none(value, digits=2):
    numeric = safe_float(value)
    if numeric is None:
        return None
    return round(numeric, digits)


def json_ready(value):
    if isinstance(value, dict):
        return {str(k): json_ready(v) for k, v in value.items()}
    if isinstance(value, list):
        return [json_ready(v) for v in value]
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if hasattr(value, "item"):
        try:
            value = value.item()
        except Exception:
            pass
    if isinstance(value, float):
        if math.isnan(value) or math.isinf(value):
            return None
    return value


def get_download_series(frame: pd.DataFrame, ticker: str) -> pd.Series:
    if frame is None or frame.empty:
        return empty_price_series()

    if isinstance(frame.columns, pd.MultiIndex):
        level0 = list(frame.columns.get_level_values(0))
        if "Adj Close" in level0:
            series = frame["Adj Close"].get(ticker, empty_price_series())
        elif "Close" in level0:
            series = frame["Close"].get(ticker, empty_price_series())
        else:
            series = empty_price_series()
    else:
        column = "Adj Close" if "Adj Close" in frame.columns else "Close" if "Close" in frame.columns else None
        series = frame[column] if column else empty_price_series()

    if not isinstance(series, pd.Series):
        series = pd.Series(series)
    series = series.dropna().astype("float64")
    if getattr(series.index, "tz", None) is not None:
        series.index = series.index.tz_localize(None)
    if not isinstance(series.index, pd.DatetimeIndex):
        try:
            series.index = pd.to_datetime(series.index)
        except Exception:
            return empty_price_series()
    return series


def nearest_start_value(series: pd.Series, target_date: pd.Timestamp) -> Optional[float]:
    if series.empty:
        return None
    eligible = series[series.index <= target_date]
    if eligible.empty:
        return None
    return safe_float(eligible.iloc[-1])


def period_return(series: pd.Series, *, days=None, weeks=None, months=None, years=None, ytd=False):
    if series is None or len(series) < 2:
        return None
    end_value = safe_float(series.iloc[-1])
    end_date = pd.Timestamp(series.index[-1]).tz_localize(None) if getattr(series.index[-1], "tzinfo", None) else pd.Timestamp(series.index[-1])
    if end_value is None:
        return None

    if ytd:
        start_candidates = series[series.index >= pd.Timestamp(year=end_date.year, month=1, day=1)]
        if start_candidates.empty:
            return None
        start_value = safe_float(start_candidates.iloc[0])
    else:
        offset_kwargs = {}
        if years:
            offset_kwargs["years"] = years
        if months:
            offset_kwargs["months"] = months
        if weeks:
            offset_kwargs["weeks"] = weeks
        if days:
            offset_kwargs["days"] = days
        target_date = end_date - pd.DateOffset(**offset_kwargs)
        start_value = nearest_start_value(series, target_date)

    if start_value in (None, 0):
        return None
    return ((end_value / start_value) - 1.0) * 100.0


def cagr(series: pd.Series, years: int):
    if series is None or len(series) < 2:
        return None
    end_value = safe_float(series.iloc[-1])
    end_date = pd.Timestamp(series.index[-1]).tz_localize(None) if getattr(series.index[-1], "tzinfo", None) else pd.Timestamp(series.index[-1])
    start_date = end_date - pd.DateOffset(years=years)
    eligible = series[series.index <= start_date]
    if eligible.empty:
        return None
    start_value = safe_float(eligible.iloc[-1])
    actual_years = max((end_date - eligible.index[-1]).days / 365.25, 0)
    if start_value in (None, 0) or end_value is None or actual_years <= 0:
        return None
    return ((end_value / start_value) ** (1.0 / actual_years) - 1.0) * 100.0


def annualized_volatility(daily_returns: pd.Series):
    clean = daily_returns.dropna()
    if len(clean) < 2:
        return None
    return clean.std(ddof=1) * math.sqrt(252.0) * 100.0


def max_drawdown(price_series: pd.Series):
    clean = price_series.dropna()
    if clean.empty:
        return None
    running_max = clean.cummax()
    drawdowns = (clean / running_max) - 1.0
    return drawdowns.min() * 100.0


def sharpe_ratio(daily_returns: pd.Series, risk_free_annual: float = 0.0):
    clean = daily_returns.dropna()
    if len(clean) < 2:
        return None
    excess = clean - (risk_free_annual / 252.0)
    denom = clean.std(ddof=1) * math.sqrt(252.0)
    if denom == 0 or math.isnan(denom):
        return None
    return (excess.mean() * 252.0) / denom


def sortino_ratio(daily_returns: pd.Series, risk_free_annual: float = 0.0):
    clean = daily_returns.dropna()
    if len(clean) < 2:
        return None
    excess = clean - (risk_free_annual / 252.0)
    downside = excess[excess < 0]
    if len(downside) < 2:
        return None
    downside_std = downside.std(ddof=1) * math.sqrt(252.0)
    if downside_std == 0 or math.isnan(downside_std):
        return None
    return (excess.mean() * 252.0) / downside_std


def yearly_total_returns(series: pd.Series) -> Dict[int, float]:
    if series is None or series.empty or not isinstance(series.index, pd.DatetimeIndex):
        return {}
    year_end = series.resample("Y").last().dropna()
    returns = year_end.pct_change().dropna() * 100.0
    current_year = pd.Timestamp.utcnow().year
    return {
        int(idx.year): round(float(value), 2)
        for idx, value in returns.items()
        if int(idx.year) < current_year
    }


def parse_market_cap_string(raw_value: str):
    if not raw_value:
        return None
    value = str(raw_value).strip().upper().replace(",", "")
    match = re.match(r"^([0-9]*\.?[0-9]+)([KMBT])?$", value)
    if not match:
        return None
    amount = safe_float(match.group(1))
    if amount is None:
        return None
    multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000, "T": 1_000_000_000_000}.get(match.group(2), 1)
    return amount * multiplier


def parse_percent_string(raw_value: str):
    if raw_value is None:
        return None
    text = str(raw_value).strip().replace("%", "").replace(",", "")
    return safe_float(text)


def fetch_screener_rows():
    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ]
    headers = {"User-Agent": random.choice(user_agents)}
    response = requests.get(SCREENER_URL, headers=headers, timeout=12)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    table = soup.find("table", class_="screener_table")
    if not table:
        return []

    rows = []
    for tr in table.find_all("tr")[1:]:
        cols = tr.find_all("td")
        if len(cols) < 11:
            continue
        rows.append(
            {
                "symbol": cols[1].get_text(strip=True).upper(),
                "name": cols[2].get_text(strip=True),
                "sector": cols[3].get_text(strip=True),
                "industry": cols[4].get_text(strip=True),
                "country": cols[5].get_text(strip=True),
                "marketCap": parse_market_cap_string(cols[6].get_text(strip=True)),
                "pe": safe_float(cols[7].get_text(strip=True).replace("-", "")) if cols[7].get_text(strip=True) != "-" else None,
                "price": safe_float(cols[8].get_text(strip=True)),
                "changePct": parse_percent_string(cols[9].get_text(strip=True)),
                "volume": safe_float(cols[10].get_text(strip=True).replace(",", "")),
            }
        )
    return rows[:10]


def enrich_screener_rows(rows: List[dict]):
    enriched = []
    for row in rows:
        info = {}
        try:
            info = yf.Ticker(row["symbol"]).info or {}
        except Exception:
            info = {}
        enriched.append(
            {
                "symbol": row.get("symbol"),
                "name": info.get("shortName") or row.get("name"),
                "sector": info.get("sector") or row.get("sector"),
                "industry": info.get("industry") or row.get("industry"),
                "country": info.get("country") or row.get("country"),
                "marketCap": safe_float(info.get("marketCap")) or row.get("marketCap"),
                "pe": safe_float(info.get("trailingPE")) or row.get("pe"),
                "pb": safe_float(info.get("priceToBook")),
                "price": safe_float(info.get("currentPrice")) or row.get("price"),
                "changePct": row.get("changePct"),
                "volume": safe_float(info.get("volume")) or row.get("volume"),
            }
        )
    return enriched


def main():
    benchmark_map = {item["key"]: item for item in BENCHMARKS}
    tickers = [item["ticker"] for item in BENCHMARKS]
    downloaded = yf.download(
        tickers=tickers,
        period="max",
        interval="1d",
        auto_adjust=False,
        progress=False,
        threads=True,
    )

    price_series = {item["key"]: get_download_series(downloaded, item["ticker"]) for item in BENCHMARKS}
    info_map = {}
    for item in BENCHMARKS:
        try:
            info_map[item["key"]] = yf.Ticker(item["ticker"]).info or {}
        except Exception:
            info_map[item["key"]] = {}

    risk_free_annual = safe_float((info_map.get("us10y", {}) or {}).get("yield"))
    if risk_free_annual is None:
        risk_free_annual = safe_float((info_map.get("us10y", {}) or {}).get("dividendYield"))
    risk_free_annual = risk_free_annual or 0.0
    if risk_free_annual > 1:
        risk_free_annual /= 100.0

    benchmark_index_history = []
    benchmark_performance = []
    annual_returns_by_key = {}

    for key in DISPLAY_KEYS:
        meta = benchmark_map[key]
        series = price_series.get(key, empty_price_series())
        daily_returns = series.pct_change().dropna()
        benchmark_index_history.append(
            {
                "id": key,
                "name": meta["name"],
                "symbol": meta["ticker"],
                "region": meta["region"],
                "currency": meta["currency"],
                "daily": round_or_none(period_return(series, days=1)),
                "weekly": round_or_none(period_return(series, weeks=1)),
                "monthly": round_or_none(period_return(series, months=1)),
                "annual": round_or_none(period_return(series, years=1)),
                "ytd": round_or_none(period_return(series, ytd=True)),
                "yr1": round_or_none(period_return(series, years=1)),
                "yr3": round_or_none(cagr(series, 3)),
                "yr5": round_or_none(cagr(series, 5)),
                "yr10": round_or_none(cagr(series, 10)),
                "yr20": round_or_none(cagr(series, 20)),
                "sparkline": [round(float(v), 4) for v in series.tail(30).tolist()],
            }
        )
        benchmark_performance.append(
            {
                "name": meta["name"],
                "yr1": round_or_none(period_return(series, years=1)),
                "yr3": round_or_none(cagr(series, 3)),
                "yr5": round_or_none(cagr(series, 5)),
                "yr10": round_or_none(cagr(series, 10)),
                "yr20": round_or_none(cagr(series, 20)),
            }
        )
        annual_returns_by_key[key] = yearly_total_returns(series)

    annual_years = sorted(
        set().union(*[set(values.keys()) for values in annual_returns_by_key.values() if values]),
        reverse=True,
    )[:20]
    annual_returns_rows = [
        {
            "year": year,
            "sp500": annual_returns_by_key.get("sp500", {}).get(year),
            "msciWorld": annual_returns_by_key.get("msciWorld", {}).get(year),
            "msciEm": annual_returns_by_key.get("msciEm", {}).get(year),
            "reits": annual_returns_by_key.get("reits", {}).get(year),
        }
        for year in annual_years
    ]

    correlation_labels = [benchmark_map[key]["ticker"] for key in CORRELATION_KEYS]
    correlation_frame = pd.concat(
        [price_series[key].pct_change().rename(benchmark_map[key]["ticker"]) for key in CORRELATION_KEYS],
        axis=1,
    ).dropna().tail(252)
    correlation_matrix = (
        correlation_frame.corr().round(2).values.tolist() if not correlation_frame.empty else []
    )

    volatility_metrics = []
    for key in CORRELATION_KEYS:
        meta = benchmark_map[key]
        series = price_series.get(key, empty_price_series()).tail(252)
        daily_returns = series.pct_change().dropna()
        volatility_metrics.append(
            {
                "asset": meta["name"],
                "annualizedVolatility": round_or_none(annualized_volatility(daily_returns)),
                "maxDrawdown": round_or_none(max_drawdown(series)),
                "sharpe": round_or_none(sharpe_ratio(daily_returns, risk_free_annual), 2),
                "sortino": round_or_none(sortino_ratio(daily_returns, risk_free_annual), 2),
            }
        )

    valuation_data = []
    for key in DISPLAY_KEYS:
        meta = benchmark_map[key]
        info = info_map.get(key, {}) or {}
        market_cap = safe_float(info.get("marketCap"))
        free_cashflow = safe_float(info.get("freeCashflow"))
        fcf_yield = (free_cashflow / market_cap * 100.0) if market_cap and free_cashflow else None
        dividend_yield = safe_float(info.get("yield"))
        if dividend_yield is None:
            dividend_yield = safe_float(info.get("dividendYield"))
        if dividend_yield is not None:
            dividend_yield *= 100.0
        valuation_data.append(
            {
                "scope": f"{meta['name']} ({meta['ticker']})",
                "pe": round_or_none(safe_float(info.get("trailingPE")), 1),
                "pb": round_or_none(safe_float(info.get("priceToBook")), 1),
                "evEbitda": round_or_none(safe_float(info.get("enterpriseToEbitda")), 1),
                "dividendYield": round_or_none(dividend_yield, 1),
                "fcfYield": round_or_none(fcf_yield, 1),
            }
        )

    screener_rows = []
    try:
        screener_rows = enrich_screener_rows(fetch_screener_rows())
    except Exception:
        screener_rows = []

    payload = {
        "updatedAt": pd.Timestamp.utcnow().isoformat(),
        "benchmarkIndexHistory": benchmark_index_history,
        "benchmarkPerformance": benchmark_performance,
        "correlationLabels": correlation_labels,
        "correlationMatrix": correlation_matrix,
        "volatilityMetrics": volatility_metrics,
        "valuationData": valuation_data,
        "annualReturns": annual_returns_rows,
        "stockScreener": screener_rows,
    }
    print(json.dumps(json_ready(payload)))


if __name__ == "__main__":
    main()
