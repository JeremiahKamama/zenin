// normalizeAssetData — single source of truth for flattening the three ARW/Compare
// reference-data payloads (prices, earnings, finviz) into one flat asset object.
//
// Field paths are derived from the ACTUAL backend responses (verified against
// scripts/fetch_earnings.py and scripts/fetch_finviz.py), not speculative ones:
//   - prices:  { price, priceChangePercent }  (root-level, /api/prices)
//   - earnings: { marketCap (top-level), nextEarnings, valuation{...},
//                profile{beta,dividendYield,fiftyTwoWeek*,averageVolume,
//                        + companyName/sector/industry/country/exchange (enriched)} }
//   - finviz:  { header_meta{sector,industry,country}, summary{market_cap,pe},
//                news[{headline,link,timestamp,source}] }
//
// No fabricated values — every missing field stays null. Pure function: same
// inputs always yield the same output, which makes the ARW + Compare hooks
// drop-in share one real-data reader.

function parseNumber(value) {
  if (value == null) return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}

export function normalizeAssetData({ pricesRes, earningsRes, finvizRes, symbol } = {}) {
  const sym = String(symbol || "").trim().toUpperCase() || null;
  const prices = pricesRes && !pricesRes.error ? pricesRes : null;
  const earnings = earningsRes && !earningsRes.error ? earningsRes : null;
  const finviz = finvizRes && !finvizRes.error ? finvizRes : null;

  const eProfile = earnings?.profile || {};
  const eValuation = earnings?.valuation || {};
  const fHeader = finviz?.header_meta || {};
  const fSummary = finviz?.summary || {};

  const price = prices?.price ?? earnings?.profile?.price ?? null;
  const changePct =
    prices?.priceChangePercent ?? prices?.changePercent ?? null;

  const name =
    eProfile.companyName || fHeader.name || finviz?.name || sym;

  const sector = eProfile.sector || fHeader.sector || null;
  const industry = eProfile.industry || fHeader.industry || null;
  const country = eProfile.country || fHeader.country || null;
  const exchange = eProfile.exchange || null;

  const marketCap =
    earnings?.marketCap != null ? parseNumber(earnings.marketCap) : parseNumber(fSummary.market_cap);

  const news = Array.isArray(finviz?.news)
    ? finviz.news
        .map((n) => ({
          title: n.headline ?? n.title ?? null,
          url: n.link ?? n.url ?? null,
          time: n.timestamp ?? n.time ?? null,
          source: n.source ?? null,
        }))
        .filter((n) => n.title && n.url)
    : [];

  return {
    symbol: sym,
    name,
    exchange,
    sector,
    industry,
    country,
    beta: eProfile.beta ?? null,
    price,
    change: prices?.change ?? null,
    changePct,
    marketCap,
    high52: eProfile.fiftyTwoWeekHigh ?? null,
    low52: eProfile.fiftyTwoWeekLow ?? null,
    trailingPe: eValuation.trailingPe ?? null,
    forwardPe: eValuation.forwardPe ?? null,
    priceToSales: eValuation.priceToSales ?? null,
    enterpriseToEbitda: eValuation.enterpriseToEbitda ?? null,
    nextEarnings: earnings?.nextEarnings ?? null,
    news,
    // Pass through the raw payloads so consumers that still need deep fields
    // (valuation rows, profile pages) can reach them without re-fetching.
    earnings,
    finviz,
  };
}

export default normalizeAssetData;
