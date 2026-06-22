/**
 * Watchlist Import Parser — pure functions for parsing watchlist import payloads
 * (CSV, TSV, JSON, loose text) into normalized asset rows.
 */

const UNSUPPORTED_IMPORT_EXTENSIONS = new Set(["xlsx", "xls", "docx", "doc", "pdf"]);

const normalizeImportField = (value) => String(value || "").trim();

const normalizeImportSymbol = (value) => normalizeImportField(value)
  .replace(/^\$+/, "")
  .replace(/[^a-zA-Z0-9.\-_:]/g, "")
  .toUpperCase()
  .slice(0, 30);

const normalizeImportCategory = (value, fallback = "stocks") => {
  const normalized = normalizeImportField(value).toLowerCase();
  if (["stock", "stocks", "equity", "equities"].includes(normalized)) return "stocks";
  if (["crypto", "cryptocurrency", "coin", "coins"].includes(normalized)) return "crypto";
  if (["indicator", "indicators", "macro"].includes(normalized)) return "indicators";
  if (["commodity", "commodities", "metal", "metals"].includes(normalized)) return "commodities";
  return normalized || String(fallback || "stocks").toLowerCase();
};

const inferImportType = (row = {}, category = "stocks") => {
  const raw = normalizeImportField(row.type || row.assetType || row.asset_class || row.assetClass).toLowerCase();
  const normalizedCategory = normalizeImportCategory(row.category || category, category);
  if (["crypto", "coin", "token"].includes(raw) || normalizedCategory === "crypto") return "crypto";
  if (["indicator", "macro"].includes(raw) || normalizedCategory === "indicators") return "indicator";
  if (["commodity", "metal"].includes(raw) || normalizedCategory === "commodities") return "commodity";
  if (["etf", "fund"].includes(raw)) return "etf";
  return "stock";
};

const inferImportMarketType = (type, row = {}) => {
  const raw = normalizeImportField(row.marketType || row.market_type || row.market).toLowerCase();
  if (raw) return raw;
  if (type === "crypto") return "spot";
  if (type === "indicator") return "macro";
  if (type === "commodity") return "commodity";
  return "equity";
};

const splitDelimitedLine = (line, delimiter = ",") => {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

const detectDelimiter = (text) => {
  const firstLine = String(text || "").split(/\r?\n/).find((line) => line.trim()) || "";
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes("|")) return "|";
  if (firstLine.includes(";") && !firstLine.includes(",")) return ";";
  return ",";
};

const normalizeImportHeader = (value) => normalizeImportField(value).toLowerCase().replace(/[^a-z0-9]+/g, "");

const mapImportRow = (row = {}, fallbackCategory = "stocks") => {
  const rawSymbol =
    row.symbol || row.ticker || row.asset || row.coin || row.token || row.instrument || row.name || row[0];
  const symbol = normalizeImportSymbol(rawSymbol);
  if (!symbol || symbol.length > 30) return null;
  const category = normalizeImportCategory(row.category || row.watchlist || row.group || row.sector || fallbackCategory, fallbackCategory);
  const type = inferImportType(row, category);
  return {
    symbol,
    name: normalizeImportField(row.name || row.company || row.assetName || row.description) || symbol,
    type,
    category,
    theme: normalizeImportField(row.theme || row.thesis || row.tag || row.tags || row.note || row.notes) || null,
    marketType: inferImportMarketType(type, row),
    date_added: new Date().toISOString()
  };
};

const parseStructuredImportRows = (text, fallbackCategory) => {
  const delimiter = detectDelimiter(text);
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const parsedLines = lines.map((line) => splitDelimitedLine(line, delimiter));
  const headerCells = parsedLines[0].map(normalizeImportHeader);
  const knownHeaders = new Set(["symbol", "ticker", "asset", "coin", "token", "instrument", "name", "company", "category", "theme", "tag", "tags", "type", "markettype", "market"]);
  const hasHeader = headerCells.some((cell) => knownHeaders.has(cell));
  if (!hasHeader) {
    return parsedLines.map((cells) => mapImportRow({
      symbol: cells[0],
      name: cells[1],
      theme: cells[2],
      category: cells[3]
    }, fallbackCategory)).filter(Boolean);
  }
  return parsedLines.slice(1).map((cells) => {
    const row = {};
    headerCells.forEach((header, index) => {
      if (!header) return;
      row[header] = cells[index];
    });
    return mapImportRow({
      symbol: row.symbol || row.ticker || row.asset || row.coin || row.token || row.instrument,
      name: row.name || row.company || row.assetname || row.description,
      category: row.category || row.watchlist || row.group || row.sector,
      theme: row.theme || row.thesis || row.tag || row.tags || row.note || row.notes,
      type: row.type || row.assettype || row.assetclass,
      marketType: row.markettype || row.market
    }, fallbackCategory);
  }).filter(Boolean);
};

const parseLooseImportRows = (text, fallbackCategory) => {
  const candidates = String(text || "")
    .replace(/https?:\/\/\S+/gi, " ")
    .split(/[\s,;|()[\]{}"'`]+/)
    .map((token) => normalizeImportSymbol(token))
    .filter((token) => token && /^[A-Z][A-Z0-9.\-_:]{0,14}$/.test(token));
  const blocked = new Set(["HTTP", "HTTPS", "WWW", "CSV", "TSV", "JSON", "TRUE", "FALSE", "NULL"]);
  return candidates
    .filter((symbol) => !blocked.has(symbol))
    .map((symbol) => mapImportRow({ symbol }, fallbackCategory))
    .filter(Boolean);
};

const parseWatchlistImportPayload = (text, fallbackCategory = "stocks") => {
  const raw = String(text || "").trim();
  if (!raw) return [];
  let rows = [];
  try {
    const parsed = JSON.parse(raw);
    const sourceRows = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.assets) ? parsed.assets : []);
    rows = sourceRows.map((row) => mapImportRow(row, fallbackCategory)).filter(Boolean);
  } catch {
    rows = parseStructuredImportRows(raw, fallbackCategory);
  }
  if (!rows.length) rows = parseLooseImportRows(raw, fallbackCategory);
  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.symbol}::${row.marketType}::${row.category}::${row.theme || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export {
  UNSUPPORTED_IMPORT_EXTENSIONS,
  normalizeImportField,
  normalizeImportSymbol,
  normalizeImportCategory,
  inferImportType,
  inferImportMarketType,
  splitDelimitedLine,
  detectDelimiter,
  normalizeImportHeader,
  mapImportRow,
  parseStructuredImportRows,
  parseLooseImportRows,
  parseWatchlistImportPayload
};
