// Asset Intelligence Platform — AssetAdapter layer (Phase 2.1).
//
// Each adapter maps a vertical backend API into a normalized AssetSnapshot
// (see assetContracts.js). UI never sees a vertical schema. Adapters are the
// single seam new asset kinds plug into — no page-tree fork.
//
// This mirrors the proven adapter-registry pattern already in
// portfolioIntelligence/services/OrderNormalizationService (provider -> normalized entity).
//
// No fabricated data: missing fields are null/[]; callers render honest
// "Unavailable" (Brand v2).

import { zeninFetchJson } from "./zeninFetch";
import { ZENIN_API_BASE_URL } from "../constants/apiConfig";

/**
 * Base adapter. Subclasses override `fetchSnapshot`.
 * @abstract
 */
export class AssetAdapter {
  /** @param {string} kind */
  constructor(kind) {
    this.kind = kind;
  }

  /**
   * Fetch + normalize a point-in-time snapshot for a symbol.
   * @param {string} symbol
   * @returns {Promise<import("./assetContracts").AssetSnapshot|null>}
   */
  // eslint-disable-next-line no-unused-vars
  async fetchSnapshot(symbol) {
    return null; // base returns empty; subclasses implement.
  }

  /** Memo-friendly key. Override if kind needs richer identity. */
  // eslint-disable-next-line no-unused-vars
  routeSymbol(symbol) {
    return String(symbol || "").toUpperCase();
  }
}

/** Stock / equity adapter — maps finviz + equities price into AssetSnapshot. */
export class StockAdapter extends AssetAdapter {
  constructor() {
    super("stock");
  }

  async fetchSnapshot(symbol) {
    const sym = this.routeSymbol(symbol);
    try {
      const [price, finviz] = await Promise.all([
        zeninFetchJson(`${ZENIN_API_BASE_URL}/api/equities/stocks/${encodeURIComponent(sym)}/price`).catch(() => null),
        zeninFetchJson(`${ZENIN_API_BASE_URL}/api/finviz?symbol=${encodeURIComponent(sym)}`).catch(() => null),
      ]);
      const last = price?.price ?? price?.lastPrice ?? price?.latestPrice ?? null;
      const series = Array.isArray(price?.series)
        ? price.series.slice(-120).map((p) => (Array.isArray(p) ? p[1] : p?.close ?? p?.value ?? null)).filter((v) => typeof v === "number")
        : [];
      const day = finviz?.change ?? finviz?.["Change"] ?? null;
      const dayPct = finviz?.["Change %"] != null ? parseFloat(String(finviz["Change %"]).replace("%", "")) : (price?.changePct ?? null);
      return {
        symbol: sym,
        kind: "stock",
        price: typeof last === "number" ? last : null,
        dayChangePct: typeof dayPct === "number" ? dayPct : null,
        ytdChangePct: finviz?.["Perf Year"] != null ? parseFloat(String(finviz["Perf Year"]).replace("%", "")) : null,
        series,
        updatedAt: price?.updatedAt ?? finviz?.updatedAt ?? null,
        raw: { finviz: finviz || null, price: price || null },
      };
    } catch {
      return { symbol: sym, kind: "stock", price: null, dayChangePct: null, ytdChangePct: null, series: [], updatedAt: null, raw: {} };
    }
  }
}

/** Commodity adapter — maps /api/commodities list + price into AssetSnapshot. */
export class CommodityAdapter extends AssetAdapter {
  constructor() {
    super("commodity");
  }

  async fetchSnapshot(symbol) {
    const sym = this.routeSymbol(symbol);
    try {
      const [list, price] = await Promise.all([
        zeninFetchJson(`${ZENIN_API_BASE_URL}/api/commodities/list`).catch(() => null),
        zeninFetchJson(`${ZENIN_API_BASE_URL}/api/commodities/${encodeURIComponent(sym)}/price?range=1Y`).catch(() => null),
      ]);
      const items = Array.isArray(list?.list) ? list.list : Array.isArray(list) ? list : [];
      const row = items.find((r) => String(r.symbol || r.id || "").toUpperCase() === sym)
        || items.find((r) => String(r.name || "").toUpperCase() === sym);
      const series = Array.isArray(price?.series)
        ? price.series.slice(-120).map((p) => (Array.isArray(p) ? p[1] : p?.close ?? p?.value ?? null)).filter((v) => typeof v === "number")
        : [];
      const last = row?.price ?? row?.lastPrice ?? row?.latestPrice ?? price?.price ?? null;
      return {
        symbol: sym,
        kind: "commodity",
        price: typeof last === "number" ? last : null,
        dayChangePct: row?.dailyChangePct ?? row?.daily ?? row?.changePct ?? null,
        ytdChangePct: row?.ytdChangePct ?? row?.ytd ?? null,
        series,
        updatedAt: price?.updatedAt ?? row?.updatedAt ?? null,
        raw: { row: row || null, price: price || null },
      };
    } catch {
      return { symbol: sym, kind: "commodity", price: null, dayChangePct: null, ytdChangePct: null, series: [], updatedAt: null, raw: {} };
    }
  }
}

/**
 * ETF adapter — prices via the new backend proxy `/api/etf/:symbol/price`
 * (Yahoo, keyless — same source as equities). AUM / holdings / expense ratio /
 * flows are intentionally left null (no feed yet) so the UI renders honest
 * "Unavailable" rather than fabricated values (Brand v2).
 */
export class EtfAdapter extends AssetAdapter {
  constructor() {
    super("etf");
  }

  async fetchSnapshot(symbol) {
    const sym = this.routeSymbol(symbol);
    try {
      const price = await zeninFetchJson(`${ZENIN_API_BASE_URL}/api/etf/${encodeURIComponent(sym)}/price`).catch(() => null);
      const last = price?.price ?? null;
      const dayPct = price?.changePct ?? null;
      return {
        symbol: sym,
        kind: "etf",
        price: typeof last === "number" ? last : null,
        dayChangePct: typeof dayPct === "number" ? dayPct : null,
        ytdChangePct: null,
        series: [],
        updatedAt: price?.updatedAt ?? null,
        raw: { price: price || null },
      };
    } catch {
      return { symbol: sym, kind: "etf", price: null, dayChangePct: null, ytdChangePct: null, series: [], updatedAt: null, raw: {} };
    }
  }
}

/**
 /**
  * Indicator adapter — maps a macro indicator (e.g. "CPI", "PPI") into the
  * normalized AssetSnapshot shape. Indicators are not tradable instruments, so
  * price is the latest reading (not a market price) and series is the indicator's
  * own historical series when available; otherwise an honest empty snapshot so
  * the UI renders "Unavailable" rather than fabricated values (Brand v2).
  */
 export class IndicatorAdapter extends AssetAdapter {
   constructor() {
     super("indicator");
   }

   async fetchSnapshot(symbol) {
     const sym = this.routeSymbol(symbol);
     return {
       symbol: sym,
       kind: "indicator",
       price: null,
       dayChangePct: null,
       ytdChangePct: null,
       series: [],
       updatedAt: null,
       raw: { note: "indicator-snapshot-placeholder", assetClass: "macro" },
     };
   }
 }

 /** Macro adapter — maps a macro "asset" (a country code, e.g. "USA", or
 * "GLOBAL") into the normalized AssetSnapshot shape. Macro has no price feed
 * (it is a regime/themes intelligence asset, not a tradable instrument), so the
 * snapshot is an honest empty one — price null, series empty — letting the UI
 * render "Unavailable" rather than fabricated values (Brand v2). Structure
 * ready for a /api/macro/regime + /macro/timeseries feed to populate.
 */
export class MacroAdapter extends AssetAdapter {
  constructor() {
    super("macro");
  }

  async fetchSnapshot(symbol) {
    const sym = this.routeSymbol(symbol) || "GLOBAL";
    return {
      symbol: sym,
      kind: "macro",
      price: null,
      dayChangePct: null,
      ytdChangePct: null,
      series: [],
      updatedAt: null,
      raw: { note: "no-macro-price-feed", assetClass: "macro" },
    };
  }
}

/**
 * Currency / FX adapter.
 *  - FX pair (instrumentType "fx-pair"): fetch quote/history via providerSymbol
 *    (Yahoo =X). Returns normalized AssetSnapshot with price where available.
 *  - Currency code (instrumentType "currency-code"): macro research entity.
 *    Returns identity/freshness and a NULL price — never fabricate a quote.
 * Resolution is by the instrument passed in; callers supply the normalized
 * AssetInstrument (resolveCurrencyInstrument) so we never guess.
 */
export class CurrencyAdapter extends AssetAdapter {
  constructor() {
    super("currency");
  }

  async fetchSnapshot(symbol, instrument) {
    const sym = this.routeSymbol(symbol);
    // Currency code: research entity, no pseudo-price/history endpoint.
    if (instrument && (instrument.kind === "currency" || instrument.instrumentType === "currency-code")) {
      return {
        symbol: sym,
        kind: "currency",
        price: null,
        dayChangePct: null,
        ytdChangePct: null,
        series: [],
        updatedAt: null,
        raw: { note: "currency-code-no-price-feed", assetClass: "macro" },
      };
    }
    // FX pair: fetch via provider symbol.
    const providerSymbol = instrument?.providerSymbol || (sym ? `${sym.replace("/", "")}X` : null);
    if (!providerSymbol) {
      return { symbol: sym, kind: "forex", price: null, dayChangePct: null, ytdChangePct: null, series: [], updatedAt: null, raw: {} };
    }
    try {
      const price = await zeninFetchJson(`${ZENIN_API_BASE_URL}/api/fx/${encodeURIComponent(providerSymbol)}/price`).catch(() => null);
      const last = price?.price ?? price?.lastPrice ?? price?.regularMarketPrice ?? null;
      const dayPct = price?.changePct ?? price?.["Change %"] ?? price?.regularMarketChangePercent ?? null;
      return {
        symbol: sym,
        kind: "forex",
        price: typeof last === "number" ? last : null,
        dayChangePct: typeof dayPct === "number" ? dayPct : null,
        ytdChangePct: null,
        series: [],
        updatedAt: price?.updatedAt ?? null,
        raw: { price: price || null },
      };
    } catch {
      return { symbol: sym, kind: "forex", price: null, dayChangePct: null, ytdChangePct: null, series: [], updatedAt: null, raw: {} };
    }
  }
}

// Adapter instances (extend with Bond/Fund/Crypto/Index/Private later).
const ADAPTERS = {
  stock: new StockAdapter(),
  commodity: new CommodityAdapter(),
  etf: new EtfAdapter(),
  macro: new MacroAdapter(),
  indicator: new IndicatorAdapter(),
  currency: new CurrencyAdapter(),
};

/** Get the adapter for a kind, or null if unsupported. */
export function getAdapter(kind) {
  return ADAPTERS[kind] || null;
}

/** Resolve a kind's adapter by trying known kinds; returns null when unknown. */
export function adapterForKind(kind) {
  return getAdapter(kind);
}
