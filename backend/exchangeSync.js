const crypto = require("crypto");

async function resolveFetch() {
  const fetch = (await import("node-fetch")).default;
  return fetch;
}

/**
 * Sync logic for Hyperliquid
 */
async function syncHyperliquid(apiKey, extraData = {}) {
  const fetch = await resolveFetch();
  const address = apiKey || extraData.address;
  if (!address) throw new Error("Hyperliquid address is required");

  // 1. Fetch Clearinghouse State (Positions & Balances)
  const stateResponse = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "clearinghouseState", user: address })
  });
  const state = await stateResponse.json();

  // 2. Fetch User Fills (Recent Trades)
  const fillsResponse = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "userFills", user: address })
  });
  const fills = await fillsResponse.json();

  // 3. Fetch Metadata (Funding Rates & OI)
  const metaResponse = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" })
  });
  const meta = await metaResponse.json();
  const metaMap = {};
  if (Array.isArray(meta)) {
    const universe = meta[0].universe || [];
    const assetCtxs = meta[1] || [];
    universe.forEach((u, i) => {
      const ctx = assetCtxs[i] || {};
      metaMap[u.name] = {
        funding: parseFloat(ctx.funding || 0),
        openInterest: parseFloat(ctx.openInterest || 0)
      };
    });
  }

  // Transform Positions to Portfolio Holdings
  const holdings = (state?.assetPositions || []).map(p => {
    const pos = p.position;
    const m = metaMap[pos.coin] || {};
    return {
      symbol: pos.coin,
      name: pos.coin,
      price: parseFloat(pos.markPrice),
      quantity: parseFloat(pos.szi),
      entry_price: parseFloat(pos.entryPx),
      type: "crypto",
      market_type: "perp",
      order_type: parseFloat(pos.szi) > 0 ? "buy" : "sell",
      strategyName: "Hyperliquid Perp",
      date_added: new Date().toISOString(),
      fundingRate: m.funding,
      openInterest: m.openInterest
    };
  });

  // Transform Fills to Trade Executions
  const trades = (fills || []).map(f => ({
    clientId: `hl-${f.oid}-${f.tid}`,
    date: new Date(f.time).toISOString().split("T")[0],
    executedAt: new Date(f.time).toISOString(),
    asset: f.coin,
    name: f.coin,
    type: "crypto",
    side: f.side === "B" ? "buy" : "sell",
    marketType: "perp",
    status: "Filled",
    quantity: Math.abs(parseFloat(f.sz)),
    price: parseFloat(f.px),
    notional: Math.abs(parseFloat(f.sz) * parseFloat(f.px)),
    strategyName: "Hyperliquid Perp"
  }));

  const cashBalance = parseFloat(state?.marginSummary?.accountValue || 0);

  return { holdings, trades, cashBalance, currency: "USDC" };
}

/**
 * Sync logic for Binance
 */
async function syncBinance(apiKey, apiSecret) {
  const fetch = await resolveFetch();
  if (!apiKey || !apiSecret) throw new Error("Binance API Key and Secret are required");

  const timestamp = Date.now();
  
  // 1. Fetch Spot Balances
  const spotQuery = `timestamp=${timestamp}`;
  const spotSignature = crypto.createHmac("sha256", apiSecret).update(spotQuery).digest("hex");
  const spotResponse = await fetch(`https://api.binance.com/api/v3/account?${spotQuery}&signature=${spotSignature}`, {
    headers: { "X-MBX-APIKEY": apiKey }
  });
  const spotAccount = await spotResponse.json();

  const spotHoldings = (spotAccount?.balances || [])
    .filter(b => parseFloat(b.free) + parseFloat(b.locked) > 0)
    .map(b => ({
      symbol: b.asset,
      name: b.asset,
      price: 0,
      quantity: parseFloat(b.free) + parseFloat(b.locked),
      type: "crypto",
      market_type: "spot",
      order_type: "buy",
      strategyName: "Binance Spot",
      date_added: new Date().toISOString()
    }));

  // 2. Fetch Futures (Perp) Positions
  const futQuery = `timestamp=${timestamp}`;
  const futSignature = crypto.createHmac("sha256", apiSecret).update(futQuery).digest("hex");
  const futResponse = await fetch(`https://fapi.binance.com/fapi/v2/account?${futQuery}&signature=${futSignature}`, {
    headers: { "X-MBX-APIKEY": apiKey }
  });
  const futAccount = await futResponse.json();

  // 3. Fetch Futures Tickers (Funding & OI)
  const futTickersResponse = await fetch("https://fapi.binance.com/fapi/v1/premiumIndex");
  const futTickers = await futTickersResponse.json();
  const tickerMap = {};
  if (Array.isArray(futTickers)) {
    futTickers.forEach(t => {
      tickerMap[t.symbol] = {
        funding: parseFloat(t.lastFundingRate || 0)
      };
    });
  }

  const futHoldings = await Promise.all((futAccount?.positions || [])
    .filter(p => Math.abs(parseFloat(p.positionAmt)) > 0)
    .map(async (p) => {
      const m = tickerMap[p.symbol] || {};
      let oi = null;
      try {
        const oiResponse = await fetch(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${p.symbol}`);
        const oiData = await oiResponse.json();
        oi = parseFloat(oiData.openInterest || 0);
      } catch (e) {
        console.error(`Failed to fetch OI for ${p.symbol}`, e);
      }
      return {
        symbol: p.symbol,
        name: p.symbol,
        price: parseFloat(p.markPrice),
        quantity: parseFloat(p.positionAmt),
        entry_price: parseFloat(p.entryPrice),
        type: "crypto",
        market_type: "perp",
        order_type: parseFloat(p.positionAmt) > 0 ? "buy" : "sell",
        strategyName: "Binance Perp",
        date_added: new Date().toISOString(),
        fundingRate: m.funding,
        openInterest: oi
      };
    }));

  const cashBalance = parseFloat(futAccount?.totalMarginBalance || spotAccount?.totalAssetOfBtc || 0);

  return { holdings: [...spotHoldings, ...futHoldings], trades: [], cashBalance, currency: "USDT" };
}

/**
 * Sync logic for Bybit
 */
async function syncBybit(apiKey, apiSecret) {
  const fetch = await resolveFetch();
  if (!apiKey || !apiSecret) throw new Error("Bybit API Key and Secret are required");

  const timestamp = Date.now().toString();
  const recvWindow = "5000";

  const getSignature = (params) => {
    return crypto.createHmac("sha256", apiSecret).update(timestamp + apiKey + recvWindow + params).digest("hex");
  };

  // 1. Fetch Positions (Linear Perps)
  const posParams = "category=linear&settleCoin=USDT";
  const posSignature = getSignature(posParams);
  const posResponse = await fetch(`https://api.bybit.com/v5/position/list?${posParams}`, {
    headers: {
      "X-BAPI-API-KEY": apiKey,
      "X-BAPI-TIMESTAMP": timestamp,
      "X-BAPI-SIGN": posSignature,
      "X-BAPI-RECV-WINDOW": recvWindow
    }
  });
  const posData = await posResponse.json();

  // 2. Fetch Market Info (Funding & OI)
  const tickerResponse = await fetch("https://api.bybit.com/v5/market/tickers?category=linear");
  const tickerData = await tickerResponse.json();
  const tickerMap = {};
  if (tickerData?.result?.list) {
    tickerData.result.list.forEach(t => {
      tickerMap[t.symbol] = {
        funding: parseFloat(t.fundingRate || 0),
        openInterest: parseFloat(t.openInterest || 0)
      };
    });
  }

  const holdings = (posData?.result?.list || []).map(p => {
    const m = tickerMap[p.symbol] || {};
    return {
      symbol: p.symbol,
      name: p.symbol,
      price: parseFloat(p.markPrice),
      quantity: parseFloat(p.size) * (p.side === "Buy" ? 1 : -1),
      entry_price: parseFloat(p.avgPrice),
      type: "crypto",
      market_type: "perp",
      order_type: p.side.toLowerCase(),
      strategyName: "Bybit Perp",
      date_added: new Date().toISOString(),
      fundingRate: m.funding,
      openInterest: m.openInterest
    };
  });

  return { holdings, trades: [], cashBalance: 0, currency: "USDT" };
}

module.exports = {
  syncHyperliquid,
  syncBinance,
  syncBybit
};
