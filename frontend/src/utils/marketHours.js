/**
 * Utility to determine if a market is open based on the asset's symbol and type.
 */

import { MARKET_HOURS } from "../constants/marketConfig";


export function getMarketStatus(asset) {
  if (!asset || !asset.symbol) return { isOpen: true, status: "Open" };

  const symbol = String(asset.symbol).toUpperCase();
  const type = String(asset.type || "").toLowerCase();
  const marketType = String(asset.marketType || "").toLowerCase();
  const category = String(asset.category || "").toLowerCase();

  const isCrypto =
    type === "crypto" ||
    category === "crypto" ||
    marketType === "perp" ||
    (marketType === "spot" && ["crypto", "stablecoin", "exchange token"].includes(type));

  // Crypto is 24/7. Do not treat every generic "spot" asset as crypto,
  // because some non-crypto assets fall back to spot when metadata is sparse.
  if (isCrypto) {
    return { isOpen: true, status: "Open (24/7)" };
  }

  // Forex is 24/5
  if (type === "forex" || category === "forex" || symbol.includes("=X")) {
    const now = new Date();
    const day = now.getUTCDay(); // 0 = Sun, 6 = Sat
    const hour = now.getUTCHours();
    if ((day === 5 && hour >= 22) || day === 6 || (day === 0 && hour < 21)) {
      return { isOpen: false, status: "Closed (Weekend)" };
    }
    return { isOpen: true, status: "Open (24/5)" };
  }

  // Determine exchange from symbol suffix
  let exchange = "US";
  if (symbol.endsWith(".HK")) exchange = "HK";
  else if (symbol.endsWith(".T")) exchange = "JP";
  else if (symbol.endsWith(".L")) exchange = "UK";
  else if (symbol.endsWith(".DE")) exchange = "DE";
  else if (symbol.endsWith(".PA")) exchange = "FR";
  else if (symbol.endsWith(".SS") || symbol.endsWith(".SZ")) exchange = "CN";
  else if (symbol.endsWith(".AX")) exchange = "AU";
  else if (symbol.endsWith(".TO") || symbol.endsWith(".V")) exchange = "CA";
  else if (symbol.endsWith(".NS") || symbol.endsWith(".BO")) exchange = "IN";

  const config = MARKET_HOURS[exchange] || MARKET_HOURS.US;
  
  // Get current time in the target timezone
  const now = new Date();
  const targetTimeStr = now.toLocaleString("en-US", { timeZone: config.tz, hour12: false });
  const [datePart, timePart] = targetTimeStr.split(", ");
  const [hours, minutes] = timePart.split(":").map(Number);
  const decimalTime = hours + minutes / 60;

  // Check if it's a weekend in the target timezone
  const targetDate = new Date(now.toLocaleString("en-US", { timeZone: config.tz }));
  const day = targetDate.getDay(); // 0 = Sunday, 6 = Saturday
  const isWeekend = day === 0 || day === 6;

  if (isWeekend) {
    return { isOpen: false, status: "Closed (Weekend)" };
  }

  const isMarketHours = decimalTime >= config.open && decimalTime < config.close;
  
  // Check for lunch break
  if (config.lunch && decimalTime >= config.lunch[0] && decimalTime < config.lunch[1]) {
    return { isOpen: false, status: "Closed (Lunch Break)" };
  }

  if (!isMarketHours) {
    return { isOpen: false, status: "Closed (Out of Hours)" };
  }

  return { isOpen: true, status: "Open" };
}
