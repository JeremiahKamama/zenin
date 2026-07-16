// ETFdbApiNormalizer — normalize a raw ETFdb API payload into the single
// provider-agnostic ETF contract used by Zenin surfaces (ARW, modal, compare,
// portfolio overlap).
//
// Rules (from the integration spec):
//  - Preserve null; never infer unavailable fund data.
//  - Label ETFdb price as "Delayed price", never live.
//  - Attach provenance: provider, fetchedAt, freshness, per-field source.
//  - Some fields may be restricted/missing/inconsistent across funds.
//
// The normalizer is PURE. If the raw payload is unavailable it returns the
// honest unavailable contract — no fabrication, no Ghost fill.

const PROVIDER = "ETFdb";

function num(v) {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v) {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function weightPairs(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item) => {
      if (item && typeof item === "object") {
        return { name: str(item.name || item.label), weightPct: num(item.weightPct ?? item.weight) };
      }
      return null;
    })
    .filter((x) => x && (x.name || x.weightPct !== null));
}

function holdings(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((item, i) => {
      if (!item || typeof item !== "object") return null;
      return {
        symbol: str(item.symbol || item.ticker),
        name: str(item.name),
        weightPct: num(item.weightPct ?? item.weight),
        rank: typeof item.rank === "number" ? item.rank : i + 1,
      };
    })
    .filter((x) => x && (x.symbol || x.name));
}

function returnsFrom(raw) {
  const r = (raw && typeof raw === "object") ? raw : {};
  return {
    oneWeekPct: num(r.oneWeekPct ?? r.oneWeek),
    oneMonthPct: num(r.oneMonthPct ?? r.oneMonth),
    ytdPct: num(r.ytdPct ?? r.ytd),
    oneYearPct: num(r.oneYearPct ?? r.oneYear),
    threeYearPct: num(r.threeYearPct ?? r.threeYear),
    fiveYearPct: num(r.fiveYearPct ?? r.fiveYear),
  };
}

function provenanceFor(fetchedAt, freshness, fields = {}) {
  return {
    provider: PROVIDER,
    fetchedAt: fetchedAt || null,
    freshness: freshness || "unavailable", // "fresh" | "stale" | "unavailable"
    fields,
  };
}

function buildContract(raw, fetchedAt, freshness, fields = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    symbol: str(r.symbol) || str(r.ticker),
    identity: {
      name: str(r.name || r.identity?.name),
      issuer: str(r.issuer || r.identity?.issuer),
      assetClass: str(r.assetClass || r.identity?.assetClass),
      category: str(r.category || r.identity?.category),
      inceptionDate: str(r.inceptionDate || r.identity?.inceptionDate),
    },
    market: {
      delayedPrice: num(r.delayedPrice ?? r.price ?? r.market?.delayedPrice),
      averageVolume: num(r.averageVolume ?? r.market?.averageVolume),
      returns: returnsFrom(r.returns ?? r.market?.returns),
    },
    fund: {
      aum: num(r.aum ?? r.fund?.aum),
      expenseRatioPct: num(r.expenseRatioPct ?? r.fund?.expenseRatioPct),
      dividendYieldPct: num(r.dividendYieldPct ?? r.fund?.dividendYieldPct),
      distributionFrequency: str(r.distributionFrequency ?? r.fund?.distributionFrequency),
      holdingsCount: num(r.holdingsCount ?? r.fund?.holdingsCount),
    },
    flows: {
      oneWeek: num(r.flows?.oneWeek),
      oneMonth: num(r.flows?.oneMonth),
      ytd: num(r.flows?.ytd),
      oneYear: num(r.flows?.oneYear),
      asOf: str(r.flows?.asOf),
    },
    composition: {
      holdings: holdings(r.holdings ?? r.composition?.holdings),
      sectors: weightPairs(r.sectors ?? r.composition?.sectors),
      countries: weightPairs(r.countries ?? r.composition?.countries),
      assetAllocation: weightPairs(r.assetAllocation ?? r.composition?.assetAllocation),
    },
    provenance: provenanceFor(fetchedAt, freshness, fields),
  };
}

// normalizeOverview — full contract (used by /overview and ARW).
function normalizeOverview(raw, fetchedAt, freshness, fields) {
  return buildContract(raw, fetchedAt, freshness, fields);
}

// normalizeComposition — composition slice only.
function normalizeComposition(raw, fetchedAt, freshness) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    holdings: holdings(r.holdings ?? r.composition?.holdings),
    sectors: weightPairs(r.sectors ?? r.composition?.sectors),
    countries: weightPairs(r.countries ?? r.composition?.countries),
    assetAllocation: weightPairs(r.assetAllocation ?? r.composition?.assetAllocation),
    provenance: provenanceFor(fetchedAt, freshness, { holdings: PROVIDER }),
  };
}

// normalizeMetrics — fund economics + delayed market.
function normalizeMetrics(raw, fetchedAt, freshness) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    fund: {
      aum: num(r.aum ?? r.fund?.aum),
      expenseRatioPct: num(r.expenseRatioPct ?? r.fund?.expenseRatioPct),
      dividendYieldPct: num(r.dividendYieldPct ?? r.fund?.dividendYieldPct),
      distributionFrequency: str(r.distributionFrequency ?? r.fund?.distributionFrequency),
      holdingsCount: num(r.holdingsCount ?? r.fund?.holdingsCount),
    },
    market: {
      delayedPrice: num(r.delayedPrice ?? r.price ?? r.market?.delayedPrice),
      averageVolume: num(r.averageVolume ?? r.market?.averageVolume),
      returns: returnsFrom(r.returns ?? r.market?.returns),
    },
    provenance: provenanceFor(fetchedAt, freshness, {
      expenseRatioPct: PROVIDER,
      delayedPrice: PROVIDER,
    }),
  };
}

// normalizeFlows — delayed flow data + as-of.
function normalizeFlows(raw, fetchedAt, freshness) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    flows: {
      oneWeek: num(r.flows?.oneWeek),
      oneMonth: num(r.flows?.oneMonth),
      ytd: num(r.flows?.ytd),
      oneYear: num(r.flows?.oneYear),
      asOf: str(r.flows?.asOf),
    },
    provenance: provenanceFor(fetchedAt, freshness, { flows: PROVIDER }),
  };
}

// normalizeSearchResult — compact result for catalogue search.
function normalizeSearchResult(item) {
  const r = item && typeof item === "object" ? item : {};
  return {
    symbol: str(r.symbol || r.ticker),
    name: str(r.name),
    issuer: str(r.issuer),
    assetClass: str(r.assetClass),
    category: str(r.category),
    expenseRatioPct: num(r.expenseRatioPct),
    aum: num(r.aum),
    delayedPrice: num(r.delayedPrice ?? r.price),
    fetchedAt: r.fetchedAt || null,
  };
}

// normalizeUnavailable — honest empty contract (no data, no fabrication).
function normalizeUnavailable(symbol) {
  return buildContract({ symbol }, null, "unavailable", {});
}

module.exports = {
  PROVIDER,
  normalizeOverview,
  normalizeComposition,
  normalizeMetrics,
  normalizeFlows,
  normalizeSearchResult,
  normalizeUnavailable,
  // exposed for tests / future adapter wiring
  _internal: { buildContract, returnsFrom, holdings, weightPairs },
};
