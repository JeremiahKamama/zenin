const crypto = require("crypto");

const USD_LIKE_QUOTES = ["USD", "USDT", "USDC", "BUSD", "FDUSD", "TUSD", "USDP"];
const STABLE_ASSETS = new Set(["USD", "USDT", "USDC", "BUSD", "DAI", "FDUSD", "TUSD", "USDP", "USDE", "USDD"]);

async function resolveFetch() {
  const fetch = (await import("node-fetch")).default;
  return fetch;
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundMoney(value) {
  return Number(toNumber(value, 0).toFixed(8));
}

function toIsoString(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function toDateString(value) {
  return toIsoString(value).slice(0, 10);
}

function uniqueValues(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || "").trim()).filter(Boolean))];
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch (error) {
    console.warn("[ExchangeSync] Failed to parse JSON response:", error?.message || error);
    return null;
  }
}

// Authoritative mapping of exchange key -> the platform tag (lowercase) used in
// `user_workspace_trades`/`user_workspace_trade_fills`/`journal_events`, and the exact
// display-case strategy_name(s) used in `user_workspace_portfolio`. Both the sync path
// (portfolio.sync) and the connected-account cascade removal read from this single source
// of truth so they never drift apart.
const EXCHANGE_SYNC_TAGS = {
  hyperliquid: { platform: "hyperliquid", strategyNames: ["Hyperliquid Perp"] },
  binance: { platform: "binance", strategyNames: ["Binance Spot", "Binance Perp"] },
  bybit: { platform: "bybit", strategyNames: ["Bybit Spot", "Bybit Perp"] },
  interactive_brokers: { platform: "interactive_brokers", strategyNames: ["IBKR Portfolio"] }
};

function tagsForExchange(exchange) {
  const key = String(exchange || "").trim().toLowerCase();
  return EXCHANGE_SYNC_TAGS[key] || null;
}

async function fetchJsonOrThrow(fetch, url, options, label) {
  const response = await fetch(url, options);
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(`${label}: ${data?.msg || data?.retMsg || response.statusText}`);
  }
  return data;
}

function buildTradeAndFillRecord({
  platform,
  clientId,
  platformTradeId = null,
  platformFillId,
  executedAt,
  asset,
  name,
  type = "crypto",
  side,
  marketType,
  quantity,
  price,
  notional,
  fee = 0,
  feeCurrency = "USD",
  feeSource = "exchange_reported",
  strategyName,
  liquidityRole = null,
  referencePrice = null,
  rawPayload = {},
  executionMeta = {}
}) {
  const ts = toIsoString(executedAt);
  const normalizedSide = String(side || "").toLowerCase() === "sell" ? "sell" : "buy";
  const normalizedPlatform = String(platform || "zenin").trim().toLowerCase() || "zenin";
  const normalizedFeeCurrency = String(feeCurrency || "USD").trim().toUpperCase() || "USD";
  const normalizedFeeSource = String(feeSource || "exchange_reported").trim().toLowerCase() || "exchange_reported";
  const normalizedQuantity = Math.abs(toNumber(quantity));
  const normalizedPrice = toNumber(price);
  const normalizedNotional = Math.abs(toNumber(notional || (normalizedQuantity * normalizedPrice)));
  const normalizedFee = Math.abs(toNumber(fee));
  const normalizedMarketType = String(marketType || "spot").trim().toLowerCase() || "spot";

  return {
    trade: {
      clientId,
      date: toDateString(ts),
      executedAt: ts,
      asset,
      name: name || asset,
      type,
      side: normalizedSide,
      marketType: normalizedMarketType,
      status: "Filled",
      quantity: normalizedQuantity,
      price: normalizedPrice,
      notional: normalizedNotional,
      platform: normalizedPlatform,
      fee: normalizedFee,
      feeCurrency: normalizedFeeCurrency,
      feeSource: normalizedFeeSource,
      referencePrice: referencePrice == null ? null : toNumber(referencePrice),
      strategyName,
      executionMeta: {
        ...executionMeta,
        platform: normalizedPlatform,
        platformTradeId,
        platformFillId,
        liquidityRole
      }
    },
    tradeFill: {
      tradeClientId: clientId,
      platform: normalizedPlatform,
      platformTradeId: platformTradeId == null ? null : String(platformTradeId),
      platformFillId: String(platformFillId),
      symbol: asset,
      side: normalizedSide,
      marketType: normalizedMarketType,
      quantity: normalizedQuantity,
      price: normalizedPrice,
      notional: normalizedNotional,
      feeAmount: normalizedFee,
      feeCurrency: normalizedFeeCurrency,
      feeSource: normalizedFeeSource,
      liquidityRole,
      executedAt: ts,
      referencePrice: referencePrice == null ? null : toNumber(referencePrice),
      rawPayload
    }
  };
}

function makeBinanceSignature(secret, queryString) {
  return crypto.createHmac("sha256", secret).update(queryString).digest("hex");
}

async function fetchBinanceSigned(fetch, baseUrl, path, params, apiKey, apiSecret) {
  const queryString = new URLSearchParams(params).toString();
  const signature = makeBinanceSignature(apiSecret, queryString);
  const response = await fetch(`${baseUrl}${path}?${queryString}&signature=${signature}`, {
    headers: { "X-MBX-APIKEY": apiKey }
  });
  const data = await safeJson(response);
  if (!response.ok) {
    throw new Error(data?.msg || response.statusText);
  }
  return data;
}

function deriveBinanceSpotSymbols(balances = [], exchangeSymbols = new Set(), knownSymbols = []) {
  const symbols = new Set(uniqueValues(knownSymbols).map((symbol) => symbol.toUpperCase()));
  const nonStableAssets = (Array.isArray(balances) ? balances : [])
    .map((row) => String(row?.asset || "").trim().toUpperCase())
    .filter((asset) => asset && !STABLE_ASSETS.has(asset));

  nonStableAssets.forEach((asset) => {
    if (exchangeSymbols.has(asset)) {
      symbols.add(asset);
      return;
    }
    USD_LIKE_QUOTES.forEach((quote) => {
      const candidate = `${asset}${quote}`;
      if (exchangeSymbols.has(candidate)) {
        symbols.add(candidate);
      }
    });
  });
  return [...symbols];
}

function parseBybitExtraFees(extraFees) {
  if (Array.isArray(extraFees)) return extraFees;
  if (!extraFees) return [];
  if (typeof extraFees === "string") {
    try {
      const parsed = JSON.parse(extraFees);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn("[ExchangeSync] Failed to parse Bybit extra fees:", error?.message || error);
      return [];
    }
  }
  return [];
}

function makeBybitSignature(apiKey, apiSecret, recvWindow, timestamp, queryString) {
  return crypto.createHmac("sha256", apiSecret).update(`${timestamp}${apiKey}${recvWindow}${queryString}`).digest("hex");
}

async function fetchBybitSigned(fetch, path, params, apiKey, apiSecret, recvWindow = "10000") {
  const timestamp = Date.now().toString();
  const queryString = new URLSearchParams(params).toString();
  const signature = makeBybitSignature(apiKey, apiSecret, recvWindow, timestamp, queryString);
  const response = await fetch(`https://api.bybit.com${path}?${queryString}`, {
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-SIGN": signature,
      "X-BAPI-RECV-WINDOW": recvWindow
    }
  });
  const data = await safeJson(response);
  if (!response.ok || data?.retCode !== 0) {
    throw new Error(data?.retMsg || response.statusText);
  }
  return data;
}

async function syncHyperliquid(apiKey, extraData = {}, context = {}) {
  const fetch = await resolveFetch();
  // The stored api_key for a Hyperliquid wallet connection is a wenc:-prefixed
  // encryption wrapper, NOT the raw address. The real address lives in
  // extra_data.address. Use that; only fall back to apiKey when it actually
  // looks like an address (0x...) so we never send a wenc: wrapper to the API.
  const looksLikeAddress = (v) => typeof v === "string" && /^0x[a-fA-F0-9]{8,}$/.test(v.trim());
  const address = (extraData && looksLikeAddress(extraData.address))
    ? String(extraData.address).trim()
    : (looksLikeAddress(apiKey) ? String(apiKey).trim() : (extraData && extraData.address) || apiKey);
  if (!address || !looksLikeAddress(address)) throw new Error("Hyperliquid address is required");

  const [state, fills, meta] = await Promise.all([
    fetchJsonOrThrow(fetch, "https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "clearinghouseState", user: address })
    }, "Hyperliquid state fetch failed"),
    fetchJsonOrThrow(fetch, "https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "userFills", user: address, aggregateByTime: false })
    }, "Hyperliquid fills fetch failed"),
    fetchJsonOrThrow(fetch, "https://api.hyperliquid.xyz/info", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "metaAndAssetCtxs" })
    }, "Hyperliquid metadata fetch failed")
  ]);

  const metaMap = {};
  if (Array.isArray(meta)) {
    const universe = meta[0]?.universe || [];
    const assetCtxs = meta[1] || [];
    universe.forEach((u, i) => {
      const ctx = assetCtxs[i] || {};
      metaMap[u.name] = {
        funding: toNumber(ctx.funding),
        openInterest: toNumber(ctx.openInterest),
        markPx: toNumber(ctx.markPx)
      };
    });
  }

  const holdings = (state?.assetPositions || []).map((positionRow) => {
    const pos = positionRow.position || {};
    const metaEntry = metaMap[pos.coin] || {};
    return {
      symbol: pos.coin,
      name: pos.coin,
      // clearinghouseState positions carry no live mark price; pull it from
      // the metaAndAssetCtxs feed so Portfolio shows current market value.
      price: metaEntry.markPx || toNumber(pos.markPx) || toNumber(pos.entryPx),
      quantity: toNumber(pos.szi),
      entry_price: toNumber(pos.entryPx),
      // Derivative semantics for the canonical layer (spec §1.4 — never dropped):
      unrealizedPnl: toNumber(pos.unrealizedPnl),
      collateral: toNumber(pos.marginUsed),
      leverage: pos.leverage != null && pos.leverage.value != null ? toNumber(pos.leverage.value) : null,
      liquidation_price: toNumber(pos.liquidationPx),
      type: "crypto",
      market_type: "perp",
      order_type: toNumber(pos.szi) > 0 ? "buy" : "sell",
      strategyName: "Hyperliquid Perp",
      date_added: new Date().toISOString(),
      fundingRate: metaEntry.funding,
      openInterest: metaEntry.openInterest
    };
  });

  const trades = [];
  const tradeFills = [];
  (Array.isArray(fills) ? fills : []).forEach((fill) => {
    const record = buildTradeAndFillRecord({
      platform: "hyperliquid",
      clientId: `hl-${fill.oid}-${fill.tid}`,
      platformTradeId: fill.oid,
      platformFillId: fill.tid,
      executedAt: fill.time,
      asset: String(fill.coin || "").trim().toUpperCase(),
      name: String(fill.coin || "").trim().toUpperCase(),
      type: "crypto",
      side: fill.side === "B" ? "buy" : "sell",
      marketType: "perp",
      quantity: Math.abs(toNumber(fill.sz)),
      price: toNumber(fill.px),
      notional: Math.abs(toNumber(fill.sz) * toNumber(fill.px)),
      fee: Math.abs(toNumber(fill.fee)),
      feeCurrency: "USDC",
      feeSource: "exchange_reported",
      strategyName: "Hyperliquid Perp",
      liquidityRole: fill.crossed === false ? "maker" : fill.crossed === true ? "taker" : null,
      rawPayload: fill,
      executionMeta: {
        direction: fill.dir || null,
        closedPnl: toNumber(fill.closedPnl),
        startPosition: toNumber(fill.startPosition),
        transactionHash: fill.hash || null
      }
    });
    trades.push(record.trade);
    tradeFills.push(record.tradeFill);
  });

  const cashBalance = toNumber(state?.marginSummary?.accountValue);
  console.log(`[Hyperliquid] Found ${holdings.length} positions, ${trades.length} fills.`);
  return { holdings, trades, tradeFills, cashBalance, currency: "USDC", syncContext: context };
}

// Lighter (zklighter.elliot.ai) — keyless, read-only, queried by L1 wallet
// address. Positions come from the /account endpoint; trades are best-effort
// (the /trades endpoint needs an account_index, which we derive from the
// account response when present). Never attempts auth or writes.
async function syncLighter(apiKey, extraData = {}, context = {}) {
  const fetch = await resolveFetch();
  const looksLikeAddress = (v) => typeof v === "string" && /^0x[a-fA-F0-9]{8,}$/.test(v.trim());
  const address = (extraData && looksLikeAddress(extraData.address))
    ? String(extraData.address).trim()
    : (looksLikeAddress(apiKey) ? String(apiKey).trim() : (extraData && extraData.address) || apiKey);
  if (!address || !looksLikeAddress(address)) throw new Error("Lighter L1 address is required");

  const account = await fetchJsonOrThrow(
    fetch,
    `https://mainnet.zklighter.elliot.ai/api/v1/account?by=l1_address&value=${encodeURIComponent(address)}&active_only=false`,
    undefined,
    "Lighter account fetch failed"
  );

  const positions = Array.isArray(account) ? account : (account?.positions || []);
  const holdings = positions
    .filter((p) => p && Math.abs(toNumber(p.position)) > 0)
    .map((p) => {
      const symbol = String(p.market_id ?? p.market ?? p.symbol ?? "").trim();
      const sign = toNumber(p.sign) >= 0 ? 1 : -1;
      const size = toNumber(p.position) * sign;
      const entry = toNumber(p.avg_entry_price ?? p.avgEntryPrice);
      const positionValue = toNumber(p.position_value ?? p.positionValue);
      const mark = positionValue && size !== 0 ? Math.abs(positionValue / size) : (entry || toNumber(p.mark_price ?? p.markPrice));
      return {
        symbol,
        name: symbol,
        price: mark,
        quantity: size,
        entry_price: entry,
        type: "crypto",
        market_type: "perp",
        order_type: size > 0 ? "buy" : "sell",
        unrealized_pnl: toNumber(p.unrealized_pnl ?? p.unrealizedPnl),
        collateral: toNumber(p.collateral),
        leverage: p.leverage != null ? toNumber(p.leverage) : null,
        liquidation_price: toNumber(p.liquidation_price ?? p.liquidationPrice),
        strategyName: "Lighter Perp",
        date_added: new Date().toISOString()
      };
    });

  // Best-effort trade history: the /trades endpoint is keyed by account_index.
  const trades = [];
  const tradeFills = [];
  const accountIndex = account?.account_index ?? account?.accountIndex
    ?? (Array.isArray(account) ? account[0]?.account_index : undefined);
  if (accountIndex != null) {
    try {
      const fills = await fetchJsonOrThrow(
        fetch,
        `https://mainnet.zklighter.elliot.ai/api/v1/trades?account_index=${encodeURIComponent(accountIndex)}&limit=100&sort_by=timestamp&sort_dir=desc`,
        undefined,
        "Lighter trades fetch failed"
      ).catch(() => null);
      const tradeRows = Array.isArray(fills) ? fills : (fills?.trades || []);
      tradeRows.forEach((f, idx) => {
        const asset = String(f.market_id ?? f.symbol ?? "").trim().toUpperCase();
        const record = buildTradeAndFillRecord({
          platform: "lighter",
          clientId: `lt-${f.trade_id ?? f.id ?? idx}`,
          platformTradeId: f.trade_id ?? f.id,
          platformFillId: f.trade_id ?? f.id,
          executedAt: f.timestamp ?? f.time,
          asset,
          name: asset,
          type: "crypto",
          side: f.side === "sell" ? "sell" : "buy",
          marketType: "perp",
          quantity: Math.abs(toNumber(f.amount ?? f.size ?? f.quantity)),
          price: toNumber(f.price),
          notional: Math.abs(toNumber(f.amount ?? f.size ?? f.quantity) * toNumber(f.price)),
          fee: Math.abs(toNumber(f.fee ?? 0)),
          feeCurrency: "USDC",
          feeSource: "exchange_reported",
          strategyName: "Lighter Perp",
          rawPayload: f,
          executionMeta: { side: f.side, role: f.role }
        });
        trades.push(record.trade);
        tradeFills.push(record.tradeFill);
      });
    } catch (err) {
      console.warn("[Lighter] trades sync skipped:", err?.message || err);
    }
  }

  // Account-level collateral → treated as the free cash bucket for the unified
  // read model. Positions already carry their own market value.
  const cashBalance = toNumber(account?.total_collateral ?? account?.collateral ?? 0);
  console.log(`[Lighter] Found ${holdings.length} positions, ${trades.length} fills.`);
  return { holdings, trades, tradeFills, cashBalance, currency: "USDC", syncContext: context };
}

async function syncBinance(apiKey, apiSecret, context = {}) {
  const fetch = await resolveFetch();
  if (!apiKey || !apiSecret) throw new Error("Binance API Key and Secret are required");

  let serverTimeOffset = 0;
  try {
    const timeData = await fetchJsonOrThrow(fetch, "https://api.binance.com/api/v3/time", undefined, "Binance time fetch failed");
    serverTimeOffset = toNumber(timeData?.serverTime) - Date.now();
  } catch (error) {
    console.warn("[Binance] Failed to fetch server time, using local clock.", error.message);
  }

  const signedParams = (extra = {}) => ({
    ...extra,
    recvWindow: 10000,
    timestamp: Date.now() + serverTimeOffset
  });

  const [spotAccount, exchangeInfo] = await Promise.all([
    fetchBinanceSigned(fetch, "https://api.binance.com", "/api/v3/account", signedParams(), apiKey, apiSecret),
    fetchJsonOrThrow(fetch, "https://api.binance.com/api/v3/exchangeInfo", undefined, "Binance exchange info fetch failed")
  ]);

  let futAccount = null;
  try {
    futAccount = await fetchBinanceSigned(fetch, "https://fapi.binance.com", "/fapi/v2/account", signedParams(), apiKey, apiSecret);
  } catch (error) {
    console.warn("[Binance] Futures account fetch failed, continuing with spot data only.", error.message);
  }

  const exchangeSymbols = new Set((exchangeInfo?.symbols || []).map((row) => String(row?.symbol || "").trim().toUpperCase()).filter(Boolean));

  const spotHoldings = (spotAccount?.balances || [])
    .filter((row) => toNumber(row.free) + toNumber(row.locked) > 0)
    .map((row) => ({
      symbol: row.asset,
      name: row.asset,
      price: 0,
      quantity: toNumber(row.free) + toNumber(row.locked),
      type: "crypto",
      market_type: "spot",
      order_type: "buy",
      strategyName: "Binance Spot",
      date_added: new Date().toISOString()
    }));

  let futHoldings = [];
  if (futAccount) {
    const futTickers = await fetchJsonOrThrow(fetch, "https://fapi.binance.com/fapi/v1/premiumIndex", undefined, "Binance futures ticker fetch failed");
    const tickerMap = {};
    if (Array.isArray(futTickers)) {
      futTickers.forEach((ticker) => {
        tickerMap[ticker.symbol] = { funding: toNumber(ticker.lastFundingRate) };
      });
    }
    futHoldings = await Promise.all((futAccount?.positions || [])
      .filter((position) => Math.abs(toNumber(position.positionAmt)) > 0)
      .map(async (position) => {
        let openInterest = null;
        try {
          const oiData = await fetchJsonOrThrow(fetch, `https://fapi.binance.com/fapi/v1/openInterest?symbol=${position.symbol}`, undefined, `Binance OI fetch failed for ${position.symbol}`);
          openInterest = toNumber(oiData?.openInterest);
        } catch (error) {
          console.warn(`[Binance] Open interest fetch failed for ${position.symbol}:`, error?.message || error);
          openInterest = null;
        }
        return {
          symbol: position.symbol,
          name: position.symbol,
          price: toNumber(position.markPrice),
          quantity: toNumber(position.positionAmt),
          entry_price: toNumber(position.entryPrice),
          // Derivative semantics for the canonical layer (spec §1.4 — never dropped):
          unrealizedPnl: toNumber(position.unRealizedProfit),
          collateral: toNumber(position.initialMargin),
          leverage: position.leverage != null ? toNumber(position.leverage) : null,
          liquidation_price: toNumber(position.liquidationPrice),
          type: "crypto",
          market_type: "perp",
          order_type: toNumber(position.positionAmt) > 0 ? "buy" : "sell",
          strategyName: "Binance Perp",
          date_added: new Date().toISOString(),
          fundingRate: tickerMap[position.symbol]?.funding || 0,
          openInterest
        };
      }));
  }

  const knownSpotSymbols = uniqueValues(context?.knownSymbols?.spot || []);
  const knownPerpSymbols = uniqueValues(context?.knownSymbols?.perp || []);
  const spotSymbols = deriveBinanceSpotSymbols(spotAccount?.balances, exchangeSymbols, knownSpotSymbols);
  const perpSymbols = uniqueValues([
    ...knownPerpSymbols,
    ...((futAccount?.positions || []).map((position) => position?.symbol))
  ]).map((symbol) => symbol.toUpperCase());

  const fetchSpotTrades = async (symbol) => {
    try {
      const rows = await fetchBinanceSigned(fetch, "https://api.binance.com", "/api/v3/myTrades", signedParams({ symbol, limit: 1000 }), apiKey, apiSecret);
      return Array.isArray(rows) ? rows.map((row) => ({ ...row, symbol })) : [];
    } catch (error) {
      console.warn(`[Binance] Spot trade sync skipped for ${symbol}.`, error.message);
      return [];
    }
  };

  const fetchPerpTrades = async (symbol) => {
    try {
      const rows = await fetchBinanceSigned(fetch, "https://fapi.binance.com", "/fapi/v1/userTrades", signedParams({ symbol, limit: 1000 }), apiKey, apiSecret);
      return Array.isArray(rows) ? rows.map((row) => ({ ...row, symbol })) : [];
    } catch (error) {
      console.warn(`[Binance] Perp trade sync skipped for ${symbol}.`, error.message);
      return [];
    }
  };

  const [spotTradeGroups, perpTradeGroups] = await Promise.all([
    Promise.all(spotSymbols.map(fetchSpotTrades)),
    Promise.all(perpSymbols.map(fetchPerpTrades))
  ]);

  const trades = [];
  const tradeFills = [];

  spotTradeGroups.flat().forEach((fill) => {
    const symbol = String(fill.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    const record = buildTradeAndFillRecord({
      platform: "binance",
      clientId: `binance-spot-${symbol}-${fill.orderId}-${fill.id}`,
      platformTradeId: fill.orderId,
      platformFillId: `spot-${fill.id}`,
      executedAt: fill.time,
      asset: symbol,
      name: symbol,
      type: "crypto",
      side: fill.isBuyer === true || fill.buyer === true ? "buy" : "sell",
      marketType: "spot",
      quantity: toNumber(fill.qty),
      price: toNumber(fill.price),
      notional: toNumber(fill.quoteQty) || (toNumber(fill.qty) * toNumber(fill.price)),
      fee: toNumber(fill.commission),
      feeCurrency: fill.commissionAsset || "USD",
      feeSource: "exchange_reported",
      strategyName: "Binance Spot",
      liquidityRole: fill.isMaker === true ? "maker" : fill.isMaker === false ? "taker" : null,
      rawPayload: fill,
      executionMeta: {
        orderId: fill.orderId,
        tradeId: fill.id,
        buyer: fill.isBuyer ?? fill.buyer ?? null
      }
    });
    trades.push(record.trade);
    tradeFills.push(record.tradeFill);
  });

  perpTradeGroups.flat().forEach((fill) => {
    const symbol = String(fill.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    const record = buildTradeAndFillRecord({
      platform: "binance",
      clientId: `binance-perp-${symbol}-${fill.orderId}-${fill.id}`,
      platformTradeId: fill.orderId,
      platformFillId: `perp-${fill.id}`,
      executedAt: fill.time,
      asset: symbol,
      name: symbol,
      type: "crypto",
      side: String(fill.side || "").toLowerCase() === "sell" ? "sell" : "buy",
      marketType: "perp",
      quantity: toNumber(fill.qty),
      price: toNumber(fill.price),
      notional: toNumber(fill.quoteQty) || (toNumber(fill.qty) * toNumber(fill.price)),
      fee: toNumber(fill.commission),
      feeCurrency: fill.commissionAsset || fill.marginAsset || "USDT",
      feeSource: "exchange_reported",
      strategyName: "Binance Perp",
      liquidityRole: fill.maker === true ? "maker" : fill.maker === false ? "taker" : null,
      referencePrice: toNumber(fill.price) > 0 ? toNumber(fill.price) : null,
      rawPayload: fill,
      executionMeta: {
        orderId: fill.orderId,
        tradeId: fill.id,
        realizedPnl: toNumber(fill.realizedPnl),
        positionSide: fill.positionSide || null
      }
    });
    trades.push(record.trade);
    tradeFills.push(record.tradeFill);
  });

  const stableSpotBalance = (spotAccount?.balances || []).reduce((sum, row) => {
    const asset = String(row?.asset || "").trim().toUpperCase();
    if (!STABLE_ASSETS.has(asset)) return sum;
    return sum + toNumber(row.free) + toNumber(row.locked);
  }, 0);

  const cashBalance = toNumber(futAccount?.totalMarginBalance, stableSpotBalance);
  console.log(`[Binance] Found ${spotHoldings.length} spot balances, ${futHoldings.length} perp positions, ${trades.length} fills.`);
  return { holdings: [...spotHoldings, ...futHoldings], trades, tradeFills, cashBalance, currency: "USDT", syncContext: context };
}

async function verifyBinanceCredentialScope(apiKey, apiSecret) {
  const fetch = await resolveFetch();
  if (!apiKey || !apiSecret) throw new Error("Binance API Key and Secret are required");

  let serverTimeOffset = 0;
  try {
    const timeData = await fetchJsonOrThrow(fetch, "https://api.binance.com/api/v3/time", undefined, "Binance time fetch failed");
    serverTimeOffset = toNumber(timeData?.serverTime) - Date.now();
  } catch (error) {
    console.warn("[Binance] Failed to fetch server time for scope verification, using local clock.", error.message);
  }

  const account = await fetchBinanceSigned(fetch, "https://api.binance.com", "/api/v3/account", {
    recvWindow: 10000,
    timestamp: Date.now() + serverTimeOffset
  }, apiKey, apiSecret);

  const canTrade = account?.canTrade === true;
  const canWithdraw = account?.canWithdraw === true;
  const permissionScope = canTrade || canWithdraw ? "trade" : "read_only";

  let canReadOrders = false;
  try {
    await fetchBinanceSigned(fetch, "https://api.binance.com", "/api/v3/openOrders", {
      recvWindow: 10000,
      timestamp: Date.now() + serverTimeOffset
    }, apiKey, apiSecret);
    canReadOrders = true;
  } catch (orderError) {
    const msg = String(orderError?.message || "").toLowerCase();
    canReadOrders = !msg.includes("permission") && !msg.includes("forbidden") && !msg.includes("unauthorized");
  }

  return {
    permissionScope,
    canTrade,
    canWithdraw,
    readOnlyVerified: permissionScope === "read_only",
    providerMeta: {
      canTrade,
      canWithdraw,
      canDeposit: account?.canDeposit === true,
      permissions: Array.isArray(account?.permissions) ? account.permissions : [],
      permissionsDetected: {
        canReadBalances: true,
        canReadTrades: true,
        canReadOrders,
        canTrade,
        canWithdraw,
        isWatchOnly: false
      }
    }
  };
}

async function verifyBybitCredentialScope(apiKey, apiSecret) {
  const fetch = await resolveFetch();
  if (!apiKey || !apiSecret) throw new Error("Bybit API Key and Secret are required");

  const data = await fetchBybitSigned(fetch, "/v5/user/query-api", {}, apiKey, apiSecret);
  const result = data?.result || {};
  const readOnly = Number(result.readOnly) === 1;

  let canReadOrders = false;
  try {
    await fetchBybitSigned(fetch, "/v5/order/history", { category: "spot", symbol: "BTCUSDT", limit: 1 }, apiKey, apiSecret);
    canReadOrders = true;
  } catch (orderError) {
    const msg = String(orderError?.message || "").toLowerCase();
    canReadOrders = !msg.includes("permission") && !msg.includes("forbidden") && !msg.includes("unauthorized") && !msg.includes("ret_code");
  }

  return {
    permissionScope: readOnly ? "read_only" : "trade",
    canTrade: !readOnly,
    canWithdraw: !readOnly,
    readOnlyVerified: readOnly,
    providerMeta: {
      readOnly: result.readOnly,
      permissions: result.permissions || {},
      permissionsDetected: {
        canReadBalances: true,
        canReadTrades: true,
        canReadOrders,
        canTrade: !readOnly,
        canWithdraw: !readOnly,
        isWatchOnly: readOnly
      }
    }
  };
}

function verifyCoinbaseAdvancedCredentialScope(apiKey, apiSecret) {
  if (!apiKey || !apiSecret) throw new Error("Coinbase Advanced API key and secret are required");
  // Stub: Coinbase Advanced Trade uses JWT-signed requests; real scope probing
  // requires a full JWT implementation. We treat the presence of both credentials
  // as read-only credentials and flag them for server-side verification once
  // the OAuth/JWT flow is wired.
  return {
    permissionScope: "read_only",
    canTrade: false,
    canWithdraw: false,
    readOnlyVerified: true,
    verificationStatus: "verified_read_only",
    verificationMessage: "Coinbase Advanced credentials accepted as read-only (stub verification). Trading scope will be enforced when the full JWT flow is enabled.",
    providerMeta: {
      permissionsDetected: {
        canReadBalances: true,
        canReadTrades: true,
        canReadOrders: true,
        canTrade: false,
        canWithdraw: false,
        isWatchOnly: true
      }
    }
  };
}

async function verifyExchangeCredentialScope(exchange, apiKey, apiSecret) {
  const normalizedExchange = String(exchange || "").trim().toLowerCase();
  if (normalizedExchange === "hyperliquid" && apiKey && !apiSecret) {
    return {
      permissionScope: "read_only",
      canTrade: false,
      canWithdraw: false,
      readOnlyVerified: true,
      verificationStatus: "verified_watch_only",
      verificationMessage: "Public address connection verified as watch-only.",
      providerMeta: {
        addressType: "public_wallet",
        permissionsDetected: {
          canReadBalances: true,
          canReadTrades: true,
          canReadOrders: true,
          canTrade: false,
          canWithdraw: false,
          isWatchOnly: true
        }
      }
    };
  }
  if (normalizedExchange === "lighter" && apiKey && !apiSecret) {
    return {
      permissionScope: "read_only",
      canTrade: false,
      canWithdraw: false,
      readOnlyVerified: true,
      verificationStatus: "verified_watch_only",
      verificationMessage: "Public address connection verified as watch-only.",
      providerMeta: {
        addressType: "public_wallet",
        permissionsDetected: {
          canReadBalances: true,
          canReadTrades: true,
          canReadOrders: true,
          canTrade: false,
          canWithdraw: false,
          isWatchOnly: true
        }
      }
    };
  }
  if (normalizedExchange === "binance") {
    const result = await verifyBinanceCredentialScope(apiKey, apiSecret);
    return {
      ...result,
      verificationStatus: result.readOnlyVerified ? "verified_read_only" : "rejected_trading_enabled",
      verificationMessage: result.readOnlyVerified
        ? "Binance confirmed this API key has no trading or withdrawal permission."
        : "Binance reports trading or withdrawal permission on this API key."
    };
  }
  if (normalizedExchange === "bybit") {
    const result = await verifyBybitCredentialScope(apiKey, apiSecret);
    return {
      ...result,
      verificationStatus: result.readOnlyVerified ? "verified_read_only" : "rejected_trading_enabled",
      verificationMessage: result.readOnlyVerified
        ? "Bybit confirmed this API key is read-only."
        : "Bybit reports this API key is read-write."
    };
  }
  if (normalizedExchange === "coinbase_advanced") {
    return verifyCoinbaseAdvancedCredentialScope(apiKey, apiSecret);
  }
  return {
    permissionScope: "read_only",
    canTrade: false,
    canWithdraw: false,
    readOnlyVerified: false,
    verificationStatus: "provider_unverified",
    verificationMessage: "Zenin requires read-only credentials, but this provider scope has not been verified server-side.",
    providerMeta: {
      permissionsDetected: {
        canReadBalances: false,
        canReadTrades: false,
        canReadOrders: false,
        canTrade: false,
        canWithdraw: false,
        isWatchOnly: false
      }
    }
  };
}

async function syncBybit(apiKey, apiSecret, context = {}) {
  const fetch = await resolveFetch();
  if (!apiKey || !apiSecret) throw new Error("Bybit API Key and Secret are required");

  const [positionsData, tickerData, linearExecutions, spotExecutions] = await Promise.all([
    fetchBybitSigned(fetch, "/v5/position/list", { category: "linear", settleCoin: "USDT" }, apiKey, apiSecret),
    fetchJsonOrThrow(fetch, "https://api.bybit.com/v5/market/tickers?category=linear", undefined, "Bybit ticker fetch failed"),
    fetchBybitSigned(fetch, "/v5/execution/list", { category: "linear", limit: 100 }, apiKey, apiSecret).catch((error) => {
      console.warn("[Bybit] Linear execution sync failed.", error.message);
      return { result: { list: [] } };
    }),
    fetchBybitSigned(fetch, "/v5/execution/list", { category: "spot", limit: 100 }, apiKey, apiSecret).catch((error) => {
      console.warn("[Bybit] Spot execution sync failed.", error.message);
      return { result: { list: [] } };
    })
  ]);

  const tickerMap = {};
  if (tickerData?.result?.list) {
    tickerData.result.list.forEach((ticker) => {
      tickerMap[ticker.symbol] = {
        funding: toNumber(ticker.fundingRate),
        openInterest: toNumber(ticker.openInterest)
      };
    });
  }

  const holdings = (positionsData?.result?.list || [])
    .filter((position) => Math.abs(toNumber(position.size)) > 0)
    .map((position) => ({
      symbol: position.symbol,
      name: position.symbol,
      price: toNumber(position.markPrice),
      quantity: toNumber(position.size) * (position.side === "Buy" ? 1 : -1),
      entry_price: toNumber(position.avgPrice),
      type: "crypto",
      market_type: "perp",
      order_type: String(position.side || "Buy").toLowerCase(),
      strategyName: "Bybit Perp",
      date_added: new Date().toISOString(),
      fundingRate: tickerMap[position.symbol]?.funding || 0,
      openInterest: tickerMap[position.symbol]?.openInterest || 0
    }));

  const trades = [];
  const tradeFills = [];
  [...(linearExecutions?.result?.list || []), ...(spotExecutions?.result?.list || [])].forEach((fill) => {
    const symbol = String(fill.symbol || "").trim().toUpperCase();
    if (!symbol) return;
    const extraFees = parseBybitExtraFees(fill.extraFees);
    const extraFeeTotal = extraFees.reduce((sum, feeRow) => sum + Math.abs(toNumber(feeRow?.fee)), 0);
    const extraFeeCurrency = extraFees[0]?.feeCoin || null;
    const feeAmount = Math.abs(toNumber(fill.execFee)) + extraFeeTotal;
    const record = buildTradeAndFillRecord({
      platform: "bybit",
      clientId: `bybit-${String(fill.category || "trade").toLowerCase()}-${fill.orderId}-${fill.execId}`,
      platformTradeId: fill.orderId,
      platformFillId: fill.execId,
      executedAt: fill.execTime,
      asset: symbol,
      name: symbol,
      type: "crypto",
      side: String(fill.side || "").toLowerCase() === "sell" ? "sell" : "buy",
      marketType: String(fill.category || "spot").toLowerCase(),
      quantity: toNumber(fill.execQty),
      price: toNumber(fill.execPrice),
      notional: toNumber(fill.execValue) || (toNumber(fill.execQty) * toNumber(fill.execPrice)),
      fee: feeAmount,
      feeCurrency: fill.feeCurrency || extraFeeCurrency || "USDT",
      feeSource: "exchange_reported",
      strategyName: String(fill.category || "").toLowerCase() === "spot" ? "Bybit Spot" : "Bybit Perp",
      liquidityRole: fill.isMaker === true ? "maker" : fill.isMaker === false ? "taker" : null,
      referencePrice: toNumber(fill.markPrice) || null,
      rawPayload: fill,
      executionMeta: {
        orderType: fill.orderType || null,
        feeRate: toNumber(fill.feeRate),
        execType: fill.execType || null,
        closedSize: toNumber(fill.closedSize),
        markPrice: toNumber(fill.markPrice),
        extraFees
      }
    });
    trades.push(record.trade);
    tradeFills.push(record.tradeFill);
  });

  console.log(`[Bybit] Found ${holdings.length} positions and ${trades.length} fills.`);
  return { holdings, trades, tradeFills, cashBalance: 0, currency: "USDT", syncContext: context };
}

// ---------------------------------------------------------------------------
// Interactive Brokers — Client Portal Web API
// ---------------------------------------------------------------------------
// Supports both (a) the local CP Gateway (default https://localhost:5000/v1/api)
// and (b) the cloud-hosted IBKR Web API (https://api.ibkr.com/v1/api). Set
// extraData.gatewayUrl to choose; defaults to localhost gateway.
//
// The CP Gateway requires the user to authenticate via browser BEFORE sync.
// The cloud API uses OAuth 1.0a/2.0 (extraData should contain the access token).
// extraData: { gatewayUrl?: string, accountId?: string, accessToken?: string }
//
// Web API reference: https://ibkrcampus.com/campus/ibkr-api-page/webapi-doc/

const IBKR_DEFAULT_GATEWAY = "https://localhost:5000";

// IBKR enforces a per-endpoint limit of 1 req / 5 secs for /portfolio/accounts
// and /iserver/account/pnl/partitioned. Use a simple token-bucket delay.
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchIbkrGateway(url, endpoint, { method = "GET", body, timeout = 15000, accessToken } = {}) {
  const fetch = await resolveFetch();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  const headers = { "Content-Type": "application/json" };
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;
  try {
    const resp = await fetch(`${url}${endpoint}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      // Gateway uses self-signed certs in local mode.
      ...(url.startsWith("https://localhost") ? {} : {})
    });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    if (err.cause?.code === "ECONNREFUSED" || err.cause?.code === "ECONNRESET" || err.cause?.code === "DEPTH_ZERO_SELF_SIGNED_CERT") {
      throw new Error("IBKR Gateway not reachable. Ensure the Client Portal Gateway is running and authenticated via browser.");
    }
    throw new Error(`IBKR API request failed: ${err.message}`);
  }
}

async function syncIbkr(apiKey, apiSecret, context = {}) {
  const extraData = typeof context === "object" && context.extraData ? context.extraData : {};
  const gatewayUrl = (String(extraData.gatewayUrl || IBKR_DEFAULT_GATEWAY).replace(/\/$/, "")) + "/v1/api";
  const targetAccount = extraData.accountId || null;
  const accessToken = extraData.accessToken || null;

  // 1. Validate session — must be authenticated before any data calls.
  let status;
  try {
    const authResp = await fetchIbkrGateway(gatewayUrl, "/iserver/auth/status", { accessToken });
    status = await authResp.json();
  } catch (err) {
    throw new Error("IBKR authentication check failed. Ensure the gateway is running and you've authenticated via browser (or provided a valid access token).");
  }
  const authenticated = status.authenticated === true || status.established === true;
  const connected = status.connected === true;
  if (!authenticated) {
    const competing = status.competing === true ? " (another session is active)" : "";
    throw new Error(`IBKR session not authenticated${competing}. Authenticate via the Client Portal browser window or provide a valid access token.`);
  }
  if (!connected) {
    throw new Error("IBKR session not connected to brokerage infrastructure. Wait for session initialisation and re-sync.");
  }

  // 2. List accounts (GET, per Web API docs). 1 req / 5 secs limit.
  await delay(200); // gentle pacing
  const acctsResp = await fetchIbkrGateway(gatewayUrl, "/portfolio/accounts", { accessToken });
  if (!acctsResp.ok) {
    const text = await acctsResp.text().catch(() => "");
    throw new Error(`IBKR accounts endpoint returned ${acctsResp.status}: ${text.slice(0, 200)}`);
  }
  const accounts = await acctsResp.json();
  const accountList = Array.isArray(accounts) ? accounts : [];
  if (accountList.length === 0) throw new Error("No accounts found on IBKR. Ensure your username has trading permissions for at least one account.");

  const accountId = targetAccount || String(accountList[0]?.accountId || accountList[0]?.id || "");
  if (!accountId) throw new Error("Could not determine IBKR account ID. Provide one in extraData.accountId.");

  // 3. Fetch positions (paginated, 0-indexed). Max ~10 pages.
  const positions = [];
  for (let page = 0; page < 10; page++) {
    await delay(200);
    const posResp = await fetchIbkrGateway(gatewayUrl, `/portfolio/${accountId}/positions/${page}`, { accessToken });
    if (posResp.status === 404) break; // no more pages
    if (!posResp.ok) {
      console.warn(`[IBKR] Position page ${page} returned ${posResp.status}, skipping.`);
      break;
    }
    const posData = await posResp.json();
    const pagePositions = Array.isArray(posData) ? posData : [];
    if (pagePositions.length === 0) break;
    positions.push(...pagePositions);
    if (pagePositions.length < 30) break;
  }

  // 4. Fetch account summary (cash, equity, margin)
  let cashBalance = 0;
  let currency = "USD";
  try {
    await delay(200);
    const summaryResp = await fetchIbkrGateway(gatewayUrl, `/portfolio/${accountId}/summary`, { accessToken, timeout: 10000 });
    if (summaryResp.ok) {
      const summary = await summaryResp.json();
      // summary has top-level keys per currency segment (e.g. "USD", "BASE")
      const segments = Array.isArray(summary) ? summary : (summary && typeof summary === "object" ? Object.values(summary) : []);
      segments.forEach((seg) => {
        if (seg && seg.currency) {
          const totalCash = Number(seg.totalcashvalue || seg.cashbalance || 0);
          if (totalCash > 0 && String(seg.currency).toUpperCase() === "USD") {
            cashBalance += totalCash;
          }
          if (seg.currency && !currency) currency = String(seg.currency);
        }
      });
    }
  } catch (_) { /* summary is best-effort */ }

  // Fallback: try ledger for currency balances.
  if (cashBalance === 0) {
    try {
      await delay(200);
      const ledgerResp = await fetchIbkrGateway(gatewayUrl, `/portfolio/${accountId}/ledger`, { accessToken, timeout: 10000 });
      if (ledgerResp.ok) {
        const ledger = await ledgerResp.json();
        if (ledger && typeof ledger === "object") {
          Object.values(ledger).forEach((entry) => {
            if (entry && typeof entry.commoditymarketvalue === "number") {
              cashBalance += entry.commoditymarketvalue;
            }
          });
        }
      }
    } catch (_) { /* ledger is best-effort */ }
  }

  // 5. Map positions to unified shape. IBKR position fields per Web API reference:
  //   conid, ticker, contractDesc, position, mktPrice, avgCost, assetClass
  const holdings = positions.map((p) => {
    const qty = Number(p.position || 0);
    const price = Number(p.mktPrice || p.markPrice || 0);
    const assetClass = String(p.assetClass || "").toUpperCase();
    return {
      symbol: String(p.ticker || p.contractDesc || "").trim().toUpperCase(),
      name: String(p.name || p.companyName || p.contractDesc || String(p.ticker || "")),
      price,
      quantity: qty,
      entry_price: Number(p.avgCost || p.costBasis || 0),
      market_value: Math.abs(qty * price),
      type: assetClass === "CASH" ? "fiat" : (assetClass === "OPT" || assetClass === "FOP" ? "option" : "stock"),
      market_type: assetClass === "CASH" ? "cash" : (assetClass === "OPT" || assetClass === "FOP" ? "option" : "spot"),
      strategyName: "IBKR Portfolio"
    };
  }).filter((h) => Math.abs(h.quantity) > 0);

  // 6. Fetch recent executions (trades)
  const tradeModels = [];
  try {
    await delay(200);
    const tradesResp = await fetchIbkrGateway(gatewayUrl, "/iserver/account/trades", { accessToken, timeout: 10000 });
    if (tradesResp.ok) {
      const trades = await tradesResp.json();
      const tradeList = Array.isArray(trades) ? trades : [];
      tradeList.forEach((t) => {
        tradeModels.push({
          symbol: String(t.ticker || t.contractDesc || "").toUpperCase(),
          side: String(t.side || "").toUpperCase(),
          quantity: Math.abs(Number(t.size || t.quantity || 0)),
          unit_price: Number(t.price || 0),
          notional: Math.abs(Number(t.size || t.quantity || 0)) * Number(t.price || 0),
          currency: String(t.currency || "USD"),
          fee: Number(t.commission || t.fees || 0),
          fee_currency: String(t.currency || "USD"),
          order_type: String(t.orderType || t.type || "").toLowerCase(),
          executed_at: t.executionTime || t.tradeTime || t.reportDate || new Date().toISOString(),
          platform_trade_id: String(t.executionId || t.orderId || t.tradeId || ""),
          closedPnl: Number(t.fifoPnlRealized || t.realizedPnl || 0) || null
        });
      });
    }
  } catch (_) { /* trades are best-effort */ }

  console.log(`[IBKR] Found ${holdings.length} positions, ${tradeModels.length} executions.`);
  return {
    holdings,
    trades: tradeModels.map((t) => ({
      symbol: t.symbol,
      side: t.side,
      quantity: t.quantity,
      price: t.unit_price,
      notional: t.notional,
      fee: t.fee,
      feeCurrency: t.fee_currency,
      executedAt: t.executed_at,
      platformTradeId: t.platform_trade_id,
      platform: "ibkr",
      marketType: "spot"
    })),
    tradeFills: [],
    cashBalance,
    currency,
    syncContext: context
  };
}

module.exports = {
  syncHyperliquid,
  syncLighter,
  syncBinance,
  syncBybit,
  syncIbkr,
  verifyExchangeCredentialScope,
  EXCHANGE_SYNC_TAGS,
  tagsForExchange,
  _internals: {
    toNumber,
    roundMoney,
    toIsoString,
    toDateString,
    uniqueValues,
    buildTradeAndFillRecord,
    deriveBinanceSpotSymbols,
    parseBybitExtraFees,
  },
};
