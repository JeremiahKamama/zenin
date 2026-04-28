const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

async function checkApis() {
    const assets = ["BTC", "ETH", "SOL", "HYPE", "BNB"];
    
    console.log("--- Checking Bybit ---");
    try {
        const bybitRes = await fetch("https://api.bybit.com/v5/market/tickers?category=linear").then(r => r.json());
        console.log("Bybit response received. Sample item:");
        const sample = bybitRes.result?.list?.find(i => i.symbol === "BTCUSDT");
        console.log(JSON.stringify(sample, null, 2));
    } catch (e) {
        console.error("Bybit failed:", e.message);
    }

    console.log("\n--- Checking Binance Funding ---");
    try {
        const binanceFundingRes = await fetch("https://fapi.binance.com/fapi/v1/premiumIndex").then(r => r.json());
        console.log("Binance funding response received. Sample item:");
        const sample = binanceFundingRes.find(f => f.symbol === "BTCUSDT");
        console.log(JSON.stringify(sample, null, 2));
    } catch (e) {
        console.error("Binance funding failed:", e.message);
    }

    console.log("\n--- Checking Binance OI (BTCUSDT) ---");
    try {
        const binanceOIRes = await fetch("https://fapi.binance.com/fapi/v1/openInterest?symbol=BTCUSDT").then(r => r.json());
        console.log("Binance OI response received:");
        console.log(JSON.stringify(binanceOIRes, null, 2));
    } catch (e) {
        console.error("Binance OI failed:", e.message);
    }
}

checkApis();
