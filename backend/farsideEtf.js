const FARSIDE_ETF_SOURCES = {
  BTC: {
    asset: "BTC",
    url: "https://farside.co.uk/btc/",
    tickers: ["IBIT", "FBTC", "BITB", "ARKB", "BTCO", "EZBC", "BRRR", "HODL", "BTCW", "MSBT", "GBTC", "BTC"],
    managers: [
      "BlackRock",
      "Fidelity",
      "Bitwise",
      "Ark 21Shares",
      "Invesco",
      "Franklin Templeton",
      "Valkyrie",
      "VanEck",
      "WisdomTree",
      "Morgan Stanley",
      "Grayscale",
      "Grayscale Mini"
    ]
  },
  ETH: {
    asset: "ETH",
    url: "https://farside.co.uk/eth/",
    tickers: ["ETHA", "ETHB", "FETH", "ETHW", "TETH", "ETHV", "QETH", "EZET", "ETHE", "ETH"],
    managers: [
      "BlackRock",
      "BlackRock",
      "Fidelity",
      "Bitwise",
      "21Shares",
      "VanEck",
      "Invesco",
      "Franklin Templeton",
      "Grayscale",
      "Grayscale Mini"
    ]
  },
  SOL: {
    asset: "SOL",
    url: "https://farside.co.uk/sol/",
    tickers: ["BSOL", "VSOL", "FSOL", "TSOL", "SOEZ", "GSOL"],
    managers: [
      "Bitwise",
      "VanEck",
      "Fidelity",
      "21Shares",
      "Franklin Templeton",
      "Grayscale"
    ]
  }
};

const DATE_RE = /^\d{2}\s[A-Z][a-z]{2}\s\d{4}$/;
const MONTH_INDEX = {
  Jan: "01",
  Feb: "02",
  Mar: "03",
  Apr: "04",
  May: "05",
  Jun: "06",
  Jul: "07",
  Aug: "08",
  Sep: "09",
  Oct: "10",
  Nov: "11",
  Dec: "12"
};

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

function flattenFarsideHtml(html) {
  const cleaned = decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|td|th|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, "\n");

  return cleaned
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseFarsideNumber(token) {
  const raw = String(token || "").trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/\*/g, "")
    .replace(/,/g, "")
    .replace(/[−–—]/g, "-");

  if (
    normalized === "-" ||
    normalized === "–" ||
    normalized === "—" ||
    /^pending$/i.test(normalized) ||
    /^yes$/i.test(normalized) ||
    /^no$/i.test(normalized)
  ) {
    return null;
  }

  const wrappedNegative = normalized.match(/^\((.+)\)$/);
  const numeric = wrappedNegative ? `-${wrappedNegative[1]}` : normalized;
  const value = Number.parseFloat(numeric);
  return Number.isFinite(value) ? value : null;
}

function toIsoDate(dateLabel) {
  const match = String(dateLabel || "").trim().match(/^(\d{2})\s([A-Z][a-z]{2})\s(\d{4})$/);
  if (!match) return null;
  const [, day, monthLabel, year] = match;
  const month = MONTH_INDEX[monthLabel];
  if (!month) return null;
  return `${year}-${month}-${day}`;
}

function extractLatestCompletedRow(lines, tickerCount) {
  let latestRow = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!DATE_RE.test(line)) continue;

    const cells = lines.slice(index + 1, index + 1 + tickerCount + 1);
    if (cells.length < tickerCount + 1) continue;

    const flowValues = cells.slice(0, tickerCount).map(parseFarsideNumber);
    // If we have at least one numeric flow, consider this a valid row
    if (!flowValues.some((value) => value !== null)) continue;

    latestRow = {
      dateLabel: line,
      total: parseFarsideNumber(cells[tickerCount]), // Total is usually the last column
      flowValues
    };
  }

  return latestRow;
}

function buildFlowRows(config, row) {
  const isoDate = toIsoDate(row?.dateLabel);
  if (!isoDate) return [];

  return config.tickers
    .map((ticker, index) => {
      const flowMillions = row.flowValues[index];
      if (!Number.isFinite(flowMillions)) return null;
      return {
        id: `farside-${config.asset}-${ticker}-${isoDate}`,
        date: isoDate,
        manager: config.managers[index] || ticker,
        ticker,
        asset: config.asset,
        netUsd: Math.round(flowMillions * 1_000_000),
        period: "daily",
        source: "Farside"
      };
    })
    .filter(Boolean);
}

async function fetchFarsideEtfFlows(fetchImpl) {
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required");
  }

  const allFlows = [];

  for (const config of Object.values(FARSIDE_ETF_SOURCES)) {
    try {
      const response = await fetchImpl(config.url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Language": "en-US,en;q=0.9",
          "Sec-Ch-Ua": '"Not-A.Brand";v="99", "Chromium";v="124", "Google Chrome";v="124"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Ch-Ua-Platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1"
        }
      });

      if (!response || !response.ok) {
        throw new Error(`Farside returned ${response?.status || "unknown"}`);
      }

      const html = await response.text();
      const lines = flattenFarsideHtml(html);
      const latestRow = extractLatestCompletedRow(lines, config.tickers.length);
      if (!latestRow) continue;

      allFlows.push(...buildFlowRows(config, latestRow));
    } catch (error) {
      console.error(`[Farside] Failed to parse ${config.asset}: ${error.message}`);
    }
  }

  return allFlows;
}

module.exports = {
  FARSIDE_ETF_SOURCES,
  fetchFarsideEtfFlows,
  _internals: {
    decodeHtmlEntities,
    flattenFarsideHtml,
    parseFarsideNumber,
    toIsoDate,
    extractLatestCompletedRow,
    buildFlowRows,
  },
};
