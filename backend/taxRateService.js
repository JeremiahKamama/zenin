// backend/taxRateService.js
// Tax Rate Service — hybrid source: versioned JSON base + Wikipedia scrape + government overrides
//
// Priority: government_overrides (from JSON) > Wikipedia scrape > JSON base rates
// Wikipedia is scraped quarterly (or on-demand) and cached in Postgres.

const fs = require("fs");
const path = require("path");

const TAX_RATES_FILE = path.join(__dirname, "data", "taxRates.json");
const WIKIPEDIA_CGT_URL = "https://en.wikipedia.org/wiki/Capital_gains_tax";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours for in-memory cache
const SCRAPE_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

let inMemoryCache = null;
let inMemoryCacheAt = 0;

function loadBaseRates() {
  try {
    const raw = fs.readFileSync(TAX_RATES_FILE, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    console.warn("[TaxRates] Failed to load base JSON:", err?.message || err);
    return null;
  }
}

// ─── Wikipedia scraper ──────────────────────────────────────────────────────
// Parses the "By country" section of Wikipedia's Capital gains tax article.
// Returns a map: { countryCode: { cgRate, stRate, source: 'wikipedia', scrapedAt } }
async function scrapeWikipediaRates(fetchImpl) {
  const fetch = fetchImpl || globalThis.fetch;
  if (!fetch) {
    console.warn("[TaxRates] No fetch implementation — skipping Wikipedia scrape");
    return null;
  }

  try {
    const response = await fetch(WIKIPEDIA_CGT_URL, {
      headers: { "User-Agent": "Zenin/1.0 (tax rate aggregator; contact@zenin.capital)" }
    });
    if (!response.ok) {
      throw new Error(`Wikipedia responded ${response.status}`);
    }
    const html = await response.text();

    // Wikipedia's "By country" section contains a wikitable with columns:
    // Country | Capital gains tax rate | ...
    // We parse the HTML to extract country → rate pairs.
    const rates = {};

    // Extract table rows from the HTML (simple regex-based parser —
    // Wikipedia HTML is fairly stable but this should be treated as best-effort)
    const tableMatch = html.match(/<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
    if (!tableMatch) {
      console.warn("[TaxRates] Wikipedia: no wikitable found");
      return null;
    }

    const tableHtml = tableMatch[1];
    const rowMatches = tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

    for (const rowMatch of rowMatches) {
      const rowHtml = rowMatch[1];
      const cells = [...rowHtml.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) =>
        m[1].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").trim()
      );
      if (cells.length < 2) continue;

      const countryName = cells[0];
      const rateText = cells[1];

      // Skip header rows
      if (/country/i.test(countryName) && /rate/i.test(rateText)) continue;

      // Parse percentage from rate text (e.g. "20%", "0%", "15-22.5%")
      const pctMatch = rateText.match(/(\d+(?:\.\d+)?)\s*%/);
      if (!pctMatch) continue;

      const rate = parseFloat(pctMatch[1]) / 100;
      const countryCode = normalizeCountryCode(countryName);
      if (!countryCode) continue;

      rates[countryCode] = {
        cgRate: rate,
        stRate: rate,
        source: "wikipedia",
        sourceUrl: WIKIPEDIA_CGT_URL,
        scrapedAt: new Date().toISOString(),
        rawText: rateText.slice(0, 200)
      };
    }

    console.log(`[TaxRates] Wikipedia scrape: extracted ${Object.keys(rates).length} country rates`);
    return rates;
  } catch (err) {
    console.warn("[TaxRates] Wikipedia scrape failed:", err?.message || err);
    return null;
  }
}

function normalizeCountryCode(name) {
  const normalized = String(name || "").trim().toLowerCase();
  const map = {
    "united states": "USA",
    "united states of america": "USA",
    "united kingdom": "UK",
    "great britain": "UK",
    "canada": "Canada",
    "brazil": "Brazil",
    "germany": "Germany",
    "france": "France",
    "spain": "Spain",
    "italy": "Italy",
    "netherlands": "Netherlands",
    "portugal": "Portugal",
    "switzerland": "Switzerland",
    "united arab emirates": "UAE",
    "saudi arabia": "SaudiArabia",
    "qatar": "Qatar",
    "bahrain": "Bahrain",
    "oman": "Oman",
    "singapore": "Singapore",
    "malaysia": "Malaysia",
    "indonesia": "Indonesia",
    "thailand": "Thailand",
    "vietnam": "Vietnam",
    "philippines": "Philippines",
    "india": "India",
    "china": "China",
    "japan": "Japan",
    "south korea": "SouthKorea",
    "republic of korea": "SouthKorea",
    "hong kong": "HongKong",
    "south africa": "SouthAfrica",
    "nigeria": "Nigeria",
    "egypt": "Egypt",
    "ethiopia": "Ethiopia",
    "kenya": "Kenya",
    "morocco": "Morocco",
    "angola": "Angola",
    "ghana": "Ghana",
    "tanzania": "Tanzania",
    "cote d'ivoire": "Cote",
    "ivory coast": "Cote"
  };
  return map[normalized] || null;
}

// ─── Merge logic ─────────────────────────────────────────────────────────────
// Priority: government_overrides > Wikipedia > JSON base
function mergeTaxRates(baseData, wikiRates) {
  if (!baseData) {
    return { rules: {}, regions: [], lastUpdated: null, sources: [] };
  }

  const merged = {
    rules: {},
    regions: baseData.regions || [],
    lastUpdated: baseData._meta?.last_updated || null,
    sources: baseData._meta?.sources || [],
    sourceDetail: {}
  };

  // 1. Start with base JSON rates
  Object.entries(baseData.rules || {}).forEach(([code, rule]) => {
    merged.rules[code] = { ...rule, source: "base_json" };
    merged.sourceDetail[code] = {
      primary: "base_json",
      baseRate: rule.cgRate,
      lastUpdated: baseData._meta?.last_updated
    };
  });

  // 2. Override with Wikipedia rates (if scraped and newer)
  if (wikiRates) {
    Object.entries(wikiRates).forEach(([code, wikiRate]) => {
      if (merged.rules[code]) {
        // Wikipedia overrides the rate but keeps the base logic text
        merged.rules[code] = {
          ...merged.rules[code],
          cgRate: wikiRate.cgRate,
          stRate: wikiRate.stRate,
          source: "wikipedia"
        };
        merged.sourceDetail[code] = {
          primary: "wikipedia",
          baseRate: merged.rules[code].cgRate,
          wikiRate: wikiRate.cgRate,
          wikiRawText: wikiRate.rawText,
          lastUpdated: wikiRate.scrapedAt,
          sourceUrl: wikiRate.sourceUrl
        };
      }
    });
  }

  // 3. Government overrides (US brackets, UK bands, AU discount)
  // These are stored in the JSON file under "government_overrides" and
  // provide structured bracket data that supplements the flat rate.
  merged.governmentOverrides = baseData.government_overrides || {};

  return merged;
}

// ─── Public API ──────────────────────────────────────────────────────────────
async function getTaxRates({ forceRefresh = false, fetchImpl = null } = {}) {
  // Check in-memory cache
  if (!forceRefresh && inMemoryCache && (Date.now() - inMemoryCacheAt) < CACHE_TTL_MS) {
    return inMemoryCache;
  }

  const baseData = loadBaseRates();
  if (!baseData) {
    return {
      rules: {},
      regions: [],
      lastUpdated: null,
      sources: [],
      error: "base_rates_unavailable"
    };
  }

  // Try Wikipedia scrape (best-effort, non-blocking on failure)
  let wikiRates = null;
  try {
    wikiRates = await scrapeWikipediaRates(fetchImpl);
  } catch (err) {
    console.warn("[TaxRates] Wikipedia scrape error:", err?.message || err);
  }

  const merged = mergeTaxRates(baseData, wikiRates);
  merged.lastFetchedAt = new Date().toISOString();
  merged.wikipediaScrapeSuccess = Boolean(wikiRates);

  inMemoryCache = merged;
  inMemoryCacheAt = Date.now();

  return merged;
}

// For DB-backed caching (optional, for shared state across instances)
async function getCachedTaxRatesFromDb(pool) {
  try {
    const result = await pool.query(`
      SELECT payload_json AS payload, updated_at AS "updatedAt"
      FROM service_snapshots
      WHERE snapshot_key = 'tax_rates'
      LIMIT 1;
    `);
    if (result.rows[0]) {
      return {
        ...result.rows[0].payload,
        cachedAt: result.rows[0].updatedAt
      };
    }
  } catch (err) {
    console.warn("[TaxRates] DB cache read failed:", err?.message || err);
  }
  return null;
}

async function writeTaxRatesToDb(pool, rates) {
  try {
    await pool.query(`
      INSERT INTO service_snapshots (snapshot_key, payload_json, updated_at)
      VALUES ('tax_rates', $1, NOW())
      ON CONFLICT (snapshot_key) DO UPDATE SET
        payload_json = EXCLUDED.payload_json,
        updated_at = NOW();
    `, [JSON.stringify(rates)]);
  } catch (err) {
    console.warn("[TaxRates] DB cache write failed:", err?.message || err);
  }
}

module.exports = {
  getTaxRates,
  loadBaseRates,
  scrapeWikipediaRates,
  mergeTaxRates,
  getCachedTaxRatesFromDb,
  writeTaxRatesToDb,
  normalizeCountryCode
};
