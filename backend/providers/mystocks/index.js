"use strict";

/**
 * MyStocks Africa — provider facade.
 *
 * Exposes a stable surface for equitiesProvider.js and the backend routes:
 *  - createMyStocksProvider() -> { id, isConfigured, fetchQuotes, search, getClient, resolveProvider }
 * The client itself is lazy (only constructed when configured) so an absent key
 * never throws at load time. Quotes are normalized to the equities-desk Map
 * shape used by buildEquities*Rows, while also carrying the full provider-neutral
 * fields in `_zenin` for surfaces that want them.
 */

const { makeClient, readConfig, isConfigured } = require("./client");
const { resolveMarketProvider } = require("./routing");
const { normalizeQuote } = require("./normalizers");

function createMyStocksProvider() {
  let client = null;
  function getClient() {
    if (!client) {
      const cfg = readConfig();
      if (!isConfigured(cfg)) return null;
      client = makeClient({ config: cfg });
    }
    return client;
  }

  return {
    id: "mystocks",
    isConfigured: () => {
      const cfg = readConfig();
      return isConfigured(cfg) && String(cfg.enabled) !== "false";
    },
    getClient,
    resolveProvider: (req) => resolveMarketProvider(req),

    /**
     * Fetch quotes for symbols; returns Map<symbol, { summary, _zenin }>.
     * Symbols not routed to MyStocks (or unknown) are skipped.
     */
    async fetchQuotes(symbols) {
      const c = getClient();
      if (!c) throw new Error("mystocks_unconfigured");
      const eligible = symbols.filter((s) => {
        const r = resolveMarketProvider({ symbol: s, capability: "quote" });
        return r.eligible;
      });
      if (eligible.length === 0) throw new Error("mystocks_no_eligible_symbols");
      const rows = await c.getQuotes(eligible);
      const out = new Map();
      for (const row of rows) {
        const summary = {};
        if (row.changePercent != null) summary.Change = row.changePercent;
        if (row.volume != null) summary.Volume = row.volume;
        if (row.price != null) summary.Price = row.price;
        out.set(row.symbol, { summary, _zenin: row });
      }
      if (out.size === 0) throw new Error("mystocks_empty");
      return out;
    },

    /** Search African stocks/etfs/bonds/funds via MyStocks. */
    async search({ q, type = "stock", exchange, country, limit = 12 }) {
      const c = getClient();
      if (!c) throw new Error("mystocks_unconfigured");
      const cap = String(type).toLowerCase();
      let raw = [];
      if (cap === "etf" || cap === "etfs") {
        raw = await c.listEtfs({ exchange, search: q });
      } else if (cap === "bond" || cap === "bonds") {
        raw = await c.getBonds({ country, type: "bond" });
      } else if (cap === "fund" || cap === "funds") {
        raw = await c.getFunds({ country, type: "fund" });
      } else {
        raw = await c.listStocks({ exchange, search: q });
      }
      const items = Array.isArray(raw) ? raw : (raw && raw.stocks) || (raw && raw.results) || [];
      return items.slice(0, limit).map((r) => {
        const sym = (r.symbol || r.ticker || "").toUpperCase();
        const n = normalizeQuote(r, { symbol: sym, kind: cap === "etf" ? "etf" : "stock" });
        return {
          symbol: sym,
          name: r.name || (n && n.name) || null,
          type: cap === "etf" ? "etf" : cap === "bond" ? "bond" : cap === "fund" ? "fund" : "stock",
          category: cap,
          marketType: cap,
          exchange: n && n.exchange,
          country: n && n.country,
          currency: n && n.currency,
          provider: "mystocks",
          providerSymbol: sym,
          assetClass: cap === "etf" ? "etf" : "equity",
          source: "MyStocks Africa",
        };
      });
    },
  };
}

module.exports = { createMyStocksProvider, makeClient, readConfig, isConfigured, resolveMarketProvider, QUOTE_BATCH_LIMIT: 50 };
