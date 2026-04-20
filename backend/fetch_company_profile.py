#!/usr/bin/env python3
import json
import math
import os
import re
import sys
from datetime import date, datetime, timedelta

import requests
import yfinance as yf

REQUEST_TIMEOUT_SECONDS = 12
SEC_RECENT_FORMS_LIMIT = 12
REGULATOR_BULLET_LIMIT = 4
DEFAULT_SEC_USER_AGENT = "Zenin Company Profile support@localhost"
HTTP_HEADERS = {
    "User-Agent": os.environ.get("SEC_USER_AGENT") or os.environ.get("COMPANY_PROFILE_USER_AGENT") or DEFAULT_SEC_USER_AGENT,
    "Accept": "application/json, text/plain;q=0.9, */*;q=0.8",
}


def _normalize_date_str(value):
    if value is None:
        return None

    if isinstance(value, (list, tuple)):
        for item in value:
            parsed = _normalize_date_str(item)
            if parsed:
                return parsed
        return None

    try:
        if hasattr(value, "to_pydatetime"):
            value = value.to_pydatetime()
    except Exception:
        pass

    if isinstance(value, datetime):
        return value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()

    text = str(value).strip()
    if not text or text.lower() in {"nan", "none"}:
        return None

    if len(text) >= 10:
        candidate = text[:10].replace("/", "-")
        try:
            datetime.fromisoformat(candidate)
            return candidate
        except Exception:
            pass

    return None


def _extract_next_earnings(calendar):
    candidates = []
    try:
        if isinstance(calendar, dict):
            earnings_date = calendar.get("Earnings Date")
            if isinstance(earnings_date, dict):
                candidates.extend(list(earnings_date.values()))
            else:
                candidates.append(earnings_date)
        elif hasattr(calendar, "to_dict"):
            cal_dict = calendar.to_dict()
            if isinstance(cal_dict, dict):
                earnings_date = cal_dict.get("Earnings Date")
                if isinstance(earnings_date, dict):
                    candidates.extend(list(earnings_date.values()))
                else:
                    candidates.append(earnings_date)
    except Exception:
        pass

    today = date.today()
    parsed_dates = []
    for raw in candidates:
        normalized = _normalize_date_str(raw)
        if not normalized:
            continue
        try:
            parsed = datetime.fromisoformat(normalized).date()
            if parsed >= today:
                parsed_dates.append(parsed)
        except Exception:
            continue

    if not parsed_dates:
        return None
    return min(parsed_dates).isoformat()


def _safe_number(value):
    try:
        if value is None:
            return None
        numeric = float(value)
        if math.isnan(numeric) or math.isinf(numeric):
            return None
        if numeric.is_integer():
            return int(numeric)
        return numeric
    except Exception:
        return None


def _clean_text(value):
    text = str(value or "").strip()
    return text or None


def _get_top_analyst_target(ratings):
    """
    Identifies the price target from the 'highest rated' reputable analyst agency.
    """
    TOP_TIER_AGENCIES = {
        "goldman sachs", "ms", "morgan stanley", "jp morgan", "jpmorgan", "bofA", "bank of america", "citi", "barclays",
        "wells fargo", "rbc", "bmo", "piper sandler", "wedbush", "oppenheimer", "bernstein", "evercore", "mizuho",
        "stifel", "raymond james", "jefferies", "keybanc", "canaccord", "cowen", "wolfe research", "hsbc", "ubs",
        "deutsche bank", "normura", "socgen", "bnp paribas"
    }
    
    if not ratings or not isinstance(ratings, list):
        return None, None

    # Filter for reputable ones
    reputable = []
    for r in ratings:
        analyst = str(r.get("analyst") or "").lower()
        if any(tier in analyst for tier in TOP_TIER_AGENCIES):
            reputable.append(r)
    
    if not reputable:
        return None, None
        
    # Pick the most recent one. Ratings are usually sorted by date descending in Finviz
    # If same date, pick the one with highest target
    top = reputable[0]
    top_target = _safe_number(top.get("price_target").replace("$", "").split("→")[-1].strip())
    top_agency = top.get("analyst")
    
    return top_target, top_agency


def _fetch_finviz_raw(symbol):
    ticker = symbol.upper().replace('.', '-')
    url = f"https://finviz.com/quote.ashx?t={ticker}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 200:
            return resp.text
    except:
        pass
    return None


def _parse_finviz_data(html):
    data = {"summary": {}, "ratings": []}
    if not html: return data
    
    # 1. Summary table (Earnings, Target Price)
    summary_match = re.search(r'<table class="snapshot-table2".*?>(.*?)</table>', html, re.S)
    if summary_match:
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

    # 2. Ratings
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
    return data


def _normalize_json(value):
    if value is None:
        return None

    if isinstance(value, dict):
        return {str(key): _normalize_json(val) for key, val in value.items()}

    if isinstance(value, (list, tuple, set)):
        return [_normalize_json(item) for item in value]

    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, (str, bool, int)):
        return value

    if isinstance(value, float):
        return _safe_number(value)

    normalized_num = _safe_number(value)
    if normalized_num is not None:
        return normalized_num

    if hasattr(value, "item"):
        try:
            return _normalize_json(value.item())
        except Exception:
            pass

    return _clean_text(value)


def _extract_recent_earnings(ticker):
    rows = []
    try:
        earnings_dates = ticker.earnings_dates
        if earnings_dates is None or getattr(earnings_dates, "empty", False):
            return rows

        frame = earnings_dates.copy()
        try:
            frame = frame.sort_index(ascending=False)
        except Exception:
            pass

        for idx, row in frame.head(8).iterrows():
            rows.append({
                "date": _normalize_date_str(idx),
                "epsEstimate": _safe_number(row.get("EPS Estimate")),
                "reportedEps": _safe_number(row.get("Reported EPS")),
                "surprisePct": _safe_number(row.get("Surprise(%)")),
            })
    except Exception:
        return []
    return rows


def _extract_leadership(info):
    officers = info.get("companyOfficers") or []
    leadership = []
    for officer in officers[:10]:
        if not isinstance(officer, dict):
            continue
        leadership.append({
            "name": _clean_text(officer.get("name")),
            "title": _clean_text(officer.get("title")),
            "age": _safe_number(officer.get("age")),
            "yearBorn": _safe_number(officer.get("yearBorn")),
            "totalPay": _safe_number(officer.get("totalPay")),
        })
    return leadership


def _http_get_json(url, params=None, headers=None):
    merged_headers = {**HTTP_HEADERS, **(headers or {})}
    response = requests.get(url, params=params, headers=merged_headers, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def _http_post_json(url, payload=None, headers=None):
    merged_headers = {**HTTP_HEADERS, **(headers or {})}
    response = requests.post(url, json=payload or {}, headers=merged_headers, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return response.json()


def _compact_unique_strings(values, fallback=None, limit=None):
    seen = set()
    result = []
    for raw in values or []:
        text = _clean_text(raw)
        if not text:
            continue
        if text in seen:
            continue
        seen.add(text)
        result.append(text)
        if limit and len(result) >= limit:
            break
    if result:
        return result
    return [fallback] if fallback else []


def _format_money(value):
    numeric = _safe_number(value)
    if numeric is None:
        return None
    absolute = abs(float(numeric))
    if absolute >= 1e12:
        return f"${numeric / 1e12:.2f}T"
    if absolute >= 1e9:
        return f"${numeric / 1e9:.2f}B"
    if absolute >= 1e6:
        return f"${numeric / 1e6:.2f}M"
    if absolute >= 1e3:
        return f"${numeric / 1e3:.2f}K"
    if float(numeric).is_integer():
        return f"${int(numeric):,}"
    return f"${numeric:,.2f}"


def _format_number(value):
    numeric = _safe_number(value)
    if numeric is None:
        return None
    if float(numeric).is_integer():
        return f"{int(numeric):,}"
    return f"{numeric:,.2f}"


def _format_ratio(value, digits=1):
    numeric = _safe_number(value)
    if numeric is None:
        return None
    return f"{numeric:.{digits}f}"


def _format_percent(value):
    numeric = _safe_number(value)
    if numeric is None:
        return None
    return f"{numeric * 100:.1f}%"


def _normalize_company_name_for_search(name):
    text = _clean_text(name)
    if not text:
        return None
    text = re.sub(
        r"\b(the|incorporated|inc|corp|corporation|co|company|holdings|holding|group|plc|ltd|limited|sa|ag|nv|llc)\b",
        " ",
        text,
        flags=re.IGNORECASE,
    )
    text = re.sub(r"[^A-Za-z0-9& ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text or _clean_text(name)


def _token_overlap_score(candidate, target):
    candidate_tokens = {part for part in re.split(r"[^a-z0-9]+", str(candidate or "").lower()) if part}
    target_tokens = {part for part in re.split(r"[^a-z0-9]+", str(target or "").lower()) if part}
    if not candidate_tokens or not target_tokens:
        return 0
    return len(candidate_tokens & target_tokens)


def _pick_best_named_record(records, target_name):
    best = None
    best_score = -1
    for record in records or []:
        candidate_name = (
            record.get("recipient_name")
            or record.get("name")
            or record.get("title")
            or record.get("sponsor_name")
            or record.get("company_name")
            or ""
        )
        score = _token_overlap_score(candidate_name, target_name)
        if score > best_score:
            best = record
            best_score = score
    return best


def _push_source(target, source_id, label, category, url, used_for, status="used"):
    if not target:
        return
    normalized = {
        "id": source_id,
        "label": label,
        "category": category,
        "url": url,
        "usedFor": used_for,
        "status": status,
    }
    already = {source.get("id") for source in target if isinstance(source, dict)}
    if source_id not in already:
        target.append(normalized)


def _build_empty_research():
    return {
        "overview": [],
        "businessModel": [],
        "operations": [],
        "customers": [],
        "regulatory": [],
        "governance": [],
        "capitalAllocation": [],
        "catalysts": [],
        "risks": [],
    }


def _fetch_sec_mapping(symbol):
    try:
        payload = _http_get_json("https://www.sec.gov/files/company_tickers.json")
    except Exception:
        return None

    for record in (payload or {}).values():
        if str(record.get("ticker") or "").upper() == str(symbol or "").upper():
            return record
    return None


def _extract_latest_fact(company_facts, taxonomy, tags):
    facts = (((company_facts or {}).get("facts") or {}).get(taxonomy) or {})
    best = None

    for tag in tags:
        tag_payload = facts.get(tag) or {}
        units = tag_payload.get("units") or {}
        for unit, rows in units.items():
            for row in rows or []:
                value = _safe_number(row.get("val"))
                if value is None:
                    continue
                row_date = row.get("fy") or row.get("end") or row.get("filed")
                normalized_date = _normalize_date_str(row_date)
                sort_key = normalized_date or "0000-00-00"
                candidate = {
                    "tag": tag,
                    "label": tag_payload.get("label"),
                    "description": tag_payload.get("description"),
                    "value": value,
                    "unit": unit,
                    "form": row.get("form"),
                    "fy": row.get("fy"),
                    "filed": _normalize_date_str(row.get("filed")),
                    "end": _normalize_date_str(row.get("end")),
                    "_sort": sort_key,
                }
                if not best or candidate["_sort"] > best["_sort"]:
                    best = candidate
    if best:
        best.pop("_sort", None)
    return best


def _build_sec_filing_entry(cik_plain, forms, dates, accession_numbers, primary_documents, report_dates, descriptions, index):
    form = _clean_text(forms[index] if index < len(forms) else None)
    filing_date = _normalize_date_str(dates[index] if index < len(dates) else None)
    accession_number = _clean_text(accession_numbers[index] if index < len(accession_numbers) else None)
    primary_document = _clean_text(primary_documents[index] if index < len(primary_documents) else None)
    report_date = _normalize_date_str(report_dates[index] if index < len(report_dates) else None)
    description = _clean_text(descriptions[index] if index < len(descriptions) else None)
    filing_url = None
    if cik_plain and accession_number and primary_document:
        filing_url = f"https://www.sec.gov/Archives/edgar/data/{cik_plain}/{accession_number.replace('-', '')}/{primary_document}"
    return {
        "form": form,
        "filingDate": filing_date,
        "reportDate": report_date,
        "accessionNumber": accession_number,
        "primaryDocument": primary_document,
        "primaryDescription": description,
        "url": filing_url,
    }


def _find_first_form(recent, cik_plain, target_forms):
    target_forms = {str(form).upper() for form in (target_forms or [])}
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accession_numbers = recent.get("accessionNumber") or []
    primary_documents = recent.get("primaryDocument") or []
    report_dates = recent.get("reportDate") or []
    descriptions = recent.get("primaryDocDescription") or []

    for idx, raw_form in enumerate(forms):
        if str(raw_form or "").upper() in target_forms:
            return _build_sec_filing_entry(
                cik_plain,
                forms,
                dates,
                accession_numbers,
                primary_documents,
                report_dates,
                descriptions,
                idx,
            )
    return None


def _build_recent_sec_forms(recent, cik_plain):
    forms = recent.get("form") or []
    dates = recent.get("filingDate") or []
    accession_numbers = recent.get("accessionNumber") or []
    primary_documents = recent.get("primaryDocument") or []
    report_dates = recent.get("reportDate") or []
    descriptions = recent.get("primaryDocDescription") or []
    result = []
    for idx in range(min(len(forms), SEC_RECENT_FORMS_LIMIT)):
        result.append(
            _build_sec_filing_entry(
                cik_plain,
                forms,
                dates,
                accession_numbers,
                primary_documents,
                report_dates,
                descriptions,
                idx,
            )
        )
    return result


def _count_recent_forms(entries, form_name, lookback_days=365):
    cutoff = date.today() - timedelta(days=lookback_days)
    count = 0
    for entry in entries or []:
        if str(entry.get("form") or "").upper() != str(form_name or "").upper():
            continue
        filing_date = _normalize_date_str(entry.get("filingDate"))
        if not filing_date:
            continue
        try:
            if datetime.fromisoformat(filing_date).date() >= cutoff:
                count += 1
        except Exception:
            continue
    return count


def _fetch_sec_profile(symbol):
    mapping = _fetch_sec_mapping(symbol)
    if not mapping:
        return None

    cik_plain = str(mapping.get("cik_str") or "").strip()
    if not cik_plain:
        return None
    cik_padded = cik_plain.zfill(10)

    submissions = _http_get_json(f"https://data.sec.gov/submissions/CIK{cik_padded}.json")
    company_facts = None
    try:
        company_facts = _http_get_json(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik_padded}.json")
    except Exception:
        company_facts = None

    recent = ((submissions.get("filings") or {}).get("recent") or {})
    recent_forms = _build_recent_sec_forms(recent, cik_plain)

    return {
        "cik": cik_padded,
        "companyName": _clean_text(submissions.get("name") or mapping.get("title")),
        "entityType": _clean_text(submissions.get("entityType")),
        "sic": _clean_text(submissions.get("sic")),
        "sicDescription": _clean_text(submissions.get("sicDescription")),
        "fiscalYearEnd": _clean_text(submissions.get("fiscalYearEnd")),
        "description": _clean_text(submissions.get("description")),
        "stateOfIncorporation": _clean_text(submissions.get("stateOfIncorporation")),
        "tickers": _compact_unique_strings(submissions.get("tickers") or [mapping.get("ticker")]),
        "exchanges": _compact_unique_strings(submissions.get("exchanges") or []),
        "formerNames": [
            {
                "name": _clean_text(item.get("name")),
                "from": _normalize_date_str(item.get("from")),
                "to": _normalize_date_str(item.get("to")),
            }
            for item in (submissions.get("formerNames") or [])[:5]
            if isinstance(item, dict) and _clean_text(item.get("name"))
        ],
        "latestAnnualReport": _find_first_form(recent, cik_plain, {"10-K", "10-K/A", "20-F", "40-F"}),
        "latestQuarterlyReport": _find_first_form(recent, cik_plain, {"10-Q", "10-Q/A", "6-K"}),
        "latestCurrentReport": _find_first_form(recent, cik_plain, {"8-K", "8-K/A", "6-K"}),
        "recentForms": recent_forms,
        "recent8KCount": _count_recent_forms(recent_forms, "8-K", 365),
        "facts": {
            "sharesOutstanding": _extract_latest_fact(company_facts, "dei", ["EntityCommonStockSharesOutstanding"]),
            "rAndDExpense": _extract_latest_fact(company_facts, "us-gaap", ["ResearchAndDevelopmentExpense"]),
            "capitalExpenditures": _extract_latest_fact(
                company_facts,
                "us-gaap",
                ["PaymentsToAcquirePropertyPlantAndEquipment", "CapitalExpendituresIncurredButNotYetPaid"],
            ),
        },
        "sourceUrl": f"https://www.sec.gov/edgar/browse/?CIK={cik_padded}&owner=exclude&action=getcompany",
    }


def _fetch_fda_profile(company_name):
    cleaned_name = _clean_text(company_name)
    search_name = _normalize_company_name_for_search(cleaned_name)
    if not search_name:
        return None

    last_error = None
    data = None
    queries = [cleaned_name, search_name]
    for candidate in queries:
        if not candidate:
            continue
        try:
            data = _http_get_json(
                "https://api.fda.gov/drug/drugsfda.json",
                params={
                    "search": f'sponsor_name:"{candidate}"',
                    "limit": REGULATOR_BULLET_LIMIT,
                },
            )
            if data:
                break
        except Exception as exc:
            last_error = exc

    if not data:
        if last_error:
            return None
        return None

    results = data.get("results") or []
    if not results:
        return None

    latest_submissions = []
    product_names = []
    application_types = []
    sponsor_names = []

    for record in results:
        sponsor_names.append(record.get("sponsor_name"))
        application_types.append(record.get("application_number"))
        for product in record.get("products") or []:
            if isinstance(product, dict):
                product_names.append(product.get("brand_name"))
        for submission in record.get("submissions") or []:
            if not isinstance(submission, dict):
                continue
            latest_submissions.append({
                "submissionType": _clean_text(submission.get("submission_type")),
                "submissionStatus": _clean_text(submission.get("submission_status")),
                "date": _normalize_date_str(submission.get("submission_status_date")),
            })

    latest_submissions.sort(key=lambda row: row.get("date") or "", reverse=True)
    match_name = _clean_text(results[0].get("sponsor_name")) or cleaned_name

    return {
        "matchName": match_name,
        "applicationCount": _safe_number((((data.get("meta") or {}).get("results") or {}).get("total")) or len(results)),
        "sampleProducts": _compact_unique_strings(product_names, limit=REGULATOR_BULLET_LIMIT),
        "latestSubmissions": latest_submissions[:REGULATOR_BULLET_LIMIT],
        "applicationNumbers": _compact_unique_strings(application_types, limit=REGULATOR_BULLET_LIMIT),
        "sourceUrl": "https://open.fda.gov/apis/drug/drugsfda/",
    }


def _fetch_usaspending_profile(company_name):
    cleaned_name = _clean_text(company_name)
    search_name = _normalize_company_name_for_search(cleaned_name)
    if not search_name:
        return None

    try:
        data = _http_post_json(
            "https://api.usaspending.gov/api/v2/autocomplete/recipient/",
            {"search_text": cleaned_name, "limit": REGULATOR_BULLET_LIMIT},
        )
    except Exception:
        return None

    results = data.get("results") or []
    if not isinstance(results, list) or not results:
        return None

    best = _pick_best_named_record(results, cleaned_name) or results[0]
    return {
        "matchName": _clean_text(best.get("recipient_name") or best.get("name") or best.get("title")),
        "uei": _clean_text(best.get("uei")),
        "recipientId": _clean_text(best.get("id") or best.get("recipient_id") or best.get("internal_id")),
        "candidateCount": len(results),
        "sourceUrl": "https://api.usaspending.gov/docs/endpoints",
    }


def _build_sector_source_hints(theme, category):
    raw = f"{theme or ''} {category or ''}".strip().lower()
    sources = []

    if "pharma" in raw or "medicine" in raw or "drug" in raw or "biotech" in raw:
        sources.append({
            "id": "fda",
            "label": "FDA openFDA",
            "category": "regulator",
            "url": "https://open.fda.gov/apis/drug/drugsfda/",
            "usedFor": ["drug approvals", "sponsor-level product and submission data"],
            "status": "used",
        })
    if "defense" in raw:
        sources.append({
            "id": "usaspending",
            "label": "USAspending",
            "category": "regulator",
            "url": "https://api.usaspending.gov/docs/endpoints",
            "usedFor": ["federal awards", "recipient matching", "contract research"],
            "status": "used",
        })
    if "energy" in raw:
        sources.extend([
            {
                "id": "eia",
                "label": "U.S. Energy Information Administration",
                "category": "industry",
                "url": "https://www.eia.gov/opendata/documentation.php",
                "usedFor": ["energy market and operating datasets"],
                "status": "available",
            },
            {
                "id": "ferc",
                "label": "Federal Energy Regulatory Commission",
                "category": "regulator",
                "url": "https://mbrwebapi.ferc.gov/Help",
                "usedFor": ["market-based rate and market structure filings"],
                "status": "available",
            },
        ])
    if "transport" in raw:
        sources.append({
            "id": "bts",
            "label": "Bureau of Transportation Statistics",
            "category": "industry",
            "url": "https://data.transportation.gov/",
            "usedFor": ["carrier and transportation operating datasets"],
            "status": "available",
        })
    if "space" in raw:
        sources.extend([
            {
                "id": "faa",
                "label": "Federal Aviation Administration",
                "category": "regulator",
                "url": "https://www.faa.gov/aircraft",
                "usedFor": ["aircraft certification and registry resources"],
                "status": "available",
            },
            {
                "id": "fcc",
                "label": "Federal Communications Commission",
                "category": "regulator",
                "url": "https://publicfiles.fcc.gov/developer",
                "usedFor": ["license and spectrum datasets"],
                "status": "available",
            },
        ])
    return sources


def _build_research_and_sources(payload, theme=None, category=None):
    research = _build_empty_research()
    sources = []
    symbol = _clean_text(payload.get("symbol"))
    company_name = _clean_text(payload.get("name")) or symbol

    if symbol:
        _push_source(
            sources,
            "yahoo-finance",
            "Yahoo Finance",
            "market",
            f"https://finance.yahoo.com/quote/{symbol}",
            [
                "basic company profile",
                "headline financials",
                "valuation multiples",
                "earnings calendar",
            ],
        )

    sec_profile = None
    try:
        sec_profile = _fetch_sec_profile(symbol)
    except Exception:
        sec_profile = None

    if sec_profile:
        payload["filings"] = sec_profile
        _push_source(
            sources,
            "sec-edgar",
            "SEC EDGAR",
            "filings",
            sec_profile.get("sourceUrl"),
            [
                "company filings",
                "recent form history",
                "company facts and governance disclosures",
            ],
        )

        if sec_profile.get("cik"):
            research["overview"].append(f"SEC registrant CIK: {sec_profile['cik']}.")
        if sec_profile.get("sicDescription"):
            sic_code = sec_profile.get("sic")
            research["overview"].append(
                f"SEC industry classification: {sec_profile['sicDescription']}" +
                (f" (SIC {sic_code})." if sic_code else ".")
            )
        if sec_profile.get("fiscalYearEnd"):
            research["capitalAllocation"].append(f"Fiscal year end on SEC profile: {sec_profile['fiscalYearEnd']}.")
        if sec_profile.get("stateOfIncorporation"):
            research["governance"].append(f"State of incorporation: {sec_profile['stateOfIncorporation']}.")
        if sec_profile.get("latestAnnualReport", {}).get("filingDate"):
            latest_annual = sec_profile["latestAnnualReport"]
            research["overview"].append(
                f"Latest annual filing: Form {latest_annual.get('form')} filed {latest_annual.get('filingDate')}."
            )
            research["catalysts"].append(
                f"Management's full-year strategy, risk, and segment update is anchored to the {latest_annual.get('form')} filed {latest_annual.get('filingDate')}."
            )
        if sec_profile.get("latestQuarterlyReport", {}).get("filingDate"):
            latest_quarterly = sec_profile["latestQuarterlyReport"]
            research["businessModel"].append(
                f"Latest quarterly filing: Form {latest_quarterly.get('form')} filed {latest_quarterly.get('filingDate')}."
            )
        if sec_profile.get("recent8KCount") is not None:
            research["catalysts"].append(
                f"Current-report cadence: {sec_profile['recent8KCount']} Form 8-K filings in the last 12 months."
            )

        shares_outstanding = ((sec_profile.get("facts") or {}).get("sharesOutstanding") or {}).get("value")
        if shares_outstanding is not None:
            research["capitalAllocation"].append(
                f"SEC shares outstanding (latest available XBRL fact): {_format_number(shares_outstanding)}."
            )

        rnd_fact = (sec_profile.get("facts") or {}).get("rAndDExpense") or {}
        if rnd_fact.get("value") is not None:
            context_suffix = f", filed {rnd_fact.get('filed')}" if rnd_fact.get("filed") else ""
            research["operations"].append(
                f"SEC-reported R&D expense (latest available): {_format_money(rnd_fact.get('value'))}{context_suffix}."
            )

        capex_fact = (sec_profile.get("facts") or {}).get("capitalExpenditures") or {}
        if capex_fact.get("value") is not None:
            context_suffix = f", filed {capex_fact.get('filed')}" if capex_fact.get("filed") else ""
            research["capitalAllocation"].append(
                f"SEC-reported capital expenditure proxy (latest available): {_format_money(capex_fact.get('value'))}{context_suffix}."
            )

    raw_sector = f"{theme or ''} {category or ''}".strip().lower()

    if "pharma" in raw_sector or "medicine" in raw_sector or "drug" in raw_sector or "biotech" in raw_sector:
        fda_profile = _fetch_fda_profile(company_name)
        if fda_profile:
            payload["regulators"] = {**(payload.get("regulators") or {}), "fda": fda_profile}
            _push_source(
                sources,
                "fda",
                "FDA openFDA",
                "regulator",
                fda_profile.get("sourceUrl"),
                ["approved product and submission history"],
            )
            if fda_profile.get("applicationCount") is not None:
                research["regulatory"].append(
                    f"FDA Drugs@FDA sponsor match count: {_format_number(fda_profile['applicationCount'])} applications for {fda_profile.get('matchName') or company_name}."
                )
            if fda_profile.get("sampleProducts"):
                research["businessModel"].append(
                    f"Sample marketed or approved products from FDA data: {', '.join(fda_profile['sampleProducts'])}."
                )
            if fda_profile.get("latestSubmissions"):
                latest_submission = fda_profile["latestSubmissions"][0]
                research["catalysts"].append(
                    "Latest FDA submission in the current snapshot: " +
                    " • ".join(
                        item
                        for item in [
                            latest_submission.get("date"),
                            latest_submission.get("submissionType"),
                            latest_submission.get("submissionStatus"),
                        ]
                        if item
                    ) +
                    "."
                )

    if "defense" in raw_sector:
        usaspending_profile = _fetch_usaspending_profile(company_name)
        if usaspending_profile:
            payload["regulators"] = {**(payload.get("regulators") or {}), "usaspending": usaspending_profile}
            _push_source(
                sources,
                "usaspending",
                "USAspending",
                "regulator",
                usaspending_profile.get("sourceUrl"),
                ["recipient matching for federal award and contract research"],
            )
            recipient_bits = [usaspending_profile.get("matchName")]
            if usaspending_profile.get("uei"):
                recipient_bits.append(f"UEI {usaspending_profile['uei']}")
            research["customers"].append(
                "USAspending recipient match: " + " • ".join(bit for bit in recipient_bits if bit) + "."
            )
            if usaspending_profile.get("candidateCount") is not None:
                research["regulatory"].append(
                    f"USAspending returned {_format_number(usaspending_profile['candidateCount'])} recipient candidates for the company-name match."
                )

    for source in _build_sector_source_hints(theme, category):
        _push_source(
            sources,
            source.get("id"),
            source.get("label"),
            source.get("category"),
            source.get("url"),
            source.get("usedFor"),
            status=source.get("status") or "available",
        )

    payload["research"] = {
        key: _compact_unique_strings(values)
        for key, values in research.items()
        if _compact_unique_strings(values)
    }
    payload["sources"] = sources
    return payload


def fetch_company_profile(symbol, theme=None, category=None):
    ticker = yf.Ticker(symbol)
    info = ticker.info or {}
    calendar = ticker.calendar

    # 1. Fetch Finviz data for high-accuracy fields (Stock only)
    finviz_raw = _fetch_finviz_raw(symbol)
    finviz_data = _parse_finviz_data(finviz_raw)
    top_target, top_agency = _get_top_analyst_target(finviz_data.get("ratings", []))
    finviz_earnings = finviz_data.get("summary", {}).get("earnings")

    calendar_dict = {}
    try:
        if hasattr(calendar, "to_dict"):
            calendar_dict = calendar.to_dict() or {}
        elif isinstance(calendar, dict):
            calendar_dict = calendar
    except Exception:
        calendar_dict = {}

    eps_consensus = calendar_dict.get("Earnings Average") or calendar_dict.get("EPS Estimate")
    revenue_consensus = calendar_dict.get("Revenue Average") or calendar_dict.get("Revenue Estimate")
    if isinstance(eps_consensus, list):
        eps_consensus = eps_consensus[0] if eps_consensus else None
    if isinstance(revenue_consensus, list):
        revenue_consensus = revenue_consensus[0] if revenue_consensus else None

    # Merge Accurate Earnings Date
    # Finviz date is like "Apr 30 AMC" or "May 02 BMO"
    # We prefer this over yfinance if it looks valid
    next_earnings = _extract_next_earnings(calendar)
    if finviz_earnings and finviz_earnings != "-":
        next_earnings = finviz_earnings

    payload = {
        "topAnalystTarget": top_target,
        "topAnalystAgency": top_agency,
        "finvizMetrics": finviz_data.get("summary", {}),
        "symbol": str(symbol or "").upper(),
        "name": info.get("longName") or info.get("shortName") or str(symbol or "").upper(),
        "shortName": info.get("shortName"),
        "website": info.get("website"),
        "phone": info.get("phone"),
        "exchange": info.get("fullExchangeName") or info.get("exchange"),
        "currency": info.get("currency"),
        "sector": info.get("sectorDisp") or info.get("sector"),
        "industry": info.get("industryDisp") or info.get("industry"),
        "country": info.get("country"),
        "state": info.get("state"),
        "city": info.get("city"),
        "zip": info.get("zip"),
        "address1": info.get("address1"),
        "summary": info.get("longBusinessSummary") or info.get("businessSummary"),
        "employees": info.get("fullTimeEmployees"),
        "marketCap": info.get("marketCap"),
        "enterpriseValue": info.get("enterpriseValue"),
        "currentPrice": info.get("currentPrice") or info.get("regularMarketPrice"),
        "fiftyTwoWeekLow": info.get("fiftyTwoWeekLow"),
        "fiftyTwoWeekHigh": info.get("fiftyTwoWeekHigh"),
        "beta": info.get("beta"),
        "trailingPE": info.get("trailingPE"),
        "forwardPE": info.get("forwardPE"),
        "priceToBook": info.get("priceToBook"),
        "enterpriseToRevenue": info.get("enterpriseToRevenue"),
        "enterpriseToEbitda": info.get("enterpriseToEbitda"),
        "dividendYield": info.get("dividendYield"),
        "totalRevenue": info.get("totalRevenue"),
        "revenueGrowth": info.get("revenueGrowth"),
        "earningsGrowth": info.get("earningsGrowth"),
        "grossMargins": info.get("grossMargins"),
        "operatingMargins": info.get("operatingMargins"),
        "ebitdaMargins": info.get("ebitdaMargins"),
        "profitMargins": info.get("profitMargins"),
        "freeCashflow": info.get("freeCashflow"),
        "operatingCashflow": info.get("operatingCashflow"),
        "returnOnAssets": info.get("returnOnAssets"),
        "returnOnEquity": info.get("returnOnEquity"),
        "totalCash": info.get("totalCash"),
        "totalDebt": info.get("totalDebt"),
        "debtToEquity": info.get("debtToEquity"),
        "currentRatio": info.get("currentRatio"),
        "quickRatio": info.get("quickRatio"),
        "targetMeanPrice": info.get("targetMeanPrice"),
        "targetHighPrice": info.get("targetHighPrice"),
        "targetLowPrice": info.get("targetLowPrice"),
        "analystRating": info.get("recommendationKey"),
        "analystCount": info.get("numberOfAnalystOpinions"),
        "earnings": {
            "nextEarnings": next_earnings,
            "eps": {
                "consensus": eps_consensus or info.get("forwardEps"),
                "previous": info.get("trailingEps"),
            },
            "revenue": {
                "consensus": revenue_consensus,
                "previous": info.get("totalRevenue"),
            },
        },
        "earningsHistory": _extract_recent_earnings(ticker),
        "leadership": _extract_leadership(info),
        "risk": {
            "overallRisk": info.get("overallRisk"),
            "auditRisk": info.get("auditRisk"),
            "boardRisk": info.get("boardRisk"),
            "compensationRisk": info.get("compensationRisk"),
            "shareHolderRightsRisk": info.get("shareHolderRightsRisk"),
        },
    }

    enriched = _build_research_and_sources(payload, theme=theme, category=category)
    return _normalize_json(enriched)


if __name__ == "__main__":
    try:
        raw = sys.stdin.read().strip()
        data = json.loads(raw or "{}")
        symbol = str(data.get("symbol") or "").strip()
        theme = _clean_text(data.get("theme"))
        category = _clean_text(data.get("category"))
        if not symbol:
            print(json.dumps({"error": "No symbol provided"}))
            sys.exit(0)
        print(json.dumps(fetch_company_profile(symbol, theme=theme, category=category)))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}))
